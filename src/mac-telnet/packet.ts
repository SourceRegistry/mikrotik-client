/**
 * MAC-Telnet packet codec.
 *
 * Encodes and decodes the raw UDP payload used by the MikroTik MAC-Telnet
 * protocol. The protocol embeds MAC addresses, session keys, and a byte
 * counter inside a 22-byte header followed by variable-length payload.
 *
 * Reference: {@link https://omniflux.com/devel/mikrotik/Mikrotik_MAC_Telnet_Procotol.txt}
 *
 * @module @sourceregistry/mikrotik-client/mac-telnet
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** UDP port used by MAC-Telnet on both client and server. */
export const MACTELNET_PORT = 20561;

/** Protocol version observed in all known RouterOS implementations. */
export const PROTOCOL_VERSION = 0x01;

/** Client type identifier used by the MAC-Telnet C client. */
export const CLIENT_TYPE_MACTELNET = 0x0015;

/** Client type identifier used by WinBox. */
export const CLIENT_TYPE_WINBOX = 0x0f90;

/** Maximum payload size ( conservative limit; RouterOS uses ~1500 bytes). */
export const MAX_PACKET_SIZE = 1500;

/** ETHER_ADDR_LEN — MAC addresses are always 6 bytes. */
const ETHER_ADDR_LEN = 6;

/** Total header size: ver(1) + ptype(1) + src(6) + dst(6) + seskey(4) + counter(4). */
export const HEADER_LEN = 22;

/** Magic number that prefixes control packets inside DATA payloads (big-endian `0x563412ff`). */
export const CONTROL_PACKET_MAGIC_BYTES = [0x56, 0x34, 0x12, 0xff] as const;

function matchesMagic(data: Uint8Array, offset: number): boolean {
    return (
        data[offset] === CONTROL_PACKET_MAGIC_BYTES[0] &&
        data[offset + 1] === CONTROL_PACKET_MAGIC_BYTES[1] &&
        data[offset + 2] === CONTROL_PACKET_MAGIC_BYTES[2] &&
        data[offset + 3] === CONTROL_PACKET_MAGIC_BYTES[3]
    );
}

/** Size of the control packet header: magic(4) + type(1) + length(4). */
export const CONTROL_HEADER_LEN = 9;

// ── Packet Type ──────────────────────────────────────────────────────────────

/**
 * MAC-Telnet packet types (ptype field).
 *
 * @example
 * ```ts
 * const PTYPE: MacTelnetPacketType = "data";
 * ```
 */
export type MacTelnetPacketType = "start" | "data" | "ack" | "end";

/** Numeric ptype value → string. */
const PTYPE_NUM_TO_STR: ReadonlyMap<number, MacTelnetPacketType> = new Map([
    [0, "start"],
    [1, "data"],
    [2, "ack"],
    [255, "end"],
]);

/** String ptype → numeric value. */
const PTYPE_STR_TO_NUM: ReadonlyMap<MacTelnetPacketType, number> = new Map([
    ["start", 0],
    ["data", 1],
    ["ack", 2],
    ["end", 255],
]);

// ── Control Packet Type ──────────────────────────────────────────────────────

/**
 * Control packet types embedded inside DATA payloads.
 *
 * @example
 * ```ts
 * const CP: MacTelnetControlPacketType = "begin_auth";
 * ```
 */
export type MacTelnetControlPacketType =
    | "begin_auth"    // 0  — Client initiates authentication
    | "passsalt"      // 1  — Server sends encryption key / salt
    | "password"      // 2  — Client sends password hash
    | "username"      // 3  — Client sends username
    | "term_type"     // 4  — Client sends terminal type string
    | "term_width"    // 5  — Client sends terminal width (2 bytes LE)
    | "term_height"   // 6  — Client sends terminal height (2 bytes LE)
    | "unknown_7"     // 7  — Possibly "received invalid control packet"
    | "end_auth"      // 9  — Server confirms authentication complete
    | "passsalt_client"; // 8 — Client sends username + null + EC public key (EC-SRP)

/** Numeric cptype → string. */
const CPTYPE_NUM_TO_STR: ReadonlyMap<number, MacTelnetControlPacketType> = new Map([
    [0, "begin_auth"],
    [1, "passsalt"],
    [2, "password"],
    [3, "username"],
    [4, "term_type"],
    [5, "term_width"],
    [6, "term_height"],
    [7, "unknown_7"],
    [8, "passsalt_client"],
    [9, "end_auth"],
]);

