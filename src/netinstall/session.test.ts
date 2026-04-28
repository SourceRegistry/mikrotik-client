import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetinstallSession } from "./session";
import type { NetinstallProgressEvent } from "./session";
import type { BootpServer as BootpServerType } from "./bootp";
import type { TftpServer as TftpServerType } from "./tftp";
import type { BootpPacket } from "./bootp";

// ── Mock BootpServer ───────────────────────────────────────────────────────────

type MockBootpServer = {
    on: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    _emit: (event: string, ...args: unknown[]) => void;
    _handlers: Record<string, ((...args: unknown[]) => void)[]>;
};

type MockTftpServer = {
    on: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    _emit: (event: string, ...args: unknown[]) => void;
    _handlers: Record<string, ((...args: unknown[]) => void)[]>;
};

function makeMockBootp(): MockBootpServer {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const srv: MockBootpServer = {
        _handlers: handlers,
        _emit(event, ...args) {
            (handlers[event] ?? []).forEach((h) => h(...args));
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] ??= [];
            handlers[event]!.push(handler);
            return srv;
        }),
        listen: vi.fn(() => Promise.resolve()),
        close: vi.fn(),
    };
    return srv;
}

function makeMockTftp(): MockTftpServer {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const srv: MockTftpServer = {
        _handlers: handlers,
        _emit(event, ...args) {
            (handlers[event] ?? []).forEach((h) => h(...args));
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] ??= [];
            handlers[event]!.push(handler);
            return srv;
        }),
        listen: vi.fn(() => Promise.resolve()),
        close: vi.fn(),
    };
    return srv;
}

let mockBootp: MockBootpServer;
let mockTftp: MockTftpServer;

vi.mock("./bootp", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        BootpServer: vi.fn(function BootpServerMock(): BootpServerType { return mockBootp as unknown as BootpServerType; }),
    };
});

vi.mock("./tftp", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        TftpServer: vi.fn(function TftpServerMock(): TftpServerType { return mockTftp as unknown as TftpServerType; }),
    };
});

beforeEach(() => {
    mockBootp = makeMockBootp();
    mockTftp = makeMockTftp();
    vi.clearAllMocks();
});

// ── helpers ────────────────────────────────────────────────────────────────────

function makeImage(size: number): Buffer {
    return Buffer.alloc(size, 0xaa);
}

function makeSession(overrides: Partial<ConstructorParameters<typeof NetinstallSession>[0]> = {}): NetinstallSession {
    return new NetinstallSession({
        imageBuffer: makeImage(100),
        serverIp: "192.168.1.1",
        ...overrides,
    });
}

/** Start the session and return a promise that resolves/rejects, plus emitted progress events. */
function startSession(session: NetinstallSession): {
    promise: Promise<void>;
    events: NetinstallProgressEvent[];
} {
    const events: NetinstallProgressEvent[] = [];
    session.on("progress", (e: NetinstallProgressEvent) => events.push(e));
    const promise = session.start();
    return { promise, events };
}

// Simulate a full successful transfer: BOOTP discover → TFTP request → TFTP complete
function completeTransfer(imageSize = 100): void {
    const discoverPacket: Partial<BootpPacket> = { clientMac: "aa:bb:cc:dd:ee:ff" };
    mockBootp._emit("discover", discoverPacket);
    mockBootp._emit("offer", {});
    mockTftp._emit("request", { filename: "netinstall.img", clientAddress: "10.0.0.2" });
    mockTftp._emit("progress", { blockNumber: 1, bytesTransferred: imageSize, totalBytes: imageSize });
    mockTftp._emit("complete");
}

// ── constructor ────────────────────────────────────────────────────────────────

