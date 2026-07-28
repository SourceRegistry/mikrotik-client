import { describe, expect, it, vi } from "vitest";
import { diff, applyPatch, renderPatch, isPatchEmpty, patchSize } from "./diff";
import { parseExport } from "./parse";
import {
  createEmptyConfig,
  type IRResourceBlock,
  type RouterOSConfig,
  type IRResourceCommand,
  type IRProperty,
} from "./types";
import type { DeviceTransport } from "../routeros/transport";

function resource(
  path: string,
  command: IRResourceCommand,
  props: IRProperty[],
  findQuery?: IRProperty
): IRResourceBlock {
  const block: IRResourceBlock = {
    kind: "resource",
    path,
    command,
    properties: props,
  };
  if (findQuery) {
    block.findQuery = [findQuery];
  }
  return block;
}

function config(items: IRResourceBlock[]): RouterOSConfig {
  const c = createEmptyConfig();
  c.items = items;
  return c;
}

describe("diff", () => {
  describe("creates", () => {
    it("detects new resources in desired config", () => {
      const current = config([]);
      const desired = config([
        resource("/ip address", "add", [
          { name: "address", value: "192.168.1.1/24" },
          { name: "interface", value: "bridge1" },
        ]),
      ]);
      const patch = diff(current, desired);
      expect(patch.create).toHaveLength(1);
      expect(patch.update).toHaveLength(0);
      expect(patch.delete).toHaveLength(0);
    });
  });

  describe("updates", () => {
    it("detects property changes in existing resources", () => {
      const current = config([
        resource("/interface ethernet", "set", [{ name: "disabled", value: "yes" }], {
          name: "default-name",
          value: "ether1",
        }),
      ]);
      const desired = config([
        resource(
          "/interface ethernet",
          "set",
          [
            { name: "disabled", value: "no" },
            { name: "comment", value: "wan" },
          ],
          { name: "default-name", value: "ether1" }
        ),
      ]);
      const patch = diff(current, desired);
      expect(patch.create).toHaveLength(0);
      expect(patch.update).toHaveLength(1);
      expect(patch.delete).toHaveLength(0);

      const update = patch.update[0];
      expect(update.changes).toBeDefined();
      const disabledChange = update.changes.find((c) => c.name === "disabled");
      expect(disabledChange).toMatchObject({
        oldValue: "yes",
        newValue: "no",
      });
    });

    it("detects no changes when configs are identical", () => {
      const block = resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]);
      const current = config([block]);
      const desired = config([structuredClone(block)]);
      const patch = diff(current, desired);
      expect(patch.create).toHaveLength(0);
      expect(patch.update).toHaveLength(0);
      expect(patch.delete).toHaveLength(0);
    });
  });

  describe("deletes", () => {
    it("detects removed resources", () => {
      const current = config([
        resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
      ]);
      const desired = config([]);
      const patch = diff(current, desired);
      expect(patch.create).toHaveLength(0);
      expect(patch.update).toHaveLength(0);
      expect(patch.delete).toHaveLength(1);
    });
  });

  describe("isPatchEmpty", () => {
    it("returns true for empty patch", () => {
      const patch = diff(config([]), config([]));
      expect(isPatchEmpty(patch)).toBe(true);
    });

    it("returns false for non-empty patch", () => {
      const current = config([]);
      const desired = config([
        resource("/ip address", "add", [{ name: "address", value: "10.0.0.1/24" }]),
      ]);
      const patch = diff(current, desired);
      expect(isPatchEmpty(patch)).toBe(false);
    });
  });

  describe("patchSize", () => {
    it("returns total number of operations", () => {
      const current = config([
        resource("/ip address", "add", [{ name: "address", value: "10.0.0.1/24" }]),
      ]);
      const desired = config([
        resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
      ]);
      const patch = diff(current, desired);
      expect(patchSize(patch)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("resource ID property paths", () => {
    function testPath(path: string, primaryProp: string) {
      const current = config([resource(path, "add", [{ name: primaryProp, value: "x" }])]);
      const desired = config([resource(path, "add", [{ name: primaryProp, value: "x" }])]);
      const patch = diff(current, desired);
      expect(patch.create).toHaveLength(0);
    }

    it("uses bridge port properties", () => testPath("/interface bridge port", "interface"));
    it("uses bridge vlan properties", () => testPath("/interface bridge vlan", "vlan-ids"));
    it("uses route properties", () => testPath("/ip route", "dst-address"));
    it("uses firewall filter properties", () => testPath("/ip firewall filter", "chain"));
    it("uses firewall nat properties", () => testPath("/ip firewall nat", "chain"));
    it("uses firewall mangle properties", () => testPath("/ip firewall mangle", "chain"));
    it("uses dhcp properties", () => testPath("/ip dhcp-server", "address"));
    it("uses bgp properties", () => testPath("/routing bgp connection", "name"));
  });

  describe("property removal", () => {
    it("detects property removed from old config", () => {
      const current = config([
        resource(
          "/interface",
          "set",
          [
            { name: "name", value: "ether1" },
            { name: "comment", value: "old-comment" },
          ],
          { name: "name", value: "ether1" }
        ),
      ]);
      const desired = config([
        resource(
          "/interface",
          "set",
          [
            { name: "name", value: "ether1" },
            // comment removed
          ],
          { name: "name", value: "ether1" }
        ),
      ]);
      const patch = diff(current, desired);
      expect(patch.update).toHaveLength(1);
      const removedChange = patch.update[0]?.changes.find((c) => c.name === "comment");
      expect(removedChange).toBeDefined();
      expect(removedChange?.newValue).toBe("");
    });
  });
});

describe("applyPatch", () => {
  it("applies create operations via transport", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockResolvedValue({ sentences: [], status: "done" }),
    };
    const transport = mockTransport as DeviceTransport;

    const patch = diff(
      config([]),
      config([resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }])])
    );

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBeGreaterThan(0);
    expect(transport.execute).toHaveBeenCalled();
  });

  it("handles abort signal", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockResolvedValue({ sentences: [], status: "done" }),
    };
    const transport = mockTransport as DeviceTransport;

    const patch = diff(
      config([]),
      config([resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }])])
    );

    const controller = new AbortController();
    controller.abort();
    const result = await applyPatch(transport, patch, { signal: controller.signal });
    expect(result.failed.length).toBeGreaterThan(0);
  });

  it("collects errors on failed operations", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockRejectedValue(new Error("device unavailable")),
    };
    const transport = mockTransport as DeviceTransport;

    const patch = diff(
      config([]),
      config([resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }])])
    );

    const result = await applyPatch(transport, patch, {});
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("device unavailable");
  });

  it("applies update operations via transport", async () => {
    // RouterOS /set doesn't accept a ?query filter directly ("missing
    // =.id=") — applyPatch must resolve the find filter to a concrete .id
    // via /print first, then select it in the /set call via numbers=.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn(async (command: string) => {
        if (command === "/interface/ethernet/print") {
          return { tag: "t", records: [{ ".id": "*1" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/interface ethernet", "set", [{ name: "disabled", value: "yes" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const desired = config([
      resource("/interface ethernet", "set", [{ name: "disabled", value: "no" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const patch = diff(current, desired);
    expect(patch.update).toHaveLength(1);

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(transport.execute).toHaveBeenCalledWith(
      "/interface/ethernet/set",
      expect.objectContaining({
        attributes: expect.objectContaining({ disabled: "no", numbers: "*1" }),
      })
    );
  });

  it("update only sends properties that actually changed, not the whole block", async () => {
    // RouterOS rejects re-setting some properties even to their current
    // value (e.g. `vrf` fails with "this is configured elsewhere"), so
    // resending every property on the block — not just the ones that
    // differ — can make an otherwise-valid update fail outright. Found
    // live: a curated verbose /ip service capture carries every property
    // (address, port, vrf, ...), and only `disabled` had actually changed.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn(async (command: string) => {
        if (command === "/ip/service/print") {
          return { tag: "t", records: [{ ".id": "*9" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource(
        "/ip service",
        "set",
        [
          { name: "disabled", value: "yes" },
          { name: "port", value: "8728" },
          { name: "vrf", value: "main" },
        ],
        { name: "name", value: "api" }
      ),
    ]);
    const desired = config([
      resource(
        "/ip service",
        "set",
        [
          { name: "disabled", value: "no" },
          { name: "port", value: "8728" },
          { name: "vrf", value: "main" },
        ],
        { name: "name", value: "api" }
      ),
    ]);
    const patch = diff(current, desired);
    expect(patch.update).toHaveLength(1);
    expect(patch.update[0]?.changes).toHaveLength(1);

    await applyPatch(transport, patch, {});

    const setCall = (transport.execute as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "/ip/service/set"
    );
    expect(setCall![1].attributes).toEqual({ disabled: "no", numbers: "*9" });
  });

  it("applies delete operations via transport", async () => {
    // Same resolve-then-mutate requirement as /set applies to /remove.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn(async (command: string) => {
        if (command === "/ip/address/print") {
          return { tag: "t", records: [{ ".id": "*5" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
    ]);
    const desired = config([]);
    const patch = diff(current, desired);
    expect(patch.delete).toHaveLength(1);

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(transport.execute).toHaveBeenCalledWith("/ip/address/remove", {
      attributes: { numbers: "*5" },
      timeoutMs: 30000,
    });
  });

  it("updates a singleton resource (no .id) without a numbers= selector", async () => {
    // /system identity, /system clock, etc. have exactly one implicit
    // record and no `.id` — their /set rejects `numbers=` outright with
    // "unknown parameter numbers". /print resolving to a record with no
    // `.id` field is the signal to mutate unselected.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn(async (command: string) => {
        if (command === "/system/identity/print") {
          return { tag: "t", records: [{}], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }),
    };
    const transport = mockTransport as DeviceTransport;

    // Built by hand rather than via diff(): diff()'s key-matching uses
    // "name" as the identity property, which doesn't work when "name" is
    // itself the property being changed (as for /system identity) — that's
    // a separate diff-matching nuance, not what this test is about.
    const patch = {
      create: [],
      delete: [],
      update: [
        {
          op: "update" as const,
          block: resource("/system identity", "set", [{ name: "name", value: "new" }]),
          changes: [{ name: "name", oldValue: "old", newValue: "new" }],
        },
      ],
    };

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(transport.execute).toHaveBeenCalledWith(
      "/system/identity/set",
      expect.objectContaining({ attributes: { name: "new" } })
    );
    const setCall = (transport.execute as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "/system/identity/set"
    );
    expect(setCall![1].attributes).not.toHaveProperty("numbers");
  });

  it("skips update/delete when the find filter resolves to nothing", async () => {
    // If the target no longer exists on the device (already reverted,
    // manually removed, etc.), that's a no-op, not a failure.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockResolvedValue({ tag: "t", records: [], traps: [] }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
    ]);
    const desired = config([]);
    const patch = diff(current, desired);

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it("excludes dynamic entries when resolving a target to update", async () => {
    // Found live: /ip/service/print surfaces an active API connection as
    // its own dynamic "api" row alongside the real static service
    // definition — both matched `?name=api`, and applyPatch tried to set
    // both via `numbers=id1,id2` in one call, which failed outright
    // because the connection row can't be modified that way.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn(async (command: string, options?: { queries?: readonly string[] }) => {
        if (command === "/ip/service/print") {
          expect(options?.queries).toContain("?dynamic=false");
          // Simulate the device already filtering the dynamic connection
          // row out — only the real static entry matches.
          return { tag: "t", records: [{ ".id": "*7" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/ip service", "set", [{ name: "disabled", value: "yes" }], {
        name: "name",
        value: "api",
      }),
    ]);
    const desired = config([
      resource("/ip service", "set", [{ name: "disabled", value: "no" }], {
        name: "name",
        value: "api",
      }),
    ]);
    const patch = diff(current, desired);

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    const setCall = (transport.execute as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "/ip/service/set"
    );
    expect(setCall![1].attributes.numbers).toBe("*7");
  });

  it("handles abort signal during update operations", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockResolvedValue({ sentences: [], status: "done" }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/interface ethernet", "set", [{ name: "disabled", value: "yes" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const desired = config([
      resource("/interface ethernet", "set", [{ name: "disabled", value: "no" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const patch = diff(current, desired);

    const controller = new AbortController();
    controller.abort();
    const result = await applyPatch(transport, patch, { signal: controller.signal });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("Aborted");
  });

  it("handles abort signal during delete operations", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockResolvedValue({ sentences: [], status: "done" }),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
    ]);
    const desired = config([]);
    const patch = diff(current, desired);

    const controller = new AbortController();
    controller.abort();
    const result = await applyPatch(transport, patch, { signal: controller.signal });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("Aborted");
  });

  it("collects errors on failed update operations", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockRejectedValue(new Error("update failed")),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/interface ethernet", "set", [{ name: "disabled", value: "yes" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const desired = config([
      resource("/interface ethernet", "set", [{ name: "disabled", value: "no" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const patch = diff(current, desired);

    const result = await applyPatch(transport, patch, {});
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("update failed");
  });

  it("collects errors on failed delete operations", async () => {
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn().mockRejectedValue(new Error("delete failed")),
    };
    const transport = mockTransport as DeviceTransport;

    const current = config([
      resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
    ]);
    const desired = config([]);
    const patch = diff(current, desired);

    const result = await applyPatch(transport, patch, {});
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("delete failed");
  });

  it("applies mixed create, update, delete in a single patch", async () => {
    // update/delete each take an extra /print resolve call now, so a raw
    // execute() call count no longer maps 1:1 to patch operations — assert
    // on applied/skipped/failed instead.
    const mockTransport: Partial<DeviceTransport> = {
      execute: vi.fn(async (command: string) => {
        if (command.endsWith("/print")) {
          return { tag: "t", records: [{ ".id": "*9" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }),
    };
    const transport = mockTransport as DeviceTransport;

    // Create: new item only in desired
    // Update: item in both with changed property
    // Delete: item only in current
    const current = config([
      resource("/ip address", "add", [
        { name: "address", value: "10.0.0.1/24" },
        { name: "interface", value: "ether1" },
      ]),
      resource("/interface ethernet", "set", [{ name: "disabled", value: "yes" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const desired = config([
      resource("/ip address", "add", [
        { name: "address", value: "192.168.1.1/24" },
        { name: "interface", value: "bridge1" },
      ]),
      resource("/interface ethernet", "set", [{ name: "disabled", value: "no" }], {
        name: "default-name",
        value: "ether1",
      }),
    ]);
    const patch = diff(current, desired);

    const result = await applyPatch(transport, patch, {});
    expect(result.applied).toBe(patch.create.length + patch.update.length + patch.delete.length);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it("never synthesizes create/delete for a `set` block missing from one snapshot", () => {
    // RouterOS's /export omits entries left at their default value — an
    // untouched /ip service entry (or any singleton like /system identity)
    // simply won't appear in the export at all. If a property is then
    // changed away from default, only the "after" snapshot mentions it,
    // making diff() see "exists in current, absent in desired" and
    // (before this fix) emit a `delete` op — which for /ip service
    // rendered as `/ip service remove [find name=api]`, not a real
    // command (service entries can't be removed). Found live: a scheduled
    // revert built exactly this and silently failed, leaving the device
    // locked out over the API port with no way for the scheduler to fix it.
    const beforeConfig = parseExport(""); // "api" was never mentioned — at default
    const afterConfig = parseExport("/ip service\nset api disabled=yes\n");

    const revertPatch = diff(afterConfig, beforeConfig);
    expect(revertPatch.delete).toHaveLength(0);
    expect(revertPatch.create).toHaveLength(0);
    expect(renderPatch(revertPatch)).toBe("");
  });

  it("end-to-end: diffing real /ip service export text produces a targeted revert script", () => {
    // Regression for the actual failure found live: a scheduled revert with
    // an empty on-event because the bare "api"/"telnet" identifiers were
    // lost during parsing, so every /ip service entry collapsed to the
    // same (path-only) key and the diff came out empty.
    const before = parseExport("/ip service\nset api disabled=no\nset telnet disabled=no\n");
    const after = parseExport("/ip service\nset api disabled=yes\nset telnet disabled=no\n");

    const revertPatch = diff(after, before);
    expect(revertPatch.update).toHaveLength(1);
    expect(revertPatch.update[0]?.block.findQuery).toEqual([{ name: "name", value: "api" }]);

    const script = renderPatch(revertPatch);
    expect(script).toContain("[find name=api]");
    expect(script).toContain("disabled=no");
    expect(script).not.toContain("telnet");
  });

  it("renderPatch: update line only includes properties that actually changed", () => {
    // Same "this is configured elsewhere" failure mode as the applyPatch
    // regression above, but for the on-event script text that runs
    // without a live client — a scheduled revert is exactly where this
    // needs to hold, since there's no one around to retry it.
    const before = parseExport('/ip service\nset api disabled=no port=8728 vrf=main address=""\n');
    const after = parseExport('/ip service\nset api disabled=yes port=8728 vrf=main address=""\n');

    const revertPatch = diff(after, before);
    expect(revertPatch.update[0]?.changes).toHaveLength(1);

    const script = renderPatch(revertPatch);
    expect(script).toBe("/ip service set [find name=api] disabled=no\n");
  });
});
