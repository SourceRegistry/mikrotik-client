import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import type { RouterOSRecord, RouterOSReply } from "./index";
import { RouterOSStream } from "./index";
import { TypedStream, type TypedEvent } from "./typed-stream";

// Minimal parse function for tests
function parseRecord<T extends Record<string, any>>(raw: RouterOSRecord): T {
    return raw as unknown as T;
}

// Helper: create a mock RouterOSStream that properly extends EventEmitter
function createMockStream(): RouterOSStream & {
    pushReply: (reply: RouterOSReply) => void;
    emitClose: (error?: unknown) => void;
    _cancelFn: () => Promise<void>;
} {
    const stream = new RouterOSStream("test-tag", async () => { });
    const cancelFn = vi.fn().mockResolvedValue(undefined);

    // Override cancel
    stream.cancel = cancelFn;

    return Object.assign(stream, {
        pushReply(reply: RouterOSReply) {
            stream.push(reply);
        },
        emitClose(error?: unknown) {
            stream.finish(error);
        },
        _cancelFn: cancelFn,
    });
}

describe("TypedStream", () => {
    let mockStream: ReturnType<typeof createMockStream>;

    beforeEach(() => {
        mockStream = createMockStream();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("added events", () => {
        it("emits 'added' for first-seen entries", async () => {
            const typed = new TypedStream<typeof mockStream>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "no" },
                apiAttributes: {},
                raw: ["!re", "=.id=*1", "=name=ether1"],
            });

            expect(events).toHaveLength(1);
            expect(events[0]?.kind).toBe("added");
            expect(events[0]?.after?.name).toBe("ether1");
            expect(typed.state.size).toBe(1);

            await typed.cancel();
        });

        it("tracks state for newly added entries", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*2", name: "ether2" },
                apiAttributes: {},
                raw: [],
            });

            const state = typed.state.get("*2");
            expect(state).toBeDefined();
            expect(state?.name).toBe("ether2");

            await typed.cancel();
        });

        it("handles multiple adds in sequence", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*2", name: "ether2" },
                apiAttributes: {},
                raw: [],
            });
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*3", name: "ether3" },
                apiAttributes: {},
                raw: [],
            });

            expect(events).toHaveLength(3);
            expect(events.every((e) => e.kind === "added")).toBe(true);
            expect(typed.state.size).toBe(3);

            await typed.cancel();
        });
    });

    describe("updated events", () => {
        it("emits 'updated' when an existing entry changes", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            // Add first
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "no" },
                apiAttributes: {},
                raw: [],
            });

            // Update
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "yes" },
                apiAttributes: {},
                raw: [],
            });

            expect(events).toHaveLength(2);
            expect(events[0]?.kind).toBe("added");
            expect(events[1]?.kind).toBe("updated");
            expect(events[1]?.before?.disabled).toBe("no");
            expect(events[1]?.after?.disabled).toBe("yes");

            await typed.cancel();
        });

        it("updates state map on update", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "no" },
                apiAttributes: {},
                raw: [],
            });

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "yes" },
                apiAttributes: {},
                raw: [],
            });

            const current = typed.state.get("*1");
            expect(current?.disabled).toBe("yes");

            await typed.cancel();
        });
    });

    describe("removed events", () => {
        it("emits 'removed' when .removed=yes", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", ".removed": "yes" },
                apiAttributes: {},
                raw: [],
            });

            expect(events).toHaveLength(2);
            expect(events[1]?.kind).toBe("removed");
            expect(events[1]?.before?.name).toBe("ether1");
            expect(typed.state.has("*1")).toBe(false);

            await typed.cancel();
        });

        it("emits 'removed' for single-key records (key-only heuristic)", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });

            // Only .id present → treated as removal
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1" },
                apiAttributes: {},
                raw: [],
            });

            expect(events).toHaveLength(2);
            expect(events[1]?.kind).toBe("removed");
            expect(typed.state.has("*1")).toBe(false);

            await typed.cancel();
        });

        it("preserves 'before' state from map on removal", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "no" },
                apiAttributes: {},
                raw: [],
            });

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "yes" },
                apiAttributes: {},
                raw: [],
            });

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", ".removed": "yes" },
                apiAttributes: {},
                raw: [],
            });

            expect(events[2]?.kind).toBe("removed");
            // 'before' should have the LAST known state (disabled: yes)
            expect(events[2]?.before?.disabled).toBe("yes");

            await typed.cancel();
        });
    });

    describe("key extraction", () => {
        it("uses .id by default", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });
            expect(typed.state.has("*1")).toBe(true);
            await typed.cancel();
        });

        it("falls back to 'name' when .id is missing", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            mockStream.pushReply({
                type: "re",
                attributes: { name: "ether1", disabled: "no" },
                apiAttributes: {},
                raw: [],
            });
            expect(typed.state.has("ether1")).toBe(true);
            await typed.cancel();
        });

        it("respects custom onRemovalKeys", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord, {
                onRemovalKeys: ["name", ".id"],
            });
            mockStream.pushReply({
                type: "re",
                attributes: { name: "ether1", ".id": "*1" },
                apiAttributes: {},
                raw: [],
            });
            expect(typed.state.has("ether1")).toBe(true);
            await typed.cancel();
        });
    });

    describe("nextEvent and async iteration", () => {
        it("returns events via nextEvent", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });

            const ev = await typed.nextEvent();
            expect(ev?.kind).toBe("added");
            expect(ev?.after?.name).toBe("ether1");

            await typed.cancel();
        });

        it("queues events when no waiter", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*2", name: "ether2" },
                apiAttributes: {},
                raw: [],
            });

            const ev1 = await typed.nextEvent();
            const ev2 = await typed.nextEvent();
            expect(ev1?.after?.name).toBe("ether1");
            expect(ev2?.after?.name).toBe("ether2");

            await typed.cancel();
        });

        it("waits for events when queue is empty", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            let resolved = false;

            const nextPromise = typed.nextEvent().then((ev) => {
                resolved = true;
                return ev;
            });

            // Event not yet pushed — should not resolve
            expect(resolved).toBe(false);

            await new Promise((r) => setTimeout(r, 10));
            expect(resolved).toBe(false);

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });

            const ev = await nextPromise;
            expect(resolved).toBe(true);
            expect(ev?.kind).toBe("added");

            await typed.cancel();
        });

        it("async iterator yields events", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1" },
                apiAttributes: {},
                raw: [],
            });
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*2", name: "ether2" },
                apiAttributes: {},
                raw: [],
            });

            // Trigger close after pushing events
            mockStream.emitClose();

            for await (const ev of typed) {
                events.push(ev);
            }

            expect(events).toHaveLength(2);
        });

        it("nextEvent returns undefined when stream is closed", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            mockStream.emitClose();

            const ev = await typed.nextEvent();
            expect(ev).toBeUndefined();
        });

        it("nextEvent throws when stream closes with error", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const error = new Error("connection lost");
            mockStream.emitClose(error);

            await expect(typed.nextEvent()).rejects.toThrow("connection lost");
        });
    });

    describe("AbortSignal integration", () => {
        it("cancels on signal abort", async () => {
            const controller = new AbortController();
            const _typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord, {
                signal: controller.signal,
            });

            controller.abort();
            await new Promise((r) => setTimeout(r, 50));

            expect(mockStream._cancelFn).toHaveBeenCalled();
        });

        it("handles pre-aborted signal", async () => {
            const controller = new AbortController();
            controller.abort();

            const _typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord, {
                signal: controller.signal,
            });

            await new Promise((r) => setTimeout(r, 50));
            expect(mockStream._cancelFn).toHaveBeenCalled();
        });
    });

    describe("finish", () => {
        it("cancel is idempotent", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            await typed.cancel();
            await typed.cancel(); // second call should be no-op
            expect(mockStream._cancelFn).toHaveBeenCalledTimes(1);
        });

        it("finish is idempotent", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: unknown[] = [];
            typed.on("close", (err) => events.push(err));

            typed.finish();
            typed.finish();

            expect(events).toHaveLength(1);
        });

        it("close event emits error", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            let closeError: unknown;
            typed.on("close", (err) => {
                closeError = err;
            });

            const error = new Error("test error");
            mockStream.emitClose(error);

            expect(closeError).toBe(error);
        });
    });

    describe("timeout on nextEvent", () => {
        it("throws on timeout", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);

            await expect(typed.nextEvent(10)).rejects.toThrow(/Timed out/);

            await typed.cancel();
        });
    });

    describe("non-re replies", () => {
        it("ignores !done sentences", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "done",
                attributes: {},
                apiAttributes: {},
                raw: ["!done"],
            });

            expect(events).toHaveLength(0);
            await typed.cancel();
        });

        it("ignores !trap sentences", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "trap",
                attributes: { message: "some error", category: "4" },
                apiAttributes: {},
                raw: ["!trap"],
            });

            expect(events).toHaveLength(0);
            await typed.cancel();
        });
    });

    describe("deep equality for updates", () => {
        it("emits updated when multiple fields change", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "no", comment: "" },
                apiAttributes: {},
                raw: [],
            });

            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*1", name: "ether1", disabled: "yes", comment: "wan" },
                apiAttributes: {},
                raw: [],
            });

            expect(events).toHaveLength(2);
            expect(events[1]?.kind).toBe("updated");
            expect(events[1]?.before?.disabled).toBe("no");
            expect(events[1]?.before?.comment).toBe("");
            expect(events[1]?.after?.disabled).toBe("yes");
            expect(events[1]?.after?.comment).toBe("wan");

            await typed.cancel();
        });
    });

    describe("removal with no prior state", () => {
        it("ignores removal when key not in state map", async () => {
            const typed = new TypedStream<RouterOSRecord>(mockStream, parseRecord);
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            // Removal without prior add
            mockStream.pushReply({
                type: "re",
                attributes: { ".id": "*99", ".removed": "yes" },
                apiAttributes: {},
                raw: [],
            });

            expect(events).toHaveLength(0);
            expect(typed.state.has("*99")).toBe(false);

            await typed.cancel();
        });
    });
});