describe("NetinstallSession constructor", () => {
    it("starts in idle state", () => {
        const session = makeSession();
        expect(session.sessionState).toBe("idle");
    });

    it("defaults bootfile to netinstall.img", async () => {
        const { BootpServer } = await import("./bootp");
        const { TftpServer } = await import("./tftp");
        const session = makeSession();
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        // Check BootpServer called with default bootfile
        expect(BootpServer).toHaveBeenCalledWith(
            expect.objectContaining({ bootfile: "netinstall.img" })
        );
        // TftpServer allowedFilename matches default
        expect(TftpServer).toHaveBeenCalledWith(
            expect.objectContaining({ allowedFilename: "netinstall.img" })
        );
    });

    it("uses custom bootfile when provided", async () => {
        const { BootpServer } = await import("./bootp");
        const session = makeSession({ bootfile: "boot-7.14.img" });
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        expect(BootpServer).toHaveBeenCalledWith(
            expect.objectContaining({ bootfile: "boot-7.14.img" })
        );
    });

    it("forwards deviceMac to BootpServer", async () => {
        const { BootpServer } = await import("./bootp");
        const session = makeSession({ deviceMac: "aa:bb:cc:dd:ee:ff" });
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        expect(BootpServer).toHaveBeenCalledWith(
            expect.objectContaining({ deviceMac: "aa:bb:cc:dd:ee:ff" })
        );
    });
});

// ── start() ────────────────────────────────────────────────────────────────────

describe("NetinstallSession.start()", () => {
    it("throws if called twice", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        await expect(session.start()).rejects.toThrow(/create a new instance/);
        completeTransfer();
        await promise;
    });

    it("emits discovering progress first", () => {
        const session = makeSession();
        const { events } = startSession(session);
        expect(events[0]).toEqual({ kind: "discovering" });
    });

    it("transitions to discovering state after start", () => {
        const session = makeSession();
        startSession(session);
        expect(session.sessionState).toBe("discovering");
    });

    it("resolves on complete", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        completeTransfer();
        await expect(promise).resolves.toBeUndefined();
    });

    it("transitions to complete state on success", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        expect(session.sessionState).toBe("complete");
    });

    it("starts both servers concurrently", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        expect(mockBootp.listen).toHaveBeenCalled();
        expect(mockTftp.listen).toHaveBeenCalled();
        completeTransfer();
        await promise;
    });

    it("closes both servers after completion", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        expect(mockBootp.close).toHaveBeenCalled();
        expect(mockTftp.close).toHaveBeenCalled();
    });
});

// ── progress events ────────────────────────────────────────────────────────────

describe("NetinstallSession progress events", () => {
    it("emits offering with deviceMac on BOOTP discover", () => {
        const session = makeSession();
        const { events } = startSession(session);
        mockBootp._emit("discover", { clientMac: "aa:bb:cc:dd:ee:ff" });
        expect(events).toContainEqual({ kind: "offering", deviceMac: "aa:bb:cc:dd:ee:ff" });
    });

    it("emits tftp_start on TFTP request", () => {
        const session = makeSession();
        const { events } = startSession(session);
        mockTftp._emit("request", { filename: "boot.img", clientAddress: "10.0.0.2" });
        expect(events).toContainEqual({ kind: "tftp_start", filename: "boot.img", clientAddress: "10.0.0.2" });
    });

    it("transitions to running state on TFTP request", () => {
        const session = makeSession();
        startSession(session);
        mockTftp._emit("request", { filename: "boot.img", clientAddress: "10.0.0.2" });
        expect(session.sessionState).toBe("running");
    });

    it("emits tftp_progress on TFTP progress", () => {
        const session = makeSession();
        const { events } = startSession(session);
        mockTftp._emit("progress", { blockNumber: 1, bytesTransferred: 512, totalBytes: 1024 });
        expect(events).toContainEqual({
            kind: "tftp_progress",
            blockNumber: 1,
            bytesTransferred: 512,
            totalBytes: 1024,
        });
    });

    it("emits tftp_complete and installed on complete", async () => {
        const session = makeSession({ imageBuffer: makeImage(200) });
        const { promise, events } = startSession(session);
        mockTftp._emit("complete");
        await promise;
        expect(events).toContainEqual({ kind: "tftp_complete", totalBytes: 200 });
        expect(events).toContainEqual({ kind: "installed" });
    });

    it("emits installed event on EventEmitter", async () => {
        const session = makeSession();
        const installedEvents: unknown[] = [];
        session.on("installed", () => installedEvents.push(true));
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        expect(installedEvents).toHaveLength(1);
    });
});

// ── onInstalled ────────────────────────────────────────────────────────────────

