import { describe, it, expect } from "vitest";
import {
    encodePacket,
    decodePacket,
    encodeControlPacket,
    decodeControlPackets,
    buildStartPacket,
    buildEndPacket,
    buildControlDataPacket,
    buildShellDataPacket,
    buildAckPacket,
    parseMac,
    formatMac,
    HEADER_LEN,
    CONTROL_PACKET_MAGIC_BYTES,
    CONTROL_HEADER_LEN,
    PROTOCOL_VERSION,
    CLIENT_TYPE_MACTELNET,
    MAC_TELNET_PACKET_TYPES,
    MAC_TELNET_CONTROL_PACKET_TYPES,
} from "./packet";

const BROADCAST_MAC = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const LOCAL_MAC = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
const TARGET_MAC = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
const SESSION_KEY = 0x1234;

describe("parseMac", () => {
    it("parses colon-separated MAC", () => {
        const mac = parseMac("aa:bb:cc:dd:ee:ff");
        expect(Array.from(mac)).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    });

    it("parses hyphen-separated MAC", () => {
        const mac = parseMac("AA-BB-CC-DD-EE-FF");
        expect(Array.from(mac)).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    });

    it("parses lowercase", () => {
        const mac = parseMac("aa:bb:cc:dd:ee:ff");
        expect(Array.from(mac)).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    });

    it("throws on invalid format", () => {
        expect(() => parseMac("invalid")).toThrow("Invalid MAC address");
    });

    it("throws on invalid octet", () => {
        expect(() => parseMac("gg:bb:cc:dd:ee:ff")).toThrow();
    });
});

describe("formatMac", () => {
    it("formats 6-byte array to lowercase colon-separated string", () => {
        expect(formatMac(LOCAL_MAC)).toBe("aa:bb:cc:dd:ee:ff");
    });

    it("throws on wrong length", () => {
        expect(() => formatMac(new Uint8Array(5))).toThrow("Expected 6 bytes");
    });
});

describe("encodePacket / decodePacket", () => {
    function makePacket(overrides: Partial<ReturnType<typeof encodePacket>> = {}) {
        return {
            version: PROTOCOL_VERSION,
            ptype: "start" as const,
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
            clientType: CLIENT_TYPE_MACTELNET,
            counter: 0,
            data: new Uint8Array(),
            ...overrides,
        };
    }

    it("round-trips empty START packet", () => {
        const pkt = makePacket();
        const raw = encodePacket(pkt);
        expect(raw.length).toBe(HEADER_LEN);

        const decoded = decodePacket(raw);
        expect(decoded.version).toBe(PROTOCOL_VERSION);
        expect(decoded.ptype).toBe("start");
        expect(Array.from(decoded.srcMac)).toEqual(Array.from(LOCAL_MAC));
        expect(Array.from(decoded.dstMac)).toEqual(Array.from(TARGET_MAC));
        expect(decoded.sessionKey).toBe(SESSION_KEY);
        expect(decoded.clientType).toBe(CLIENT_TYPE_MACTELNET);
        expect(decoded.counter).toBe(0);
        expect(decoded.data.length).toBe(0);
    });

    it("round-trips DATA packet with payload", () => {
        const payload = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
        const pkt = makePacket({ ptype: "data", data: payload });
        const raw = encodePacket(pkt);
        expect(raw.length).toBe(HEADER_LEN + payload.length);

        const decoded = decodePacket(raw);
        expect(decoded.ptype).toBe("data");
        expect(Array.from(decoded.data)).toEqual(Array.from(payload));
    });

    it("round-trips all packet types", () => {
        for (const ptype of MAC_TELNET_PACKET_TYPES) {
            const pkt = makePacket({ ptype });
            const raw = encodePacket(pkt);
            const decoded = decodePacket(raw);
            expect(decoded.ptype).toBe(ptype);
        }
    });

    it("round-trips with non-zero counter", () => {
        const pkt = makePacket({ counter: 0x01020304 });
        const raw = encodePacket(pkt);
        const decoded = decodePacket(raw);
        expect(decoded.counter).toBe(0x01020304);
    });

    it("round-trips with WinBox client type", () => {
        const pkt = makePacket({ clientType: 0x0f90 });
        const raw = encodePacket(pkt);
        const decoded = decodePacket(raw);
        expect(decoded.clientType).toBe(0x0f90);
    });

    it("throws on buffer too short", () => {
        expect(() => decodePacket(new Uint8Array(10))).toThrow("packet too short");
    });

    it("throws on unknown ptype", () => {
        const pkt = makePacket();
        const raw = encodePacket(pkt);
        raw[1] = 42; // Invalid ptype
        expect(() => decodePacket(raw)).toThrow("Unknown MAC-Telnet ptype");
    });
});

