import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spinCHR, chrSkip } from "../harness/chr";
import type { TestDevice } from "../harness/chr";
import { RouterOSClient } from "../../src/routeros/index";
import { createRouterOSHelpers } from "../../src/routeros/helpers";
import { commitConfirm } from "../../src/safety/commit-confirm";
import { atomicScript } from "../../src/safety/atomic-script";

const skipDescription = chrSkip();

const run = skipDescription ? describe.skip : describe;

// commitConfirm's rollback/auto-revert mechanism was silently broken
// against real RouterOS for a long time — the mocked unit tests in
// src/safety/commit-confirm.test.ts can't catch protocol-level mismatches
// (wrong selector shapes, invalid commands, unexpected error text) because
// the mock just accepts whatever it's sent. These run against a real CHR
// container so that class of bug fails CI instead of only surfacing live.
run("integration: commitConfirm", () => {
  let device: TestDevice;
  let client: RouterOSClient;

  beforeAll(async () => {
    device = await spinCHR();
    client = new RouterOSClient({
      host: device.host,
      port: device.port,
      username: device.user,
      password: device.pass,
      timeoutMs: 5_000,
    });

    // spinCHR() only waits for the TCP port to accept connections — CHR
    // runs RouterOS as a QEMU/KVM guest inside the container, and the API
    // service isn't ready to log in until that guest OS has actually
    // booted. An early attempt fails with ECONNRESET/"connection closed".
    // Retry a real command until it succeeds instead of trusting
    // TCP-level readiness alone.
    const deadline = Date.now() + 45_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await client.execute("/system/identity/print");
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    if (lastError) throw lastError;
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await device.dispose();
  }, 30_000);

  it("rollback() reverts an additive change (add bridge -> delete)", async () => {
    const helpers = createRouterOSHelpers(client);
    const name = "cc-it-bridge";

    const handle = await commitConfirm({
      transport: client,
      timeoutMs: 20_000,
      async fn() {
        await helpers.bridge.add({ name });
      },
    });

    const during = await helpers.bridge.list({ proplist: [".id", "name"] });
    expect(during.some((b) => b.name === name)).toBe(true);

    await handle.rollback();

    const after = await helpers.bridge.list({ proplist: [".id", "name"] });
    expect(after.some((b) => b.name === name)).toBe(false);
    expect(handle.isSettled()).toBe(true);
  }, 30_000);

  it("confirm() keeps the change and cleans up the scheduler entry", async () => {
    const helpers = createRouterOSHelpers(client);
    const name = "cc-it-bridge-confirm";

    const handle = await commitConfirm({
      transport: client,
      timeoutMs: 20_000,
      async fn() {
        await helpers.bridge.add({ name });
      },
    });

    await handle.confirm();

    const list = await helpers.bridge.list({ proplist: [".id", "name"] });
    const match = list.find((b) => b.name === name);
    expect(match).toBeDefined();

    const sched = await client.execute("/system/scheduler/print", {
      attributes: { ".proplist": ["name"] },
    });
    expect(sched.records.some((r) => r.name === `revert-${handle.txid}`)).toBe(false);

    if (match) await helpers.bridge.remove(match[".id"]);
  }, 30_000);

  it("rollback() fully reverts a property left at its RouterOS default (curated path capture)", async () => {
    // /system identity is never mentioned in a plain /export until it's
    // been touched at least once — this is the exact bug found live:
    // an untouched /ip service entry couldn't be reverted at all without
    // the curated verbose per-menu capture.
    const before = await client.execute("/system/identity/print");
    const originalName = before.records[0]?.name;

    const handle = await commitConfirm({
      transport: client,
      timeoutMs: 20_000,
      async fn() {
        await client.execute("/system/identity/set", {
          attributes: { name: "cc-it-temp-identity" },
        });
      },
    });

    const during = await client.execute("/system/identity/print");
    expect(during.records[0]?.name).toBe("cc-it-temp-identity");

    await handle.rollback();

    const after = await client.execute("/system/identity/print");
    expect(after.records[0]?.name).toBe(originalName);
  }, 30_000);

  it("auto-reverts via the device-side scheduler when the client abandons the transaction", async () => {
    const helpers = createRouterOSHelpers(client);
    const name = "cc-it-auto-revert";

    const handle = await commitConfirm({
      transport: client,
      windowSeconds: 5,
      timeoutMs: 20_000,
      async fn() {
        await helpers.bridge.add({ name });
      },
    });
    void handle; // deliberately never confirm() or rollback()

    const during = await helpers.bridge.list({ proplist: [".id", "name"] });
    expect(during.some((b) => b.name === name)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 12_000)); // past the 5s window + margin

    const after = await helpers.bridge.list({ proplist: [".id", "name"] });
    expect(after.some((b) => b.name === name)).toBe(false);
  }, 30_000);

  it("atomicScript: rollback() reverts a multi-command script atomically", async () => {
    const helpers = createRouterOSHelpers(client);
    const name = "cc-it-atomic-bridge";

    const handle = await atomicScript(client, {
      timeoutMs: 20_000,
      script: `/interface bridge add name=${name}`,
    });

    const during = await helpers.bridge.list({ proplist: [".id", "name"] });
    expect(during.some((b) => b.name === name)).toBe(true);

    await handle.rollback();

    const after = await helpers.bridge.list({ proplist: [".id", "name"] });
    expect(after.some((b) => b.name === name)).toBe(false);
  }, 30_000);
});