const CPTYPE_STR_TO_NUM: ReadonlyMap<MacTelnetControlPacketType, number> = new Map([
    ["begin_auth", 0],
    ["passsalt", 1],
    ["password", 2],
    ["username", 3],
    ["term_type", 4],
    ["term_width", 5],
    ["term_height", 6],
    ["unknown_7", 7],
    ["passsalt_client", 8],
    ["end_auth", 9],
]);

/** Runtime array of all known control packet types. */
export const MAC_TELNET_CONTROL_PACKET_TYPES: readonly MacTelnetControlPacketType[] = [
    "begin_auth",
    "passsalt",
    "password",
    "username",
    "term_type",
    "term_width",
    "term_height",
    "unknown_7",
    "passsalt_client",
    "end_auth",
];

/** Runtime array of all known packet types. */
export const MAC_TELNET_PACKET_TYPES: readonly MacTelnetPacketType[] = [
    "start",
    "data",
    "ack",
    "end",
];

// ── Packet Type ──────────────────────────────────────────────────────────────

/**
 * A complete MAC-Telnet packet (header + variable data).
 *
 * @example
 * ```ts
 * const pkt: MacTelnetPacket = {
 *   version: 0x01,
 *   ptype: "data",
 *   srcMac: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
 *   dstMac: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
 *   sessionKey: 0x1234,
 *   clientType: CLIENT_TYPE_MACTELNET,
 *   counter: 0,
 *   data: new Uint8Array(),
 * };
 * ```
 */
export type MacTelnetPacket = {
    /** Protocol version (should be 0x01). */
    version: number;
    /** Packet type. */
    ptype: MacTelnetPacketType;
    /** 6-byte source MAC address. */
    srcMac: Uint8Array;
    /** 6-byte destination MAC address. */
    dstMac: Uint8Array;
    /** 16-bit session ID (client-generated, unique per session). */
    sessionKey: number;
    /** 16-bit client type identifier. */
    clientType: number;
    /** Cumulative byte counter (sent or received, depending on direction). */
    counter: number;
    /** Variable-length payload (control packets or raw shell data). */
    data: Uint8Array;
};

// ── Control Packet Type ──────────────────────────────────────────────────────

/**
 * A control packet embedded inside a DATA payload.
 *
 * @example
 * ```ts
 * const cp: MacTelnetControlPacket = {
 *   type: "begin_auth",
 *   data: new Uint8Array(),
 * };
 * ```
 */
export type MacTelnetControlPacket = {
    /** Control packet type. */
    type: MacTelnetControlPacketType;
    /** Variable-length payload (empty for begin_auth, end_auth). */
    data: Uint8Array;
};

// ── MAC helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a colon-hyphen or colon-separated MAC address string into a 6-byte Uint8Array.
 *
 * @param mac - MAC address string (e.g. `"aa:bb:cc:dd:ee:ff"`, `"AA-BB-CC-DD-EE-FF"`).
 * @returns 6-byte Uint8Array.
 * @throws {Error} If the string is not a valid MAC address.
 *
 * @example
 * ```ts
 * const mac = parseMac("aa:bb:cc:dd:ee:ff");
 * // → Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
 * ```
 */
export function parseMac(mac: string): Uint8Array {
    const normalized = mac.replace(/-/g, ":");
    const parts = normalized.split(":");
    if (parts.length !== 6) {
        throw new Error(`Invalid MAC address: ${mac}`);
    }
    const result = new Uint8Array(6);
    for (let i = 0; i < 6; i++) {
        const part = parts[i];
        if (part === undefined) {
            throw new Error(`Invalid MAC address: ${mac}`);
        }
        const byte = parseInt(part, 16);
        if (isNaN(byte) || byte < 0 || byte > 255) {
            throw new Error(`Invalid MAC octet "${part}" in ${mac}`);
        }
        result[i] = byte;
    }
    return result;
}

/**
 * Format a 6-byte Uint8Array as a colon-separated lowercase MAC string.
 *
 * @param bytes - 6-byte MAC address.
 * @returns Lowercase colon-separated string (e.g. `"aa:bb:cc:dd:ee:ff"`).
 *
 * @example
 * ```ts
 * const mac = formatMac(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));
 * // → "aa:bb:cc:dd:ee:ff"
 * ```
 */
export function formatMac(bytes: Uint8Array): string {
    if (bytes.length !== 6) {
        throw new Error(`Expected 6 bytes, got ${bytes.length}`);
    }
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(":");
}

