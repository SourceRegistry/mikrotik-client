import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    parseTftpPacket,
    buildTftpData,
    buildTftpAck,
    buildTftpError,
    isSafeFilename,
    TftpServer,
    TFTP_BLOCK_SIZE,
    TFTP_PORT,
    TFTP_ERROR_CODES,
} from "./tftp";

// ── Mock dgram ─────────────────────────────────────────────────────────────────

type MockSocket = {
    on: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    _emit: (event: string, ...args: unknown[]) => void;
    _handlers: Record<string, ((...args: unknown[]) => void)[]>;
};

function makeMockSocket(): MockSocket {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const sock: MockSocket = {
        _handlers: handlers,
        _emit(event, ...args) {
            (handlers[event] ?? []).forEach((h) => h(...args));
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] ??= [];
            handlers[event]!.push(handler);
            return sock;
        }),
        send: vi.fn((_buf, _port, _addr, cb?: (err: Error | null) => void) => cb?.(null)),
        bind: vi.fn(() => {
            // Emit "listening" asynchronously
            Promise.resolve().then(() => sock._emit("listening"));
            return sock;
        }),
        close: vi.fn(),
    };
    return sock;
}

let mockSocket: MockSocket;

vi.mock("node:dgram", () => ({
    default: {
        createSocket: vi.fn(() => mockSocket),
    },
}));

beforeEach(() => {
    mockSocket = makeMockSocket();
    vi.clearAllMocks();
});

// ── parseTftpPacket ────────────────────────────────────────────────────────────

describe("parseTftpPacket", () => {
    it("parses RRQ", () => {
        const filename = "netinstall.img";
        const mode = "octet";
        const buf = new Uint8Array([
            0, 1, // opcode RRQ
            ...new TextEncoder().encode(filename), 0,
            ...new TextEncoder().encode(mode), 0,
        ]);
        const pkt = parseTftpPacket(buf);
        expect(pkt.type).toBe("rrq");
        if (pkt.type === "rrq") {
            expect(pkt.filename).toBe(filename);
            expect(pkt.mode).toBe(mode);
        }
    });

    it("parses WRQ", () => {
        const buf = new Uint8Array([
            0, 2,
            ...new TextEncoder().encode("file.txt"), 0,
            ...new TextEncoder().encode("netascii"), 0,
        ]);
        const pkt = parseTftpPacket(buf);
        expect(pkt.type).toBe("wrq");
    });

    it("parses DATA", () => {
        const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        const buf = new Uint8Array([0, 3, 0, 1, ...data]);
        const pkt = parseTftpPacket(buf);
        expect(pkt.type).toBe("data");
        if (pkt.type === "data") {
            expect(pkt.blockNumber).toBe(1);
            expect(Array.from(pkt.data)).toEqual(Array.from(data));
        }
    });

    it("parses ACK", () => {
        const buf = new Uint8Array([0, 4, 0, 42]);
        const pkt = parseTftpPacket(buf);
        expect(pkt.type).toBe("ack");
        if (pkt.type === "ack") {
            expect(pkt.blockNumber).toBe(42);
        }
    });

    it("parses ERROR", () => {
        const msg = "File not found";
        const buf = new Uint8Array([
            0, 5,
            0, TFTP_ERROR_CODES.fileNotFound,
            ...new TextEncoder().encode(msg), 0,
        ]);
        const pkt = parseTftpPacket(buf);
        expect(pkt.type).toBe("error");
        if (pkt.type === "error") {
            expect(pkt.errorCode).toBe(TFTP_ERROR_CODES.fileNotFound);
            expect(pkt.errorMessage).toBe(msg);
        }
    });

    it("throws on unknown opcode", () => {
        expect(() => parseTftpPacket(new Uint8Array([0, 99]))).toThrow(/Unknown/);
    });

    it("throws on too-short packet", () => {
        expect(() => parseTftpPacket(new Uint8Array([0]))).toThrow(/too short/);
    });

    it("throws on RRQ missing mode null terminator", () => {
        const buf = new Uint8Array([0, 1, ...new TextEncoder().encode("file"), 0, ...new TextEncoder().encode("octet")]);
        expect(() => parseTftpPacket(buf)).toThrow(/null terminator/);
    });

    it("parses ACK block number 0 (ACK for initial transfer)", () => {
        const buf = new Uint8Array([0, 4, 0, 0]);
        const pkt = parseTftpPacket(buf);
        expect(pkt.type).toBe("ack");
        if (pkt.type === "ack") expect(pkt.blockNumber).toBe(0);
    });
});

// ── buildTftpData ──────────────────────────────────────────────────────────────

