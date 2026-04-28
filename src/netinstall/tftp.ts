/**
 * @module netinstall/tftp
 *
 * TFTP (Trivial File Transfer Protocol) codec for netinstall firmware delivery.
 *
 * TFTP is a lightweight UDP-based file transfer protocol (RFC 1350). MikroTik
 * netinstall uses TFTP to deliver the netinstall image to booting devices.
 *
 * @example
 * ```ts
 * import { parseTftpPacket, buildTftpData } from "@sourceregistry/mikrotik-client/netinstall";
 *
 * // Parse incoming RRQ
 * const rrq = parseTftpPacket(buffer);
 * if (rrq.type === "rrq") {
 *   console.log("File request:", rrq.filename);
 *   // Send DATA blocks...
 *   const dataBlock = buildTftpData(1, chunk);
 * }
 * ```
 */

import dgram from "node:dgram";
import { EventEmitter } from "node:events";

// ── Types ──────────────────────────────────────────────────────────────────────

/** TFTP packet types */
export type TftpPacketType = "rrq" | "wrq" | "data" | "ack" | "error";

/** TFTP packet types as numbers */
export type TftpTypeNumber = 1 | 2 | 3 | 4 | 5;

/** TFTP Read Request packet */
export interface TftpRrqPacket {
    type: "rrq";
    /** Filename requested by client */
    filename: string;
    /** Transfer mode (usually "netascii" or "octet") */
    mode: string;
}

/** TFTP Write Request packet */
export interface TftpWrqPacket {
    type: "wrq";
    /** Filename to write to */
    filename: string;
    /** Transfer mode */
    mode: string;
}

/** TFTP Data packet */
export interface TftpDataPacket {
    type: "data";
    /** Block number (1-based) */
    blockNumber: number;
    /** Data payload (up to TFTP_BLOCK_SIZE bytes) */
    data: Uint8Array;
}

/** TFTP Acknowledgment packet */
export interface TftpAckPacket {
    type: "ack";
    /** Block number acknowledged */
    blockNumber: number;
}

/** TFTP Error packet */
export interface TftpErrorPacket {
    type: "error";
    /** Error code */
    errorCode: number;
    /** Error message */
    errorMessage: string;
}

/** Union of all TFTP packet types */
export type TftpPacket =
    | TftpRrqPacket
    | TftpWrqPacket
    | TftpDataPacket
    | TftpAckPacket
    | TftpErrorPacket;

/** TFTP error codes (RFC 1350) */
export const TFTP_ERROR_CODES = {
    fileNotFound: 1,
    accessViolation: 2,
    diskFull: 3,
    illegalOperation: 4,
    unknownTransferId: 5,
    fileExists: 6,
    noSuchUser: 7,
} as const;

/** Default TFTP block size (512 bytes per RFC 1350) */
export const TFTP_BLOCK_SIZE = 512;

/** TFTP server port */
export const TFTP_PORT = 69;

/** Maximum TFTP packet size (654 - header overhead) */
export const TFTP_MAX_PACKET_SIZE = 654;

// ── Parser ─────────────────────────────────────────────────────────────────────

/**
 * Parse a TFTP packet from raw UDP data.
 *
 * @param data - Raw TFTP packet bytes
 * @returns Parsed TFTP packet
 * @throws Error if packet is malformed
 *
 * @example
 * ```ts
 * const packet = parseTftpPacket(buffer);
 * if (packet.type === "rrq") {
 *   console.log("Request for:", packet.filename);
 * }
 * ```
 */
export function parseTftpPacket(data: Uint8Array): TftpPacket {
    if (data.length < 2) {
        throw new Error(`Invalid TFTP packet: too short (${data.length} bytes)`);
    }

    const typeNum = (data[0]! << 8) | data[1]!;

    switch (typeNum) {
        case 1: // RRQ
        case 2: { // WRQ
            const type = typeNum === 1 ? "rrq" : "wrq";
            return parseRequestPacket(data, type);
        }
        case 3: { // DATA
            return parseDataPacket(data);
        }
        case 4: { // ACK
            return parseAckPacket(data);
        }
        case 5: { // ERROR
            return parseErrorPacket(data);
        }
        default: {
            throw new Error(`Unknown TFTP packet type: ${typeNum}`);
        }
    }
}