// ── Seskey packing/unpacking ─────────────────────────────────────────────────

/**
 * Pack sessionKey (16-bit) and clientType (16-bit) into a 4-byte array
 * in **big-endian** order: `[sessHigh, sessLow, typeHigh, typeLow]`.
 * This produces `0xABCD0015` for session=0xABCD, type=0x0015.
 */
function packSeskey(sessionKey: number, clientType: number): Uint8Array {
    const buf = new Uint8Array(4);
    buf[0] = (sessionKey >> 8) & 0xff;
    buf[1] = sessionKey & 0xff;
    buf[2] = (clientType >> 8) & 0xff;
    buf[3] = clientType & 0xff;
    return buf;
}

/**
 * Unpack a 4-byte seskey field.
 * Returns `{ sessionKey, clientType }`.
 */
function unpackSeskey(buf: Uint8Array, offset: number): {
    sessionKey: number;
    clientType: number;
} {
    const b0 = buf[offset] ?? 0;
    const b1 = buf[offset + 1] ?? 0;
    const b2 = buf[offset + 2] ?? 0;
    const b3 = buf[offset + 3] ?? 0;
    const sessionKey = (b0 << 8) | b1;
    const clientType = (b2 << 8) | b3;
    return { sessionKey, clientType };
}

// ── Encode / Decode ──────────────────────────────────────────────────────────

/**
 * Encode a {@link MacTelnetPacket} into a raw UDP payload Uint8Array.
 *
 * The output is a 22-byte header followed by the packet's `data` payload.
 *
 * @param pkt - The packet to encode.
 * @returns Raw bytes suitable for sending via UDP.
 *
 * @example
 * ```ts
 * const raw = encodePacket({
 *   version: 0x01,
 *   ptype: "start",
 *   srcMac: parseMac("aa:bb:cc:dd:ee:ff"),
 *   dstMac: parseMac("ff:ff:ff:ff:ff:ff"),
 *   sessionKey: 0x1234,
 *   clientType: CLIENT_TYPE_MACTELNET,
 *   counter: 0,
 *   data: new Uint8Array(),
 * });
 * ```
 */
export function encodePacket(pkt: MacTelnetPacket): Uint8Array {
    const len = HEADER_LEN + pkt.data.length;
    const buf = new Uint8Array(len);
    let offset = 0;

    // ver (1 byte)
    buf[offset++] = pkt.version;

    // ptype (1 byte)
    buf[offset++] = PTYPE_STR_TO_NUM.get(pkt.ptype) ?? 1;

    // srcMac (6 bytes)
    buf.set(pkt.srcMac, offset);
    offset += ETHER_ADDR_LEN;

    // dstMac (6 bytes)
    buf.set(pkt.dstMac, offset);
    offset += ETHER_ADDR_LEN;

    // seskey + clientType (4 bytes)
    buf.set(packSeskey(pkt.sessionKey, pkt.clientType), offset);
    offset += 4;

    // counter (4 bytes, big-endian)
    buf[offset] = (pkt.counter >> 24) & 0xff;
    buf[offset + 1] = (pkt.counter >> 16) & 0xff;
    buf[offset + 2] = (pkt.counter >> 8) & 0xff;
    buf[offset + 3] = pkt.counter & 0xff;
    offset += 4;

    // data (variable)
    buf.set(pkt.data, offset);

    return buf;
}

/**
 * Decode a raw UDP payload into a {@link MacTelnetPacket}.
 *
 * @param buf - Raw UDP payload (minimum 22 bytes).
 * @returns Decoded packet.
 * @throws {Error} If the buffer is too short or contains an unknown ptype.
 *
 * @example
 * ```ts
 * const pkt = decodePacket(rawBytes);
 * console.log(pkt.ptype, pkt.sessionKey);
 * ```
 */
export function decodePacket(buf: Uint8Array): MacTelnetPacket {
    if (buf.length < HEADER_LEN) {
        throw new Error(
            `MAC-Telnet packet too short: ${buf.length} bytes (minimum ${HEADER_LEN})`,
        );
    }

    let offset = 0;

    const version = buf[offset++] ?? 0;
    const ptypeNum = buf[offset++] ?? 0;
    const ptype = PTYPE_NUM_TO_STR.get(ptypeNum);
    if (!ptype) {
        throw new Error(`Unknown MAC-Telnet ptype: ${ptypeNum}`);
    }

    const srcMac = buf.slice(offset, offset + ETHER_ADDR_LEN);
    offset += ETHER_ADDR_LEN;

    const dstMac = buf.slice(offset, offset + ETHER_ADDR_LEN);
    offset += ETHER_ADDR_LEN;

    const { sessionKey, clientType } = unpackSeskey(buf, offset);
    offset += 4;

    const c0 = buf[offset] ?? 0;
    const c1 = buf[offset + 1] ?? 0;
    const c2 = buf[offset + 2] ?? 0;
    const c3 = buf[offset + 3] ?? 0;
    const counter =
        (c0 << 24) | (c1 << 16) | (c2 << 8) | c3;
    offset += 4;

    const data = buf.slice(offset);

    return { version, ptype, srcMac, dstMac, sessionKey, clientType, counter, data };
}

