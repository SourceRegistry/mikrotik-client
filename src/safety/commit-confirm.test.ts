import { describe, it, expect, vi, beforeEach } from "vitest";
import { commitConfirm, type CommitConfirmHandle } from "./commit-confirm";
import type { DeviceTransport } from "../routeros/transport";

function createMockTransport(): DeviceTransport {
  return {
    // commitConfirm reads the before/after snapshots back via /file/print
    // (contents), so the mock must answer that shape for every export it
    // takes — other commands don't care about the return value.
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

describe("commitConfirm", () => {
  let transport: DeviceTransport;
  let mockFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = createMockTransport();
    mockFn = vi.fn().mockResolvedValue(undefined);
  });

  it("saves backup before executing fn", async () => {
    await commitConfirm({
      transport,
      fn: mockFn,
    });

    expect(transport.execute).toHaveBeenCalledWith("/export", expect.any(Object));
    expect(mockFn).toHaveBeenCalledWith(transport);
  });

  it("schedules auto-revert after fn executes, using a diff-derived revert script", async () => {
    // The on-event is now the rendered revert *patch* (before vs. after
    // snapshots), not a blind "/import file=..." of the raw export — that
    // approach chokes on default objects that already exist and can't
    // undo additions in the first place. Simulate fn() having added a
    // bridge: "after" has it, "before" doesn't, so the revert script
    // should contain a matching "remove".
    (transport.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (command: string, options?: { queries?: readonly string[] }) => {
        if (command === "/file/print") {
          const query = options?.queries?.[0] ?? "";
          if (query.startsWith("?name=pre-")) {
            return { tag: "t", records: [{ contents: "" }], traps: [] };
          }
          if (query.startsWith("?name=post-")) {
            return {
              tag: "t",
              records: [{ contents: "/interface bridge\nadd name=new-bridge\n" }],
              traps: [],
            };
          }
        }
        return { tag: "t", records: [], traps: [] };
      }
    );

    await commitConfirm({
      transport,
      fn: mockFn,
    });

    const calls = transport.execute.mock.calls;
    const schedulerCall = calls.find((call) => call[0] === "/system/scheduler/add");
    expect(schedulerCall).toBeDefined();
    expect(schedulerCall![1].attributes["on-event"]).toMatch(/remove/);
  });

  it("returns handle with txid and deadline", async () => {
    const handle: CommitConfirmHandle = await commitConfirm({
      transport,
      fn: mockFn,
      windowSeconds: 60,
    });

    expect(handle.txid).toBeDefined();
    expect(handle.deadlineMs).toBeGreaterThan(Date.now());
    expect(handle.isSettled()).toBe(false);
  });

  it("removes the scheduler via a numbers= selector, not a ?query", async () => {
    // /system/scheduler/remove rejects `?query` filters ("missing =.id=")
    // and silently removes nothing — it needs `numbers=`.
    const handle = await commitConfirm({ transport, fn: mockFn });
    await handle.confirm();

    const executeCalls = transport.execute.mock.calls;
    const schedulerRemove = executeCalls.find((call) => call[0] === "/system/scheduler/remove");
    expect(schedulerRemove![1].attributes).toHaveProperty("numbers");
    expect(schedulerRemove![1].queries).toBeUndefined();
  });

  it("confirm removes scheduler and cleanup", async () => {
    const handle = await commitConfirm({
      transport,
      fn: mockFn,
      cleanupAfterConfirm: true,
    });

    const setupCalls = transport.execute.mock.calls;
    expect(setupCalls.some((c) => c[0] === "/export")).toBe(true);
    expect(setupCalls.some((c) => c[0] === "/system/scheduler/add")).toBe(true);

    await handle.confirm();

    const executeCalls = transport.execute.mock.calls;
    const schedulerRemove = executeCalls.find((call) => call[0] === "/system/scheduler/remove");
    expect(schedulerRemove).toBeDefined();

    expect(handle.isSettled()).toBe(true);
  });

  it("confirm skips backup cleanup when cleanupAfterConfirm is false", async () => {
    const handle = await commitConfirm({
      transport,
      fn: mockFn,
      cleanupAfterConfirm: false,
    });

    await handle.confirm();

    // Should not remove the *persisted* backup file (the throwaway "after"
    // snapshot used only to compute the diff is cleaned up regardless).
    const executeCalls = transport.execute.mock.calls;
    const persistedBackupRemoves = executeCalls.filter(
      (call) =>
        call[0] === "/file/remove" &&
        String(
          (call[1] as { attributes?: { numbers?: string } })?.attributes?.numbers ?? ""
        ).startsWith("pre-")
    );
    expect(persistedBackupRemoves).toHaveLength(0);
  });

  it("rollback applies the revert patch and cleans up", async () => {
    // fn() "added" a bridge (after has it, before doesn't) — rollback should
    // resolve it via /interface/bridge/print and remove it via numbers=,
    // not blindly /import the raw pre-fn export.
    (transport.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (command: string, options?: { queries?: readonly string[] }) => {
        if (command === "/file/print") {
          const query = options?.queries?.[0] ?? "";
          if (query.startsWith("?name=pre-")) {
            return { tag: "t", records: [{ contents: "" }], traps: [] };
          }
          if (query.startsWith("?name=post-")) {
            return {
              tag: "t",
              records: [{ contents: "/interface bridge\nadd name=new-bridge\n" }],
              traps: [],
            };
          }
        }
        if (command === "/interface/bridge/print") {
          return { tag: "t", records: [{ ".id": "*1" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }
    );

    const handle = await commitConfirm({
      transport,
      fn: mockFn,
    });

    await handle.rollback();

    const executeCalls = transport.execute.mock.calls;
    const removeCall = executeCalls.find((call) => call[0] === "/interface/bridge/remove");
    expect(removeCall).toBeDefined();
    expect((removeCall![1] as { attributes: { numbers: string } }).attributes.numbers).toBe("*1");

    const schedulerRemove = executeCalls.find((call) => call[0] === "/system/scheduler/remove");
    expect(schedulerRemove).toBeDefined();

    expect(handle.isSettled()).toBe(true);
  });

  it("unsafeDirectApply skips backup and scheduler", async () => {
    const handle = await commitConfirm({
      transport,
      fn: mockFn,
      unsafeDirectApply: true,
    });

    expect(mockFn).toHaveBeenCalledWith(transport);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(handle.isSettled()).toBe(true);
  });

  it("dispose performs best-effort cleanup", async () => {
    const handle = await commitConfirm({
      transport,
      fn: mockFn,
    });

    await handle.dispose();

    const executeCalls = transport.execute.mock.calls;
    const schedulerRemove = executeCalls.find((call) => call[0] === "/system/scheduler/remove");
    expect(schedulerRemove).toBeDefined();
    expect(handle.isSettled()).toBe(true);
  });

  it("confirm is idempotent", async () => {
    const handle = await commitConfirm({
      transport,
      fn: mockFn,
    });

    await handle.confirm();
    const callsAfterFirst = transport.execute.mock.calls.length;
    await handle.confirm();

    expect(transport.execute.mock.calls.length).toBe(callsAfterFirst);
  });

  it("rollback is idempotent", async () => {
    const handle = await commitConfirm({
      transport,
      fn: mockFn,
    });

    await handle.rollback();
    const callsAfterFirst = transport.execute.mock.calls.length;
    await handle.rollback();

    expect(transport.execute.mock.calls.length).toBe(callsAfterFirst);
  });

  it("cleans up backup when fn throws", async () => {
    const throwingFn = vi.fn().mockRejectedValue(new Error("mutation failed"));

    await expect(commitConfirm({ transport, fn: throwingFn })).rejects.toThrow("mutation failed");

    // export backup was saved, then removed on failure
    const calls = transport.execute.mock.calls;
    expect(calls.some((c) => c[0] === "/export")).toBe(true);
    expect(calls.some((c) => c[0] === "/file/remove")).toBe(true);
    // scheduler must NOT have been created
    expect(calls.some((c) => c[0] === "/system/scheduler/add")).toBe(false);
  });

  it("schedules auto-revert with a valid RouterOS scheduler policy list", async () => {
    // RouterOS rejects "admin" on /system/scheduler/add with
    // "input does not match any value of policy" — it's not a real policy keyword.
    await commitConfirm({ transport, fn: mockFn });

    const calls = transport.execute.mock.calls;
    const schedulerCall = calls.find((call) => call[0] === "/system/scheduler/add");
    const policy = schedulerCall![1].attributes.policy as string;
    expect(policy.split(",")).not.toContain("admin");
  });

  it("schedules auto-revert using a month-abbreviation start-date", async () => {
    // RouterOS rejects zero-padded numeric months (e.g. "07/28/2026") on
    // /system/scheduler/add with "invalid date" — only "jul/28/2026" works.
    await commitConfirm({ transport, fn: mockFn });

    const calls = transport.execute.mock.calls;
    const schedulerCall = calls.find((call) => call[0] === "/system/scheduler/add");
    expect(schedulerCall![1].attributes["start-date"]).toMatch(
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\/\d{2}\/\d{4}$/
    );
  });

  it("rolls back the mutation if arming the auto-revert scheduler fails", async () => {
    // fn() has already mutated the device by the time scheduler/add runs.
    // If arming the safety net fails, the change must not be left live and
    // unmanaged — it should be reverted via the revert patch instead.
    (transport.execute as ReturnType<typeof vi.fn>).mockImplementation(
      async (command: string, options?: { queries?: readonly string[] }) => {
        if (command === "/system/scheduler/add") {
          throw new Error("invalid date");
        }
        if (command === "/file/print") {
          const query = options?.queries?.[0] ?? "";
          if (query.startsWith("?name=pre-")) {
            return { tag: "t", records: [{ contents: "" }], traps: [] };
          }
          if (query.startsWith("?name=post-")) {
            return {
              tag: "t",
              records: [{ contents: "/interface bridge\nadd name=new-bridge\n" }],
              traps: [],
            };
          }
        }
        if (command === "/interface/bridge/print") {
          return { tag: "t", records: [{ ".id": "*1" }], traps: [] };
        }
        return { tag: "t", records: [], traps: [] };
      }
    );

    await expect(commitConfirm({ transport, fn: mockFn })).rejects.toThrow("invalid date");

    const calls = transport.execute.mock.calls;
    expect(mockFn).toHaveBeenCalledWith(transport);
    // Rolled back via the revert patch (resolve + remove) and cleaned up
    // the persisted backup file.
    expect(calls.some((c) => c[0] === "/interface/bridge/remove")).toBe(true);
    expect(calls.some((c) => c[0] === "/file/remove")).toBe(true);
  });
});