/** Parse RRQ/WRQ packets */
function parseRequestPacket(data: Uint8Array, type: "rrq" | "wrq"): TftpRrqPacket | TftpWrqPacket {
    if (data.length < 4) {
        throw new Error(`Invalid ${type.toUpperCase()} packet: too short`);
    }

    // Find filename (null-terminated after offset 2)
    let filenameEnd = data.indexOf(0, 2);
    if (filenameEnd === -1) {
        throw new Error("Invalid RRQ/WRQ: missing null terminator after filename");
    }
    const filename = new TextDecoder().decode(data.slice(2, filenameEnd));

    // Find mode (after filename null, null-terminated)
    const modeStart = filenameEnd + 1;
    if (modeStart >= data.length) {
        throw new Error("Invalid RRQ/WRQ: missing mode field");
    }
    let modeEnd = data.indexOf(0, modeStart);
    if (modeEnd === -1) {
        throw new Error("Invalid RRQ/WRQ: missing null terminator after mode");
    }
    const mode = new TextDecoder().decode(data.slice(modeStart, modeEnd));

    return { type, filename, mode };
}

/** Parse DATA packet */
function parseDataPacket(data: Uint8Array): TftpDataPacket {
    if (data.length < 4) {
        throw new Error("Invalid DATA packet: too short");
    }

    const blockNumber = (data[2]! << 8) | data[3]!;
    const payload = data.slice(4);

    return {
        type: "data",
        blockNumber,
        data: payload,
    };
}

/** Parse ACK packet */
function parseAckPacket(data: Uint8Array): TftpAckPacket {
    if (data.length < 4) {
        throw new Error("Invalid ACK packet: too short");
    }

    const blockNumber = (data[2]! << 8) | data[3]!;

    return {
        type: "ack",
        blockNumber,
    };
}

/** Parse ERROR packet */
function parseErrorPacket(data: Uint8Array): TftpErrorPacket {
    if (data.length < 4) {
        throw new Error("Invalid ERROR packet: too short");
    }

    const errorCode = (data[2]! << 8) | data[3]!;

    // Error message (null-terminated, starts at offset 4)
    let msgEnd = data.indexOf(0, 4);
    const errorMessage =
        msgEnd === -1
            ? new TextDecoder().decode(data.slice(4))
            : new TextDecoder().decode(data.slice(4, msgEnd));

    return {
        type: "error",
        errorCode,
        errorMessage,
    };
}

// ── Builders ───────────────────────────────────────────────────────────────────

/**
 * Build a TFTP DATA packet.
 *
 * @param blockNumber - Block number (1-based, 0 = transfer complete)
 * @param data - Data payload (must be <= TFTP_BLOCK_SIZE)
 * @returns Raw TFTP packet bytes
 *
 * @example
 * ```ts
 * const chunk = file.slice(0, TFTP_BLOCK_SIZE);
 * const packet = buildTftpData(1, chunk);
 * ```
 */
export function buildTftpData(blockNumber: number, data: Uint8Array): Uint8Array {
    if (data.length > TFTP_BLOCK_SIZE) {
        throw new Error(`TFTP data too large: ${data.length} > ${TFTP_BLOCK_SIZE}`);
    }

    const packet = new Uint8Array(4 + data.length);

    // Type: DATA (3)
    packet[0] = 0;
    packet[1] = 3;

    // Block number
    packet[2] = (blockNumber >> 8) & 0xff;
    packet[3] = blockNumber & 0xff;

    // Data payload
    packet.set(data, 4);

    return packet;
}

/**
 * Build a TFTP ACK packet.
 *
 * @param blockNumber - Block number being acknowledged
 * @returns Raw TFTP ACK packet bytes
 *
 * @example
 * ```ts
 * const ack = buildTftpAck(1);
 * ```
 */
