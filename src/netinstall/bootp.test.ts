import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    parseBootpPacket,
    buildDhcpOffer,
    getMessageType,
    BootpServer,
    BOOTP_HEADER_LEN,
    BOOTP_MAGIC_COOKIE,
} from "./bootp";

// ── BootpServer mock helpers ───────────────────────────────────────────────

type MockDgramSocket = {
    on: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setBroadcast: ReturnType<typeof vi.fn>;
    _handlers: Record<string, ((...args: unknown[]) => void)[]>;
    _emit: (event: string, ...args: unknown[]) => void;
};

function makeMockDgramSocket(bindBehavior: "ok" | "setBroadcastError" = "ok"): MockDgramSocket {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const sock: MockDgramSocket = {
        _handlers: handlers,
        _emit(event, ...args) { (handlers[event] ?? []).forEach(h => h(...args)); },
        on: vi.fn((ev: string, h: (...a: unknown[]) => void) => { handlers[ev] ??= []; handlers[ev]!.push(h); return sock; }),
        send: vi.fn((_data, _port, _addr, cb?: (e: Error | null) => void) => cb?.(null)),
        setBroadcast: vi.fn(() => {
            if (bindBehavior === "setBroadcastError") throw new Error("setBroadcast failed");
        }),
        bind: vi.fn(() => {
            Promise.resolve().then(() => sock._emit("listening"));
        }),
        close: vi.fn(),
    };
    return sock;
}

let mockDgramSocket: MockDgramSocket;