describe("buildTftpData", () => {
    it("builds DATA packet with correct opcode", () => {
        const data = new Uint8Array(10).fill(0xab);
        const pkt = buildTftpData(1, data);
        expect(pkt[0]).toBe(0);
        expect(pkt[1]).toBe(3);
    });

    it("encodes block number big-endian", () => {
        const pkt = buildTftpData(0x0102, new Uint8Array(0));
        expect(pkt[2]).toBe(0x01);
        expect(pkt[3]).toBe(0x02);
    });

    it("includes payload after header", () => {
        const data = new Uint8Array([1, 2, 3]);
        const pkt = buildTftpData(1, data);
        expect(Array.from(pkt.slice(4))).toEqual([1, 2, 3]);
    });

    it("allows empty payload (final block signal)", () => {
        const pkt = buildTftpData(5, new Uint8Array(0));
        expect(pkt.length).toBe(4);
    });

    it("throws when data exceeds TFTP_BLOCK_SIZE", () => {
        expect(() => buildTftpData(1, new Uint8Array(513))).toThrow(/too large/);
    });

    it("round-trips through parseTftpPacket", () => {
        const data = new Uint8Array(100).fill(0xff);
        const raw = buildTftpData(7, data);
        const pkt = parseTftpPacket(raw);
        expect(pkt.type).toBe("data");
        if (pkt.type === "data") {
            expect(pkt.blockNumber).toBe(7);
            expect(pkt.data.length).toBe(100);
        }
    });
});

// ── buildTftpAck ───────────────────────────────────────────────────────────────

describe("buildTftpAck", () => {
    it("builds 4-byte ACK with correct opcode", () => {
        const pkt = buildTftpAck(3);
        expect(pkt.length).toBe(4);
        expect(pkt[1]).toBe(4);
    });

    it("encodes block number", () => {
        const pkt = buildTftpAck(255);
        expect(pkt[2]).toBe(0);
        expect(pkt[3]).toBe(255);
    });

    it("round-trips through parseTftpPacket", () => {
        const raw = buildTftpAck(42);
        const parsed = parseTftpPacket(raw);
        expect(parsed.type).toBe("ack");
        if (parsed.type === "ack") expect(parsed.blockNumber).toBe(42);
    });
});

// ── buildTftpError ─────────────────────────────────────────────────────────────

describe("buildTftpError", () => {
    it("builds ERROR packet with correct opcode", () => {
        const pkt = buildTftpError(TFTP_ERROR_CODES.fileNotFound, "Not found");
        expect(pkt[1]).toBe(5);
    });

    it("encodes error code", () => {
        const pkt = buildTftpError(2, "Access denied");
        expect(pkt[2]).toBe(0);
        expect(pkt[3]).toBe(2);
    });

    it("null-terminates error message", () => {
        const pkt = buildTftpError(1, "msg");
        expect(pkt[pkt.length - 1]).toBe(0);
    });

    it("round-trips through parseTftpPacket", () => {
        const raw = buildTftpError(TFTP_ERROR_CODES.accessViolation, "denied");
        const parsed = parseTftpPacket(raw);
        expect(parsed.type).toBe("error");
        if (parsed.type === "error") {
            expect(parsed.errorCode).toBe(TFTP_ERROR_CODES.accessViolation);
            expect(parsed.errorMessage).toBe("denied");
        }
    });
});

// ── isSafeFilename ─────────────────────────────────────────────────────────────

describe("isSafeFilename", () => {
    it("accepts normal filenames", () => {
        expect(isSafeFilename("netinstall.img")).toBe(true);
        expect(isSafeFilename("boot-7.14.npk")).toBe(true);
    });

    it("rejects path traversal", () => {
        expect(isSafeFilename("../etc/passwd")).toBe(false);
        expect(isSafeFilename("foo/../../secret")).toBe(false);
    });

    it("rejects absolute paths", () => {
        expect(isSafeFilename("/etc/passwd")).toBe(false);
        expect(isSafeFilename("\\windows\\system32")).toBe(false);
    });

    it("rejects empty string", () => {
        expect(isSafeFilename("")).toBe(false);
    });

    it("rejects null byte", () => {
        expect(isSafeFilename("file\0name")).toBe(false);
    });
});

// ── TftpServer ─────────────────────────────────────────────────────────────────