export function buildTftpAck(blockNumber: number): Uint8Array {
    const packet = new Uint8Array(4);

    // Type: ACK (4)
    packet[0] = 0;
    packet[1] = 4;

    // Block number
    packet[2] = (blockNumber >> 8) & 0xff;
    packet[3] = blockNumber & 0xff;

    return packet;
}

/**
 * Build a TFTP ERROR packet.
 *
 * @param errorCode - TFTP error code
 * @param errorMessage - Human-readable error message
 * @returns Raw TFTP ERROR packet bytes
 *
 * @example
 * ```ts
 * const error = buildTftpError(TFTP_ERROR_CODES.fileNotFound, "File not found");
 * ```
 */
export function buildTftpError(errorCode: number, errorMessage: string): Uint8Array {
    const msgBytes = new TextEncoder().encode(errorMessage);
    const packet = new Uint8Array(4 + msgBytes.length + 1); // +1 for null terminator

    // Type: ERROR (5)
    packet[0] = 0;
    packet[1] = 5;

    // Error code
    packet[2] = (errorCode >> 8) & 0xff;
    packet[3] = errorCode & 0xff;

    // Error message
    packet.set(msgBytes, 4);

    // Null terminator
    packet[4 + msgBytes.length] = 0;

    return packet;
}

// ── TftpServer ─────────────────────────────────────────────────────────────────

/** Progress event emitted by {@link TftpServer} after each acknowledged block. */
export interface TftpProgressEvent {
    /** Block number just acknowledged (1-based). */
    blockNumber: number;
    /** Total bytes transferred so far. */
    bytesTransferred: number;
    /** Total image size in bytes. */
    totalBytes: number;
}

/** Options for {@link TftpServer}. */
export interface TftpServerOptions {
    /** Image bytes to serve. */
    imageBuffer: Buffer;
    /**
     * If set, only RRQ for this exact filename is served.
     * All other filenames receive a FILE_NOT_FOUND error.
     */
    allowedFilename?: string;
    /** Retransmit timeout in ms when no ACK arrives. Default: 1000. */
    retransmitMs?: number;
}