vi.mock("node:dgram", () => ({
    default: { createSocket: vi.fn(() => mockDgramSocket) },
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- unavoidable in vi.mock() context: circular deps prevent static import
type DgramSocketType = ReturnType<typeof import("node:dgram").default["createSocket"]>;

beforeEach(async () => {
    mockDgramSocket = makeMockDgramSocket();
    vi.mocked((await import("node:dgram")).default.createSocket).mockReturnValue(
        mockDgramSocket as unknown as DgramSocketType
    );
});

describe("parseBootpPacket", () => {
    it("parses a DHCP DISCOVER packet", () => {
        // Build a minimal DHCP DISCOVER
        const packet = buildTestDiscover({
            transactionId: 0x12345678,
            clientMac: "aa:bb:cc:dd:ee:ff",
        });

        const parsed = parseBootpPacket(packet);

        expect(parsed.op).toBe("bootRequest");
        expect(parsed.hardwareType).toBe(1);
        expect(parsed.hardwareLen).toBe(6);
        expect(parsed.hops).toBe(0);
        expect(parsed.transactionId).toBe(0x12345678);
        expect(parsed.seconds).toBe(0);
        expect(parsed.flags).toBe(0x8000); // broadcast
        expect(parsed.clientIp).toBe("0.0.0.0");
        expect(parsed.yourIp).toBe("0.0.0.0");
        expect(parsed.serverIp).toBe("0.0.0.0");
        expect(parsed.gatewayIp).toBe("0.0.0.0");
        expect(parsed.clientMac).toBe("aa:bb:cc:dd:ee:ff");
        expect(parsed.magicCookie).toBe(BOOTP_MAGIC_COOKIE);
        expect(parsed.messageType).toBe("discover");
    });

    it("throws on packet too short", () => {
        const short = new Uint8Array(100);
        expect(() => parseBootpPacket(short)).toThrow(/expected at least 236/);
    });

    it("throws on invalid op code", () => {
        const packet = new Uint8Array(BOOTP_HEADER_LEN);
        packet[0] = 99; // invalid op
        expect(() => parseBootpPacket(packet)).toThrow(/Invalid BOOTP op/);
    });

    it("parses transaction ID correctly with unsigned bytes", () => {
        const packet = new Uint8Array(BOOTP_HEADER_LEN);
        packet[0] = 1; // bootRequest
        packet[1] = 1; // hwtype
        packet[2] = 6; // hlen
        packet[4] = 0xff; // high bit set
        packet[5] = 0xff;
        packet[6] = 0xff;
        packet[7] = 0xff;
        // Magic cookie
        packet[236] = 0x63;
        packet[237] = 0x82;
        packet[238] = 0x53;
        packet[239] = 0x63;

        const parsed = parseBootpPacket(packet);
        expect(parsed.transactionId).toBe(0xffffffff);
    });
});

describe("buildDhcpOffer", () => {
    it("builds valid DHCPOFFER packet", () => {
        const offer = buildDhcpOffer({
            transactionId: 0x12345678,
            clientMac: "aa:bb:cc:dd:ee:ff",
            serverIp: "192.168.1.100",
            bootfile: "netinstall-7.14.npk",
        });

        // Parse it back
        const parsed = parseBootpPacket(offer);

        expect(parsed.op).toBe("bootReply");
        expect(parsed.transactionId).toBe(0x12345678);
        expect(parsed.clientMac).toBe("aa:bb:cc:dd:ee:ff");
        expect(parsed.serverIp).toBe("192.168.1.100");
        expect(parsed.messageType).toBe("offer");
    });

    it("includes correct magic cookie", () => {
        const offer = buildDhcpOffer({
            transactionId: 0xabcd,
            clientMac: "00:11:22:33:44:55",
            serverIp: "10.0.0.1",
            bootfile: "test.npk",
        });

        const cookie =
            ((offer[236]! << 24) | (offer[237]! << 16) | (offer[238]! << 8) | offer[239]!) >>> 0;
        expect(cookie).toBe(BOOTP_MAGIC_COOKIE);
    });

    it("includes DHCP option 53 (message type = offer)", () => {
        const offer = buildDhcpOffer({
            transactionId: 1,
            clientMac: "00:00:00:00:00:01",
            serverIp: "192.168.0.1",
            bootfile: "boot.npk",
        });

        const parsed = parseBootpPacket(offer);
        const typeOpt = parsed.options.find((opt) => opt.code === 53);
        expect(typeOpt).toBeDefined();
        expect(typeOpt?.data[0]).toBe(2); // offer
    });

    it("includes DHCP option 54 (server identifier)", () => {
        const offer = buildDhcpOffer({
            transactionId: 1,
            clientMac: "00:00:00:00:00:01",
            serverIp: "10.20.30.40",
            bootfile: "boot.npk",
        });

        const parsed = parseBootpPacket(offer);
        const serverOpt = parsed.options.find((opt) => opt.code === 54);
        expect(serverOpt).toBeDefined();
        expect(serverOpt?.data.length).toBe(4);
        expect(serverOpt?.data[0]).toBe(10);
        expect(serverOpt?.data[1]).toBe(20);
        expect(serverOpt?.data[2]).toBe(30);
        expect(serverOpt?.data[3]).toBe(40);
    });

    it("includes DHCP option 67 (bootfile name)", () => {
        const bootfileName = "mikrotik-chr-7.15.npk";
        const offer = buildDhcpOffer({
            transactionId: 1,
            clientMac: "00:00:00:00:00:01",
            serverIp: "192.168.1.1",
            bootfile: bootfileName,
        });

        const parsed = parseBootpPacket(offer);
        const fileOpt = parsed.options.find((opt) => opt.code === 67);
        expect(fileOpt).toBeDefined();
        const fileName = new TextDecoder().decode(fileOpt?.data);
        expect(fileName).toBe(bootfileName);
    });
});

describe("getMessageType", () => {
    it("returns undefined when no option 53", () => {
        expect(getMessageType([])).toBeUndefined();
    });

    it("returns undefined when option 53 has wrong length", () => {
        const opts = [{ code: 53, data: new Uint8Array([1, 2]), length: 2 }];
        expect(getMessageType(opts)).toBeUndefined();
    });

    it("returns correct type for each code", () => {
        const types: Array<[number, string]> = [
            [1, "discover"],
            [2, "offer"],
            [3, "request"],
            [4, "decline"],
            [5, "ack"],
            [6, "nak"],
            [7, "release"],
            [8, "inform"],
        ];

        for (const [code, name] of types) {
            const opts = [{ code: 53, data: new Uint8Array([code]), length: 1 }];
            expect(getMessageType(opts)).toBe(name as any);
        }
    });
});

function buildTestDiscover(opts: {
    transactionId: number;
    clientMac: string;
}): Uint8Array {
    const packet = new Uint8Array(BOOTP_HEADER_LEN + 32);

    // op = 1 (bootRequest)
    packet[0] = 1;
    // hwtype = 1 (Ethernet)
    packet[1] = 1;
    // hlen = 6
    packet[2] = 6;
    // Transaction ID
    packet[4] = (opts.transactionId >> 24) & 0xff;
    packet[5] = (opts.transactionId >> 16) & 0xff;
    packet[6] = (opts.transactionId >> 8) & 0xff;
    packet[7] = opts.transactionId & 0xff;

    // Flags = 0x8000 (broadcast)
    packet[10] = 0x80;
    packet[11] = 0x00;

    // Client MAC
    const mac = opts.clientMac.replace(/:/g, "");
    for (let i = 0; i < 6; i++) {
        packet[28 + i] = parseInt(mac.slice(i * 2, i * 2 + 2), 16);
    }

    // Magic cookie
    packet[236] = 0x63;
    packet[237] = 0x82;
    packet[238] = 0x53;
    packet[239] = 0x63;

    // Option 53: DHCP Message Type = discover (1)
    packet[240] = 53;
    packet[241] = 1;
    packet[242] = 1;

    // Option 255: End
    packet[243] = 255;

    return packet.slice(0, 244);
}

// ── BootpServer tests ─────────────────────────────────────────────────────

describe("BootpServer", () => {
    it("binds and resolves on listening event", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        expect(mockDgramSocket.bind).toHaveBeenCalledWith(9967);
        server.close();
    });

    it("close() closes the socket and is idempotent", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        server.close();
        expect(mockDgramSocket.close).toHaveBeenCalledTimes(1);
        server.close(); // idempotent
        expect(mockDgramSocket.close).toHaveBeenCalledTimes(1);
    });

    it("emits error on socket error event", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        const errors: Error[] = [];
        server.on("error", (e) => errors.push(e as Error));
        mockDgramSocket._emit("error", new Error("socket error"));
        expect(errors[0]?.message).toBe("socket error");
        server.close();
    });

    it("ignores socket error when closed (socket = null)", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        server.close(); // sets socket to null
        const errors: Error[] = [];
        server.on("error", (e) => errors.push(e as Error));
        mockDgramSocket._emit("error", new Error("late error"));
        expect(errors).toHaveLength(0);
    });

    it("emits discover and offer on valid DHCP DISCOVER", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        const discovers: unknown[] = [];
        const offers: unknown[] = [];
        server.on("discover", (p) => discovers.push(p));
        server.on("offer", (o) => offers.push(o));

        const discoverPkt = buildTestDiscover({ transactionId: 0x1234, clientMac: "aa:bb:cc:dd:ee:ff" });
        mockDgramSocket._emit("message", Buffer.from(discoverPkt), { address: "0.0.0.0", port: 68 });

        expect(discovers).toHaveLength(1);
        expect(offers).toHaveLength(1);
        expect((offers[0] as { clientMac: string }).clientMac).toBe("aa:bb:cc:dd:ee:ff");
        server.close();
    });

    it("filters by deviceMac when set", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk", deviceMac: "11:22:33:44:55:66" });
        await server.listen(9967);
        const offers: unknown[] = [];
        server.on("offer", (o) => offers.push(o));

        // Wrong MAC → ignored
        const wrongMac = buildTestDiscover({ transactionId: 1, clientMac: "aa:bb:cc:dd:ee:ff" });
        mockDgramSocket._emit("message", Buffer.from(wrongMac), { address: "0.0.0.0", port: 68 });
        expect(offers).toHaveLength(0);

        // Correct MAC → offer
        const rightMac = buildTestDiscover({ transactionId: 2, clientMac: "11:22:33:44:55:66" });
        mockDgramSocket._emit("message", Buffer.from(rightMac), { address: "0.0.0.0", port: 68 });
        expect(offers).toHaveLength(1);
        server.close();
    });

    it("ignores non-DISCOVER message types", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        const offers: unknown[] = [];
        server.on("offer", (o) => offers.push(o));

        // Build a non-DISCOVER packet (messageType=request, code 3)
        const pkt = buildTestDiscover({ transactionId: 1, clientMac: "aa:bb:cc:dd:ee:ff" });
        const buf = Buffer.from(pkt);
        buf[242] = 3; // option 53 value = request
        mockDgramSocket._emit("message", buf, { address: "0.0.0.0", port: 68 });
        expect(offers).toHaveLength(0);
        server.close();
    });

    it("silently ignores malformed packets", async () => {
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        const errors: Error[] = [];
        server.on("error", (e) => errors.push(e as Error));

        // Too-short packet → parseBootpPacket throws inside handleMessage, silently returned
        mockDgramSocket._emit("message", Buffer.alloc(10), { address: "0.0.0.0", port: 68 });
        expect(errors).toHaveLength(0);
        server.close();
    });

    it("emits error when send fails", async () => {
        mockDgramSocket.send.mockImplementation((_data: unknown, _port: unknown, _addr: unknown, cb?: (e: Error | null) => void) =>
            cb?.(new Error("send failed"))
        );
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await server.listen(9967);
        const errors: Error[] = [];
        server.on("error", (e) => errors.push(e as Error));

        const discoverPkt = buildTestDiscover({ transactionId: 1, clientMac: "aa:bb:cc:dd:ee:ff" });
        mockDgramSocket._emit("message", Buffer.from(discoverPkt), { address: "0.0.0.0", port: 68 });
        expect(errors[0]?.message).toBe("send failed");
        server.close();
    });

    it("rejects listen() when setBroadcast throws", async () => {
        mockDgramSocket.setBroadcast.mockImplementationOnce(() => { throw new Error("setBroadcast failed"); });
        const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "test.npk" });
        await expect(server.listen(9967)).rejects.toThrow("setBroadcast failed");
    });
});