describe("encodeControlPacket / decodeControlPackets", () => {
    it("round-trips begin_auth (empty data)", () => {
        const cp = { type: "begin_auth" as const, data: new Uint8Array() };
        const raw = encodeControlPacket(cp);
        expect(raw.length).toBe(CONTROL_HEADER_LEN);

        const { controlPackets } = decodeControlPackets(raw);
        expect(controlPackets).toHaveLength(1);
        expect(controlPackets[0].type).toBe("begin_auth");
        expect(controlPackets[0].data.length).toBe(0);
    });

    it("round-trips username with string data", () => {
        const username = new TextEncoder().encode("admin");
        const cp = { type: "username" as const, data: username };
        const raw = encodeControlPacket(cp);
        expect(raw.length).toBe(CONTROL_HEADER_LEN + username.length);

        const { controlPackets } = decodeControlPackets(raw);
        expect(controlPackets).toHaveLength(1);
        expect(controlPackets[0].type).toBe("username");
        expect(new TextDecoder().decode(controlPackets[0].data)).toBe("admin");
    });

    it("round-trips term_width (2 bytes LE)", () => {
        const width = new Uint8Array([80, 0]); // 80 in little-endian
        const cp = { type: "term_width" as const, data: width };
        const raw = encodeControlPacket(cp);

        const { controlPackets } = decodeControlPackets(raw);
        expect(controlPackets[0].type).toBe("term_width");
        expect(Array.from(controlPackets[0].data)).toEqual([80, 0]);
    });

    it("round-trips end_auth", () => {
        const cp = { type: "end_auth" as const, data: new Uint8Array() };
        const raw = encodeControlPacket(cp);
        const { controlPackets } = decodeControlPackets(raw);
        expect(controlPackets[0].type).toBe("end_auth");
    });

    it("parses multiple control packets in one payload", () => {
        const cps = [
            { type: "password" as const, data: new Uint8Array([0x00, 0x12, 0x34, 0x56]) },
            { type: "username" as const, data: new TextEncoder().encode("admin") },
            { type: "term_type" as const, data: new TextEncoder().encode("linux") },
        ];
        const raw = buildControlDataPacket({
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
            counter: 0,
            controlPackets: cps,
        });

        const pkt = decodePacket(raw);
        const { controlPackets } = decodeControlPackets(pkt.data);
        expect(controlPackets).toHaveLength(3);
        expect(controlPackets[0].type).toBe("password");
        expect(controlPackets[1].type).toBe("username");
        expect(controlPackets[2].type).toBe("term_type");
    });

    it("separates raw data from control packets", () => {
        const _shellOutput = new TextEncoder().encode("RouterOS prompt> ");
        const mixed = new Uint8Array([
            // Some raw data
            0x48, 0x65, 0x6c, 0x6c, 0x6f, // "Hello"
            // Then begin_auth control packet
            ...encodeControlPacket({ type: "begin_auth", data: new Uint8Array() }),
            // More raw data
            0x6f, 0x72, 0x6c, 0x64, // "orld"
        ]);

        const { controlPackets, rawData } = decodeControlPackets(mixed);
        expect(controlPackets).toHaveLength(1);
        expect(controlPackets[0].type).toBe("begin_auth");
        expect(new TextDecoder().decode(rawData)).toBe("Helloorld");
    });

    it("handles pure raw data with no magic", () => {
        const raw = new TextEncoder().encode("RouterOS 7.15 login prompt> Welcome to RouterOS!");
        const { controlPackets, rawData } = decodeControlPackets(raw);
        expect(controlPackets).toHaveLength(0);
        expect(rawData).toEqual(raw);
    });

    it("handles truncated control packet", () => {
        const partial = new Uint8Array([
            0xff, 0x12, 0x34, 0x56, // magic
            0x00, // type
            0x00, 0x00, 0x00, // length (but truncated - needs 4 bytes for length + data)
        ]);
        const { controlPackets, rawData } = decodeControlPackets(partial);
        expect(controlPackets).toHaveLength(0);
        expect(rawData.length).toBeGreaterThan(0);
    });
});