/** Active transfer state. */
type TftpTransfer = {
    clientAddress: string;
    clientPort: number;
    /** Block we last sent and are waiting to be ACKed (1-based). */
    currentBlock: number;
    retransmitTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * Single-session TFTP server that serves one image file.
 *
 * Emits:
 * - `"request"` `{ filename: string; clientAddress: string }` — RRQ received, transfer starting.
 * - `"progress"` `TftpProgressEvent` — block ACKed.
 * - `"complete"` — all blocks transferred and ACKed.
 * - `"error"` `Error` — socket or protocol error.
 *
 * @example
 * ```ts
 * const server = new TftpServer({ imageBuffer: fs.readFileSync("netinstall.img") });
 * server.on("complete", () => console.log("Transfer complete"));
 * await server.listen();
 * ```
 */
export class TftpServer extends EventEmitter {
    private socket: dgram.Socket | null = null;
    private readonly imageBuffer: Buffer;
    private readonly allowedFilename: string | undefined;
    private readonly retransmitMs: number;
    private transfer: TftpTransfer | null = null;

    constructor(opts: TftpServerOptions) {
        super();
        this.imageBuffer = opts.imageBuffer;
        this.allowedFilename = opts.allowedFilename;
        this.retransmitMs = opts.retransmitMs ?? 1000;
    }

    /**
     * Bind the TFTP UDP socket and start listening.
     *
     * @param port - Port to bind. Default: {@link TFTP_PORT} (69).
     */
    listen(port: number = TFTP_PORT): Promise<void> {
        return new Promise<void>((resolve, _reject) => {
            const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
            this.socket = sock;

            sock.on("error", (err) => this.emit("error", err));

            sock.on("message", (msg, rinfo) => {
                try {
                    this.handleMessage(msg, rinfo);
                } catch (err) {
                    this.emit("error", err instanceof Error ? err : new Error(String(err)));
                }
            });

            sock.on("listening", () => resolve());

            sock.bind(port);
        });
    }

    /** Close the UDP socket and cancel any active transfer. */
    close(): void {
        this.cancelRetransmit();
        this.transfer = null;
        if (this.socket) {
            try { this.socket.close(); } catch { /* ignore */ }
            this.socket = null;
        }
    }

    private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        const packet = parseTftpPacket(msg);

        if (packet.type === "rrq") {
            this.handleRrq(packet, rinfo);
        } else if (packet.type === "ack" && this.transfer !== null) {
            this.handleAck(packet);
        }
    }

    private handleRrq(packet: TftpRrqPacket, rinfo: dgram.RemoteInfo): void {
        if (!isSafeFilename(packet.filename)) {
            this.sendError(rinfo, TFTP_ERROR_CODES.accessViolation, "Invalid filename");
            return;
        }

        if (this.allowedFilename !== undefined && packet.filename !== this.allowedFilename) {
            this.sendError(rinfo, TFTP_ERROR_CODES.fileNotFound, "File not found");
            return;
        }

        this.cancelRetransmit();
        this.transfer = {
            clientAddress: rinfo.address,
            clientPort: rinfo.port,
            currentBlock: 1,
            retransmitTimer: null,
        };

        this.emit("request", { filename: packet.filename, clientAddress: rinfo.address });
        this.sendBlock(1);
    }

    private handleAck(packet: TftpAckPacket): void {
        if (this.transfer === null) return;
        if (packet.blockNumber !== this.transfer.currentBlock) return; // stale

        this.cancelRetransmit();

        const block = packet.blockNumber;
        const offset = (block - 1) * TFTP_BLOCK_SIZE;
        const bytesTransferred = Math.min(block * TFTP_BLOCK_SIZE, this.imageBuffer.length);

        this.emit("progress", {
            blockNumber: block,
            bytesTransferred,
            totalBytes: this.imageBuffer.length,
        } satisfies TftpProgressEvent);

        // The block just ACKed was < 512 bytes → it was the final block
        const chunk = this.imageBuffer.subarray(offset, offset + TFTP_BLOCK_SIZE);
        if (chunk.length < TFTP_BLOCK_SIZE) {
            this.transfer = null;
            this.emit("complete");
            return;
        }

        this.sendBlock(block + 1);
    }

    private sendBlock(blockNumber: number): void {
        if (this.transfer === null || this.socket === null) return;

        const offset = (blockNumber - 1) * TFTP_BLOCK_SIZE;
        const chunk = this.imageBuffer.subarray(offset, offset + TFTP_BLOCK_SIZE);
        const dataPacket = buildTftpData(blockNumber, chunk);

        this.transfer.currentBlock = blockNumber;

        this.socket.send(
            dataPacket,
            this.transfer.clientPort,
            this.transfer.clientAddress,
            (err) => {
                if (err) { this.emit("error", err); return; }
                if (this.transfer === null) return;
                this.transfer.retransmitTimer = setTimeout(
                    () => this.retransmitBlock(blockNumber),
                    this.retransmitMs,
                );
            },
        );
    }

    private retransmitBlock(blockNumber: number): void {
        if (this.transfer === null || this.transfer.currentBlock !== blockNumber) return;
        this.transfer.retransmitTimer = null;
        this.sendBlock(blockNumber);
    }

    private cancelRetransmit(): void {
        if (this.transfer?.retransmitTimer !== null && this.transfer?.retransmitTimer !== undefined) {
            clearTimeout(this.transfer.retransmitTimer);
            this.transfer.retransmitTimer = null;
        }
    }

    private sendError(rinfo: dgram.RemoteInfo, code: number, message: string): void {
        const pkt = buildTftpError(code, message);
        this.socket?.send(pkt, rinfo.port, rinfo.address, () => { /* best-effort */ });
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Validate that a TFTP filename is safe (no path traversal).
 *
 * @param filename - Filename to validate.
 * @returns `true` if the filename is safe.
 */
export function isSafeFilename(filename: string): boolean {
    return (
        filename.length > 0 &&
        !filename.includes("..") &&
        !filename.startsWith("/") &&
        !filename.startsWith("\\") &&
        !filename.includes("\0")
    );
}