// ── Control Packet Encode / Decode ──────────────────────────────────────────────────────────

/**
 * Encode a {@link MacTelnetControlPacket} into raw bytes.
 *
 * Output: magic(4) + type(1) + length(4, big-endian) + data(N).
 *
 * @param cp - The control packet to encode.
 * @returns Raw bytes that can be concatenated into a DATA payload.
 *
 * @example
 * ```ts
 * const raw = encodeControlPacket({ type: "begin_auth", data: new Uint8Array() });
 * ```
 */
export function encodeControlPacket(cp: MacTelnetControlPacket): Uint8Array {
    const len = CONTROL_HEADER_LEN + cp.data.length;
    const buf = new Uint8Array(len);
    let offset = 0;

    // magic (4 bytes, big-endian: 0x563412ff)
    buf[offset] = 0x56;
    buf[offset + 1] = 0x34;
    buf[offset + 2] = 0x12;
    buf[offset + 3] = 0xff;
    offset += 4;

    // type (1 byte)
    buf[offset++] = CPTYPE_STR_TO_NUM.get(cp.type) ?? 0;

    // length (4 bytes, big-endian)
    const dLen = cp.data.length;
    buf[offset] = (dLen >> 24) & 0xff;
    buf[offset + 1] = (dLen >> 16) & 0xff;
    buf[offset + 2] = (dLen >> 8) & 0xff;
    buf[offset + 3] = dLen & 0xff;
    offset += 4;

    // data
    buf.set(cp.data, offset);

    return buf;
}

/**
 * Decode one or more control packets from a DATA payload.
 *
 * Control packets are prefixed by the magic `0xff123456`. Any bytes that don't
 * start with the magic are considered raw shell data and returned in the
 * `rawData` field.
 *
 * @param data - The variable data portion of a DATA packet.
 * @returns Object containing parsed control packets and any remaining raw data.
 *
 * @example
 * ```ts
 * const { controlPackets, rawData } = decodeControlPackets(dataPayload);
 * ```
 */
export function decodeControlPackets(data: Uint8Array): {
    controlPackets: MacTelnetControlPacket[];
    rawData: Uint8Array;
} {
    const controlPackets: MacTelnetControlPacket[] = [];
    const rawSegments: Uint8Array[] = [];

    let offset = 0;
    while (offset < data.length) {
        // Check for magic at current position
        if (offset + 4 <= data.length) {
            if (matchesMagic(data, offset)) {
                // Parse control packet
                if (offset + CONTROL_HEADER_LEN > data.length) {
                    break;
                }

                const typeNum = data[offset + 4] ?? 0;
                const cptype = CPTYPE_NUM_TO_STR.get(typeNum);
                if (!cptype) {
                    // Unknown control type — treat as raw data
                    rawSegments.push(data.slice(offset, offset + 1));
                    offset++;
                    continue;
                }

                const lengthBe = new DataView(data.buffer, data.byteOffset + offset + 5, 4);
                const cpLen = lengthBe.getUint32(0, false);

                const end = offset + CONTROL_HEADER_LEN + cpLen;
                if (end > data.length) {
                    break;
                }

                controlPackets.push({
                    type: cptype,
                    data: data.slice(offset + CONTROL_HEADER_LEN, end),
                });

                offset = end;
                continue;
            }
        }

        // Not a control packet — raw shell data
        rawSegments.push(data.slice(offset, offset + 1));
        offset++;
    }

    const rawData =
        rawSegments.length > 0 ? concatUint8Arrays(rawSegments) : new Uint8Array(0);

    return { controlPackets, rawData };
}

// ── Builder helpers ──────────────────────────────────────────────────────────