describe("buildStartPacket", () => {
    it("builds valid start packet", () => {
        const raw = buildStartPacket({
            srcMac: LOCAL_MAC,
            dstMac: BROADCAST_MAC,
            sessionKey: SESSION_KEY,
        });
        const pkt = decodePacket(raw);
        expect(pkt.ptype).toBe("start");
        expect(pkt.clientType).toBe(CLIENT_TYPE_MACTELNET);
        expect(pkt.data.length).toBe(0);
    });
});

describe("buildEndPacket", () => {
    it("builds valid end packet", () => {
        const raw = buildEndPacket({
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
        });
        const pkt = decodePacket(raw);
        expect(pkt.ptype).toBe("end");
    });
});

describe("buildControlDataPacket", () => {
    it("builds data packet with control packets", () => {
        const raw = buildControlDataPacket({
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
            counter: 42,
            controlPackets: [
                { type: "begin_auth", data: new Uint8Array() },
            ],
        });
        const pkt = decodePacket(raw);
        expect(pkt.ptype).toBe("data");
        expect(pkt.counter).toBe(42);

        const { controlPackets } = decodeControlPackets(pkt.data);
        expect(controlPackets).toHaveLength(1);
    });
});

describe("buildShellDataPacket", () => {
    it("builds data packet with raw shell data", () => {
        const shellInput = new TextEncoder().encode("/ip/address/print\n");
        const raw = buildShellDataPacket({
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
            counter: 100,
            shellData: shellInput,
        });
        const pkt = decodePacket(raw);
        expect(pkt.ptype).toBe("data");
        expect(new TextDecoder().decode(pkt.data)).toBe("/ip/address/print\n");
    });
});

describe("buildAckPacket", () => {
    it("builds ACK packet with ptype=ack and empty payload", () => {
        const raw = buildAckPacket({
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
            counter: 42,
        });
        const pkt = decodePacket(raw);
        expect(pkt.ptype).toBe("ack");
        expect(pkt.counter).toBe(42);
        expect(pkt.data.length).toBe(0);
        expect(raw.length).toBe(HEADER_LEN);
    });

    it("encodes src/dst MAC correctly", () => {
        const raw = buildAckPacket({
            srcMac: LOCAL_MAC,
            dstMac: TARGET_MAC,
            sessionKey: SESSION_KEY,
            counter: 0,
        });
        const pkt = decodePacket(raw);
        expect(Array.from(pkt.srcMac)).toEqual(Array.from(LOCAL_MAC));
        expect(Array.from(pkt.dstMac)).toEqual(Array.from(TARGET_MAC));
    });
});

describe("CONTROL_PACKET_MAGIC_BYTES constant", () => {
    it("has correct value", () => {
        expect(CONTROL_PACKET_MAGIC_BYTES).toEqual([0x56, 0x34, 0x12, 0xff]);
    });
});

describe("MAC_TELNET_PACKET_TYPES and MAC_TELNET_CONTROL_PACKET_TYPES", () => {
    it("exposes runtime arrays", () => {
        expect(MAC_TELNET_PACKET_TYPES).toContain("start");
        expect(MAC_TELNET_PACKET_TYPES).toContain("data");
        expect(MAC_TELNET_PACKET_TYPES).toContain("ack");
        expect(MAC_TELNET_PACKET_TYPES).toContain("end");
    });

    it("exposes all control packet types", () => {
        expect(MAC_TELNET_CONTROL_PACKET_TYPES).toContain("begin_auth");
        expect(MAC_TELNET_CONTROL_PACKET_TYPES).toContain("password");
        expect(MAC_TELNET_CONTROL_PACKET_TYPES).toContain("end_auth");
        expect(MAC_TELNET_CONTROL_PACKET_TYPES).toContain("passsalt_client");
    });
});
