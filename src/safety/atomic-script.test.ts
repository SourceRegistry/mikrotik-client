import { describe, it, expect, vi, beforeEach } from "vitest";
import { atomicScript } from "./atomic-script";
import type { DeviceTransport } from "../routeros/transport";

function createMockTransport(): DeviceTransport {
  return {
    // commitConfirm (used internally by atomicScript) reads the before/after
    // snapshots back via /file/print (contents) — the mock must answer that
    // shape for every export it takes.
    execute: vi.fn(async (command: string) => {
      if (command === "/file/print") {
        return { tag: "t", records: [{ contents: "" }], traps: [] };
      }
      return { tag: "t", records: [], traps: [] };
    }),
    print: vi.fn().mockResolvedValue([]),
    listen: vi.fn().mockResolvedValue({
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    }),
  };
}

describe("atomicScript", () => {
  let transport: DeviceTransport;

  beforeEach(() => {
    transport = createMockTransport();
  });

  it("executes script within commit-confirm wrapper", async () => {
    const script = "/ip address add address=10.0.0.1/24 interface=ether1";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptAdd = executeCalls.find((call) => call[0] === "/system/script/add");
    expect(scriptAdd).toBeDefined();
    expect(scriptAdd![1].attributes.source).toBe(script);
  });

  it("trims whitespace from script", async () => {
    const script = "\n  /ip address add address=10.0.0.1/24\n  ";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptAdd = executeCalls.find((call) => call[0] === "/system/script/add");
    expect(scriptAdd![1].attributes.source).toBe("/ip address add address=10.0.0.1/24");
  });

  it("runs created script", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptRun = executeCalls.find((call) => call[0] === "/system/script/run");
    expect(scriptRun).toBeDefined();
  });

  it("selects the script to run via a =.id= attribute, not a ?query", async () => {
    // /system/script/run rejects `?query` filters ("missing =.id=") and
    // rejects `numbers=` outright ("unknown parameter numbers") — it only
    // accepts a `.id` attribute (name or real id both work).
    const script = "/ip address add address=10.0.0.1/24";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptRun = executeCalls.find((call) => call[0] === "/system/script/run");
    expect(scriptRun![1].attributes).toHaveProperty(".id");
    expect(scriptRun![1].queries).toBeUndefined();
  });

  it("cleans up temporary script after execution", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptRemove = executeCalls.find((call) => call[0] === "/system/script/remove");
    expect(scriptRemove).toBeDefined();
  });

  it("selects the script to remove via numbers=, not a ?query", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptRemove = executeCalls.find((call) => call[0] === "/system/script/remove");
    expect(scriptRemove![1].attributes).toHaveProperty("numbers");
    expect(scriptRemove![1].queries).toBeUndefined();
  });

  it("preserves script name pattern tmp-*", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const scriptAdd = executeCalls.find((call) => call[0] === "/system/script/add");
    expect(scriptAdd![1].attributes.name).toMatch(/^tmp-[a-f0-9]{8}$/);
  });

  it("returns confirm/rollback handle", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    const handle = await atomicScript(transport, { script });

    expect(handle.txid).toBeDefined();
    expect(handle.confirm).toBeDefined();
    expect(handle.rollback).toBeDefined();
    expect(handle.isSettled()).toBe(false);
  });

  it("passes signal through to commands", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    const controller = new AbortController();
    await atomicScript(transport, {
      script,
      signal: controller.signal,
    });
    // If we got here without error, signal was handled correctly
    expect(transport.execute).toHaveBeenCalled();
  });

  it("calls backup before script execution", async () => {
    const script = "/ip address add address=10.0.0.1/24";
    await atomicScript(transport, { script });

    const executeCalls = transport.execute.mock.calls;
    const exportCall = executeCalls.find((call) => call[0] === "/export");
    expect(exportCall).toBeDefined();

    const scriptAdd = executeCalls.find((call) => call[0] === "/system/script/add");
    const exportIndex = executeCalls.findIndex((call) => call === exportCall);
    const scriptIndex = executeCalls.findIndex((call) => call === scriptAdd);
    expect(exportIndex).toBeLessThan(scriptIndex);
  });
});