/**
 * Build a START_SESSION packet.
 *
 * @param opts - Builder options.
 * @returns Encoded packet ready for UDP send.
 *
 * @example
 * ```ts
 * const raw = buildStartPacket({
 *   srcMac: localMac,
 *   dstMac: broadcastMac,
 *   sessionKey: 0x1234,
 * });
 * ```
 */
export function buildStartPacket(opts: {
    srcMac: Uint8Array;
    dstMac: Uint8Array;
    sessionKey: number;
    clientType?: number;
}): Uint8Array {
    return encodePacket({
        version: PROTOCOL_VERSION,
        ptype: "start",
        srcMac: opts.srcMac,
        dstMac: opts.dstMac,
        sessionKey: opts.sessionKey,
        clientType: opts.clientType ?? CLIENT_TYPE_MACTELNET,
        counter: 0,
        data: new Uint8Array(0),
    });
}

/**
 * Build an END_SESSION packet.
 *
 * @param opts - Builder options.
 * @returns Encoded packet ready for UDP send.
 */
export function buildEndPacket(opts: {
    srcMac: Uint8Array;
    dstMac: Uint8Array;
    sessionKey: number;
    clientType?: number;
}): Uint8Array {
    return encodePacket({
        version: PROTOCOL_VERSION,
        ptype: "end",
        srcMac: opts.srcMac,
        dstMac: opts.dstMac,
        sessionKey: opts.sessionKey,
        clientType: opts.clientType ?? CLIENT_TYPE_MACTELNET,
        counter: 0,
        data: new Uint8Array(0),
    });
}

/**
 * Build a DATA packet containing one or more control packets.
 *
 * @param opts - Builder options.
 * @returns Encoded packet ready for UDP send.
 *
 * @example
 * ```ts
 * const raw = buildControlDataPacket({
 *   srcMac: localMac,
 *   dstMac: targetMac,
 *   sessionKey: 0x1234,
 *   counter: 0,
 *   controlPackets: [{ type: "begin_auth", data: new Uint8Array() }],
 * });
 * ```
 */
export function buildControlDataPacket(opts: {
    srcMac: Uint8Array;
    dstMac: Uint8Array;
    sessionKey: number;
    clientType?: number;
    counter: number;
    controlPackets: MacTelnetControlPacket[];
}): Uint8Array {
    const parts = opts.controlPackets.map(encodeControlPacket);
    const data = concatUint8Arrays(parts);
    return encodePacket({
        version: PROTOCOL_VERSION,
        ptype: "data",
        srcMac: opts.srcMac,
        dstMac: opts.dstMac,
        sessionKey: opts.sessionKey,
        clientType: opts.clientType ?? CLIENT_TYPE_MACTELNET,
        counter: opts.counter,
        data,
    });
}

/**
 * Build an ACK packet.
 *
 * Sent periodically to keep the session alive on the device side.
 *
 * @param opts - Builder options.
 * @returns Encoded packet ready for UDP send.
 *
 * @example
 * ```ts
 * const raw = buildAckPacket({
 *   srcMac: localMac,
 *   dstMac: targetMac,
 *   sessionKey: 0x1234,
 *   counter: 42,
 * });
 * ```
 */
export function buildAckPacket(opts: {
    srcMac: Uint8Array;
    dstMac: Uint8Array;
    sessionKey: number;
    counter: number;
    clientType?: number;
}): Uint8Array {
    return encodePacket({
        version: PROTOCOL_VERSION,
        ptype: "ack",
        srcMac: opts.srcMac,
        dstMac: opts.dstMac,
        sessionKey: opts.sessionKey,
        clientType: opts.clientType ?? CLIENT_TYPE_MACTELNET,
        counter: opts.counter,
        data: new Uint8Array(0),
    });
}

/**
 * Build a DATA packet containing raw shell input bytes.
 *
 * @param opts - Builder options.
 * @returns Encoded packet ready for UDP send.
 */
export function buildShellDataPacket(opts: {
    srcMac: Uint8Array;
    dstMac: Uint8Array;
    sessionKey: number;
    clientType?: number;
    counter: number;
    shellData: Uint8Array;
}): Uint8Array {
    return encodePacket({
        version: PROTOCOL_VERSION,
        ptype: "data",
        srcMac: opts.srcMac,
        dstMac: opts.dstMac,
        sessionKey: opts.sessionKey,
        clientType: opts.clientType ?? CLIENT_TYPE_MACTELNET,
        counter: opts.counter,
        data: opts.shellData,
    });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    if (arrays.length === 0) return new Uint8Array(0);
    if (arrays.length === 1) return arrays[0] ?? new Uint8Array(0);
    const total = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