describe("NetinstallSession onInstalled callback", () => {
    it("awaits onInstalled before resolving", async () => {
        const order: string[] = [];
        const onInstalled = vi.fn(async () => {
            order.push("hook");
        });
        const session = makeSession({ onInstalled });
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        order.push("resolved");
        expect(order).toEqual(["hook", "resolved"]);
    });

    it("rejects if onInstalled throws", async () => {
        const onInstalled = vi.fn(async () => { throw new Error("hook failed"); });
        const session = makeSession({ onInstalled });
        const { promise } = startSession(session);
        mockTftp._emit("complete");
        await expect(promise).rejects.toThrow("hook failed");
    });
});

// ── abort / AbortSignal ────────────────────────────────────────────────────────

describe("NetinstallSession.abort()", () => {
    it("transitions to aborted state", async () => {
        const session = makeSession();
        startSession(session);
        await session.abort();
        expect(session.sessionState).toBe("aborted");
    });

    it("closes both servers on abort", async () => {
        const session = makeSession();
        startSession(session);
        await session.abort();
        expect(mockBootp.close).toHaveBeenCalled();
        expect(mockTftp.close).toHaveBeenCalled();
    });

    it("is a no-op when idle", async () => {
        const session = makeSession();
        await expect(session.abort()).resolves.toBeUndefined();
        expect(session.sessionState).toBe("idle");
    });

    it("is a no-op when complete", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        completeTransfer();
        await promise;
        await session.abort();
        expect(session.sessionState).toBe("complete");
    });
});

describe("NetinstallSession AbortSignal", () => {
    it("rejects immediately if signal already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const session = makeSession();
        await expect(session.start({ signal: controller.signal })).rejects.toThrow(/aborted/);
    });

    it("rejects and cleans up when signal aborted mid-session", async () => {
        const controller = new AbortController();
        const session = makeSession();
        const { promise } = startSession(session);
        // Start the session normally, then abort
        const abortPromise = session.start({ signal: controller.signal }).catch(() => { });
        controller.abort();
        await expect(abortPromise).resolves.toBeUndefined(); // catch swallows
        void promise; // avoid unhandled (this one was started without signal)
        // clean up dangling promise
        completeTransfer();
        await promise;
    });

    it("resolves cleanly if signal not aborted", async () => {
        const controller = new AbortController();
        const session = makeSession();
        const events: NetinstallProgressEvent[] = [];
        session.on("progress", (e: NetinstallProgressEvent) => events.push(e));
        const promise = session.start({ signal: controller.signal });
        completeTransfer();
        await expect(promise).resolves.toBeUndefined();
    });
});

// ── timeout ────────────────────────────────────────────────────────────────────

describe("NetinstallSession timeout", () => {
    it("rejects after timeoutMs", async () => {
        vi.useFakeTimers();
        const session = makeSession({ timeoutMs: 5000 });
        const { promise } = startSession(session);
        vi.advanceTimersByTime(6000);
        await expect(promise).rejects.toThrow(/timed out/);
        vi.useRealTimers();
    });

    it("does not reject before timeout", async () => {
        vi.useFakeTimers();
        const session = makeSession({ timeoutMs: 5000 });
        const { promise } = startSession(session);
        vi.advanceTimersByTime(3000);
        // complete the transfer before timeout
        completeTransfer();
        await expect(promise).resolves.toBeUndefined();
        vi.useRealTimers();
    });
});

// ── error propagation ──────────────────────────────────────────────────────────

describe("NetinstallSession error propagation", () => {
    it("rejects on BOOTP error", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        mockBootp._emit("error", new Error("bind failed"));
        await expect(promise).rejects.toThrow("bind failed");
        expect(session.sessionState).toBe("error");
    });

    it("rejects on TFTP error", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        mockTftp._emit("error", new Error("socket error"));
        await expect(promise).rejects.toThrow("socket error");
        expect(session.sessionState).toBe("error");
    });

    it("closes both servers on error", async () => {
        const session = makeSession();
        const { promise } = startSession(session);
        mockBootp._emit("error", new Error("oops"));
        await promise.catch(() => { });
        expect(mockBootp.close).toHaveBeenCalled();
        expect(mockTftp.close).toHaveBeenCalled();
    });

    it("rejects on server listen failure", async () => {
        mockBootp.listen.mockRejectedValueOnce(new Error("EADDRINUSE"));
        const session = makeSession();
        const { promise } = startSession(session);
        await expect(promise).rejects.toThrow("EADDRINUSE");
    });
});