describe("TftpServer", () => {
    function makeImage(size: number): Buffer {
        return Buffer.alloc(size, 0xaa);
    }

    function makeRrq(filename: string): Buffer {
        return Buffer.from([
            0, 1,
            ...new TextEncoder().encode(filename), 0,
            ...new TextEncoder().encode("octet"), 0,
        ]);
    }

    function makeAck(block: number): Buffer {
        return Buffer.from([0, 4, (block >> 8) & 0xff, block & 0xff]);
    }

    it("listens on TFTP_PORT by default", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10) });
        await server.listen();
        const dgram = await import("node:dgram");
        expect(dgram.default.createSocket).toHaveBeenCalled();
        expect(mockSocket.bind).toHaveBeenCalledWith(TFTP_PORT);
        server.close();
    });

    it("listens on custom port", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10) });
        await server.listen(16969);
        expect(mockSocket.bind).toHaveBeenCalledWith(16969);
        server.close();
    });

    it("emits request event on valid RRQ", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10) });
        const requestEvents: unknown[] = [];
        server.on("request", (e) => requestEvents.push(e));
        await server.listen();

        mockSocket._emit("message", makeRrq("netinstall.img"), { address: "10.0.0.1", port: 1234 });
        expect(requestEvents).toHaveLength(1);
        server.close();
    });

    it("sends DATA block 1 on RRQ", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10) });
        await server.listen();
        mockSocket._emit("message", makeRrq("netinstall.img"), { address: "10.0.0.1", port: 1234 });

        expect(mockSocket.send).toHaveBeenCalled();
        const firstCall = mockSocket.send.mock.calls[0];
        const sentBuf = firstCall![0] as Uint8Array;
        expect(sentBuf[1]).toBe(3); // DATA opcode
        expect(sentBuf[2]).toBe(0);
        expect(sentBuf[3]).toBe(1); // block 1
        server.close();
    });

    it("rejects unsafe filename with ERROR packet", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10) });
        await server.listen();
        mockSocket._emit("message", makeRrq("../etc/passwd"), { address: "10.0.0.1", port: 1234 });

        const errorCall = mockSocket.send.mock.calls[0];
        const sentBuf = errorCall![0] as Uint8Array;
        expect(sentBuf[1]).toBe(5); // ERROR opcode
        server.close();
    });

    it("rejects disallowed filename when allowedFilename set", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10), allowedFilename: "boot.img" });
        await server.listen();
        mockSocket._emit("message", makeRrq("other.img"), { address: "10.0.0.1", port: 1234 });

        const errorCall = mockSocket.send.mock.calls[0];
        const sentBuf = errorCall![0] as Uint8Array;
        expect(sentBuf[1]).toBe(5); // ERROR
        server.close();
    });

    it("emits progress on ACK and sends next block", async () => {
        const image = makeImage(TFTP_BLOCK_SIZE + 100); // 2 blocks
        const server = new TftpServer({ imageBuffer: image });
        const progressEvents: unknown[] = [];
        server.on("progress", (e) => progressEvents.push(e));
        await server.listen();

        const rinfo = { address: "10.0.0.1", port: 1234 };
        mockSocket._emit("message", makeRrq("boot.img"), rinfo);

        // ACK block 1
        mockSocket._emit("message", makeAck(1), rinfo);

        expect(progressEvents).toHaveLength(1);
        // Should have sent block 2 now
        const calls = mockSocket.send.mock.calls;
        const block2 = calls.find((c) => {
            const b = c[0] as Uint8Array;
            return b[1] === 3 && b[3] === 2;
        });
        expect(block2).toBeDefined();
        server.close();
    });

    it("emits complete when final partial block is ACKed", async () => {
        const image = makeImage(100); // < TFTP_BLOCK_SIZE → 1 block
        const server = new TftpServer({ imageBuffer: image });
        const completeEvents: unknown[] = [];
        server.on("complete", () => completeEvents.push(true));
        await server.listen();

        const rinfo = { address: "10.0.0.1", port: 1234 };
        mockSocket._emit("message", makeRrq("boot.img"), rinfo);
        mockSocket._emit("message", makeAck(1), rinfo);

        expect(completeEvents).toHaveLength(1);
        server.close();
    });

    it("ignores stale ACK for wrong block", async () => {
        const image = makeImage(TFTP_BLOCK_SIZE + 10);
        const server = new TftpServer({ imageBuffer: image });
        const progressEvents: unknown[] = [];
        server.on("progress", (e) => progressEvents.push(e));
        await server.listen();

        const rinfo = { address: "10.0.0.1", port: 1234 };
        mockSocket._emit("message", makeRrq("boot.img"), rinfo);
        // Send stale ACK for block 99 (not block 1)
        mockSocket._emit("message", makeAck(99), rinfo);

        expect(progressEvents).toHaveLength(0);
        server.close();
    });

    it("close() removes socket", async () => {
        const server = new TftpServer({ imageBuffer: makeImage(10) });
        await server.listen();
        server.close();
        expect(mockSocket.close).toHaveBeenCalled();
    });
});