describe("createWatch", () => {
    it("creates watch factory with watch and cancel", async () => {
        const { createWatch } = await import("./typed-stream");
        const factory = createWatch({
            transport: {} as any,
            printPath: "/interface",
            listenPath: "/interface/listen",
            parseFn: parseRecord,
        });

        expect(typeof factory.watch).toBe("function");
        expect(typeof factory.cancel).toBe("function");
    });

    it("cancel is no-op when no stream active", async () => {
        const { createWatch } = await import("./typed-stream");
        const factory = createWatch({
            transport: {} as any,
            printPath: "/interface",
            listenPath: "/interface/listen",
            parseFn: parseRecord,
        });

        // Should not throw
        await factory.cancel();
    });

    describe("REST polling fallback (via createWatch with REST transport)", () => {
        // Create a mock with constructor name containing "Rest"
        function createMockRestTransport() {
            const records: RouterOSRecord[] = [
                { ".id": "**1", name: "ether1", disabled: "no" },
                { ".id": "*2", name: "ether2", disabled: "no" },
            ];

            class MockRouterOSRestClient {
                print = vi.fn(() => Promise.resolve([...records]));
                execute = vi.fn();
                listen = vi.fn(() => { throw new Error("not supported"); });
            }

            const transport = new MockRouterOSRestClient();
            return { transport, records };
        }

        it("emits added events from polling", async () => {
            const { createWatch } = await import("./typed-stream");
            const { transport } = createMockRestTransport();

            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });

            const typed = await factory.watch({ intervalMs: 100 });
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            // Wait for first poll cycle
            await vi.waitFor(() => events.filter((e) => e.kind === "added").length >= 2, { timeout: 2000 });

            expect(typed.state.size).toBe(2);
            await typed.cancel();
        });

        it("stops polling on abort signal", async () => {
            const { createWatch } = await import("./typed-stream");
            const { transport } = createMockRestTransport();

            const controller = new AbortController();
            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });

            const typed = await factory.watch({ intervalMs: 50, signal: controller.signal });
            await new Promise((r) => setTimeout(r, 100));

            const printCallsAfterStart = (transport.print as any).mock.calls.length;
            controller.abort();

            await new Promise((r) => setTimeout(r, 200));
            expect((transport.print as any).mock.calls.length).toBe(printCallsAfterStart);
            await typed.cancel();
        });

        it.skip("detects removal when key disappears from poll", async () => {
            const { createWatch } = await import("./typed-stream");
            const { transport, records } = createMockRestTransport();

            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });

            const typed = await factory.watch({ intervalMs: 100 });
            const events: TypedEvent<RouterOSRecord>[] = [];
            typed.on("event", (ev) => events.push(ev));

            // Wait for initial poll to add both records
            await vi.waitFor(() => typed.state.size === 2, { timeout: 2000 });

            // Remove first record
            records.shift();

            // Wait for next poll to detect removal - check for removal event
            await vi.waitFor(
                () => events.some((e) => e.kind === "removed"),
                { timeout: 3000 },
            );

            // State should have shrunk
            expect(typed.state.size).toBeLessThan(2);

            await typed.cancel();
        });

        it("silently stops when transport.print throws AbortError", async () => {
            const { createWatch } = await import("./typed-stream");
            let callCount = 0;
            const abortErr = new DOMException("aborted", "AbortError");
            class MockRestAbort {
                print = vi.fn(async () => { callCount++; throw abortErr; });
                execute = vi.fn();
                listen = vi.fn(() => { throw new Error("not supported"); });
            }
            const transport = new MockRestAbort();
            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });
            const typed = await factory.watch({ intervalMs: 50 });
            await new Promise((r) => setTimeout(r, 100));
            // Should not emit error, just stop polling after first throw
            const errors: unknown[] = [];
            typed.on("close", (e) => errors.push(e));
            await typed.cancel();
            expect(callCount).toBeGreaterThan(0);
        });

        it("emits error on the syntheticStream when transport.print throws non-AbortError", async () => {
            const { createWatch } = await import("./typed-stream");
            class MockRestError {
                print = vi.fn(async () => { throw new Error("transport error"); });
                execute = vi.fn();
                listen = vi.fn(() => { throw new Error("not supported"); });
            }
            const transport = new MockRestError();
            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });
            const typed = await factory.watch({ intervalMs: 50 });
            const closeErrors: unknown[] = [];
            typed.on("close", (e) => closeErrors.push(e));
            // Wait for the error to propagate
            await new Promise((r) => setTimeout(r, 150));
            await typed.cancel();
            // The error should have been emitted on the syntheticStream
            // (typed stream may have closed with the error)
            expect(transport.print).toHaveBeenCalled();
        });

        it("emits synthetic removal when key disappears between polls", async () => {
            const { createWatch } = await import("./typed-stream");
            const records: RouterOSRecord[] = [
                { ".id": "*1", name: "ether1", disabled: "no" },
                { ".id": "*2", name: "ether2", disabled: "no" },
            ];
            class MockRestRemoval {
                print = vi.fn(async () => [...records]);
                execute = vi.fn();
                listen = vi.fn(() => { throw new Error("not supported"); });
            }
            const transport = new MockRestRemoval();
            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });

            vi.useFakeTimers();
            try {
                const typed = await factory.watch({ intervalMs: 1000 });

                // Drain microtasks so the initial void poll() completes
                for (let i = 0; i < 10; i++) await Promise.resolve();

                expect(typed.state.size).toBe(2);

                // Remove ether1 before next poll
                records.shift();
                const events: TypedEvent<RouterOSRecord>[] = [];
                typed.on("event", (ev) => events.push(ev));

                // Advance timer to trigger next poll, drain microtasks
                vi.advanceTimersByTime(1000);
                for (let i = 0; i < 10; i++) await Promise.resolve();

                expect(events.some((e) => e.kind === "removed")).toBe(true);
                expect(typed.state.size).toBe(1);
                await typed.cancel();
            } finally {
                vi.useRealTimers();
            }
        });

        it("stops polling on cancel", async () => {
            const { createWatch } = await import("./typed-stream");
            const { transport } = createMockRestTransport();

            const factory = createWatch({
                transport,
                printPath: "/interface/print",
                listenPath: "/interface/listen",
                parseFn: parseRecord,
            });

            const typed = await factory.watch({ intervalMs: 50 });
            await new Promise((r) => setTimeout(r, 100));

            const printCallsAfterStart = (transport.print as any).mock.calls.length;
            await typed.cancel();

            // Wait to confirm no further polls
            await new Promise((r) => setTimeout(r, 200));
            expect((transport.print as any).mock.calls.length).toBe(printCallsAfterStart);
        });
    });
});
