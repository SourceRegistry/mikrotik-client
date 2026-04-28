/**
 * @module netinstall/bootp
 * @internal BootpServer is also exported for use by NetinstallSession.
 *
 * BOOTP/DHCP packet codec for netinstall protocol.
 *
 * BOOTP is a UDP protocol (port 67 server, 68 client) used for device discovery
 * during netinstall. This module provides parsers and builders for BOOTP packets.
 *
 * @example
 * ```ts
 * import { parseBootpPacket, buildDhcpOffer } from "@sourceregistry/mikrotik-client/netinstall";
 *
 * // Parse a DHCP DISCOVER from a device
 * const discover = parseBootpPacket(buffer);
 * if (discover.messageType === "discover") {
 *   // Build DHCPOFFER response
 *   const offer = buildDhcpOffer({
 *     transactionId: discover.transactionId,
 *     clientMac: discover.clientMac,
 *     serverIp: "192.168.1.100",
 *     bootfile: "netinstall-img.npk",
 *   });
 * }
 * ```
 */

import dgram from "node:dgram";
import { EventEmitter } from "node:events";

// ── Types ──────────────────────────────────────────────────────────────────────

/** BOOTP operation codes */
export type BootpOpCode = "bootRequest" | "bootReply";

/** DHCP message types (from option 53) */
export type DhcpMessageType =
  | "discover"
  | "offer"
  | "request"
  | "decline"
  | "ack"
  | "nak"
  | "release"
  | "inform";

/** BOOTP packet structure (RFC 951) */
export interface BootpPacket {
  /** Operation code: 1=request, 2=reply */
  op: BootpOpCode;
  /** Hardware type (1=Ethernet) */
  hardwareType: number;
  /** Hardware address length (6 for Ethernet) */
  hardwareLen: number;
  /** Number of hops (0 for direct) */
  hops: number;
  /** Transaction ID (random, matches request/reply) */
  transactionId: number;
  /** Seconds elapsed since booting started */
  seconds: number;
  /** Flags (0x8000=broadcast, 0x0000=unicast) */
  flags: number;
  /** Client IP address (ciaddr) */
  clientIp: string;
  /** Your IP address (yiaddr) */
  yourIp: string;
  /** Server IP address (siaddr) */
  serverIp: string;
  /** Gateway IP address (giaddr) */
  gatewayIp: string;
  /** Client MAC address (chaddr) */
  clientMac: string;
  /** Server host name (sname) */
  serverName: string;
  /** Boot file name (file) */
  bootFileName: string;
  /** Magic cookie (0x63825363) */
  magicCookie: number;
  /** DHCP options */
  options: DhcpOption[];
  /** DHCP message type (from option 53, if present) */
  messageType?: DhcpMessageType;
}

/** DHCP option structure */
export interface DhcpOption {
  /** Option code (1-255) */
  code: number;
  /** Option data */
  data: Uint8Array;
  /** Option length */
  length: number;
}

/** DHCP message type codes */
export const DHCP_MESSAGE_TYPES: Readonly<Record<DhcpMessageType, number>> = {
  discover: 1,
  offer: 2,
  request: 3,
  decline: 4,
  ack: 5,
  nak: 6,
  release: 7,
  inform: 8,
} as const;

/** Well-known DHCP option codes */
export const DHCP_OPTION_CODES = {
  subnetMask: 1,
  router: 3,
  dnsServer: 6,
  hostname: 12,
  broadcastAddress: 28,
  messageType: 53,
  serverIdentifier: 54,
  outputFile: 67,
  parameterRequestList: 55,
  message: 56,
  maxMessageSize: 57,
  renewTimeValue: 58,
  rebindingTimeValue: 59,
  vendorSpecificInformation: 43,
  vendorClassIdentifier: 46,
  clientId: 61,
  sessionIdentifier: 63,
  relayAgentInformation: 82,
  endOption: 255,
} as const;

// ── Constants ──────────────────────────────────────────────────────────────────

/** BOOTP packet fixed header length (excluding options) */
export const BOOTP_HEADER_LEN = 236;

/** BOOTP server port */
export const BOOTP_SERVER_PORT = 67;

/** BOOTP client port */
export const BOOTP_CLIENT_PORT = 68;

/** BOOTP magic cookie value */
export const BOOTP_MAGIC_COOKIE = 0x63825363;

/** Ethernet hardware type */
export const HARDWARE_TYPE_ETHERNET = 1;

/** Ethernet MAC address length */
export const ETHERNET_HLEN = 6;

// ── Parser ─────────────────────────────────────────────────────────────────────

/**
 * Parse a BOOTP packet from raw UDP data.
 *
 * @param data - Raw packet bytes (minimum 236 + options)
 * @returns Parsed BOOTP packet
 * @throws Error if packet is malformed
 *
 * @example
 * ```ts
 * const packet = parseBootpPacket(buffer);
 * console.log(packet.clientMac); // "aa:bb:cc:dd:ee:ff"
 * ```
 */
export function parseBootpPacket(data: Uint8Array): BootpPacket {
  if (data.length < BOOTP_HEADER_LEN) {
    throw new Error(
      `Invalid BOOTP packet: expected at least ${BOOTP_HEADER_LEN} bytes, got ${data.length}`
    );
  }

  const rawOp = data[0]!;
  const op = rawOp === 1 ? "bootRequest" : rawOp === 2 ? "bootReply" : undefined;
  if (!op) {
    throw new Error(`Invalid BOOTP op code: ${rawOp}`);
  }

  const hwType = data[1]!;
  const hwLen = data[2]!;
  const hops = data[3]!;

  // Transaction ID (4 bytes, big-endian)
  const transactionId = ((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0;

  // Seconds (2 bytes)
  const seconds = (data[8]! << 8) | data[9]!;

  // Flags (2 bytes)
  const flags = (data[10]! << 8) | data[11]!;

  // ciaddr (4 bytes, offset 12)
  const clientIp = bytesToIp(data.slice(12, 16));

  // yiaddr (4 bytes, offset 16)
  const yourIp = bytesToIp(data.slice(16, 20));

  // siaddr (4 bytes, offset 20)
  const serverIp = bytesToIp(data.slice(20, 24));

  // giaddr (4 bytes, offset 24)
  const gatewayIp = bytesToIp(data.slice(24, 28));

  // chaddr (16 bytes, offset 28) — first hwLen bytes are MAC
  const clientMac = bytesToMac(data.slice(28, 28 + hwLen));

  // sname (64 bytes, offset 44, null-terminated)
  const serverName = toAsciiString(data, 44, 108);

  // file (128 bytes, offset 108, null-terminated)
  const bootFileName = toAsciiString(data, 108, 236);

  // Magic cookie (4 bytes, offset 236)
  const magicCookie =
    ((data[236]! << 24) | (data[237]! << 16) | (data[238]! << 8) | data[239]!) >>> 0;

  // DHCP options (after magic cookie, offset 240)
  const options = parseDhcpOptions(data.slice(240));

  const messageType = getMessageType(options);

  return {
    op,
    hardwareType: hwType,
    hardwareLen: hwLen,
    hops,
    transactionId,
    seconds,
    flags,
    clientIp,
    yourIp,
    serverIp,
    gatewayIp,
    clientMac,
    serverName,
    bootFileName,
    magicCookie,
    options,
    ...(messageType !== undefined && { messageType }),
  };
}

/**
 * Parse DHCP options from raw bytes.
 *
 * @param data - Raw option bytes (starts after magic cookie)
 * @returns Array of DHCP options
 */
function parseDhcpOptions(data: Uint8Array): DhcpOption[] {
  const options: DhcpOption[] = [];
  let offset = 0;

  while (offset < data.length) {
    const code = data[offset]!;

    // End option (255)
    if (code === 255) break;

    // Pad option (0) — skip
    if (code === 0) {
      offset++;
      continue;
    }

    if (offset + 1 >= data.length) break;

    const length = data[offset + 1]!;
    if (offset + 2 + length > data.length) break;

    options.push({
      code,
      data: data.slice(offset + 2, offset + 2 + length),
      length,
    });

    offset += 2 + length;
  }

  return options;
}

/**
 * Get DHCP message type from options (option 53).
 *
 * @param options - DHCP options array
 * @returns Message type string or undefined
 */
export function getMessageType(options: DhcpOption[]): DhcpMessageType | undefined {
  const opt53 = options.find((opt) => opt.code === 53);
  if (!opt53 || opt53.length !== 1) return undefined;

  const num = opt53.data[0]!;
  const typeMap: Readonly<Record<number, DhcpMessageType>> = {
    1: "discover",
    2: "offer",
    3: "request",
    4: "decline",
    5: "ack",
    6: "nak",
    7: "release",
    8: "inform",
  };

  return typeMap[num];
}

/**
 * Get option data by code.
 *
 * @param options - DHCP options array
 * @param code - Option code to find
 * @returns Option data or undefined
 */
export function getOptionData(options: DhcpOption[], code: number): Uint8Array | undefined {
  const option = options.find((opt) => opt.code === code);
  return option?.data;
}

// ── Builder ────────────────────────────────────────────────────────────────────

/** Options for building a DHCP OFFER */
export interface DhcpOfferOptions {
  /** Transaction ID to match client request */
  transactionId: number;
  /** Client MAC address (from received DISCOVER) */
  clientMac: string;
  /** Server IP address (our address) */
  serverIp: string;
  /** Boot file name to serve via TFTP */
  bootfile: string;
  /** Client IP offered (optional, defaults to serverIp) */
  clientIp?: string;
}

/**
 * Build a DHCP OFFER reply packet.
 *
 * @param opts - Options for building the DHCPOFFER
 * @returns Raw BOOTP/DHCP packet bytes
 *
 * @example
 * ```ts
 * const offer = buildDhcpOffer({
 *   transactionId: discoverPacket.transactionId,
 *   clientMac: discoverPacket.clientMac,
 *   serverIp: "192.168.1.100",
 *   bootfile: "netinstall-7.14.npk",
 * });
 * ```
 */
export function buildDhcpOffer(opts: DhcpOfferOptions): Uint8Array {
  const { transactionId, clientMac, serverIp, bootfile } = opts;
  const clientIp = opts.clientIp ?? serverIp;

  // Fixed header (236 bytes) + options (512 bytes should be enough)
  const packet = new Uint8Array(BOOTP_HEADER_LEN + 512);

  // op = 2 (bootReply)
  packet[0] = 2;

  // hwtype = 1 (Ethernet)
  packet[1] = HARDWARE_TYPE_ETHERNET;

  // hlen = 6
  packet[2] = 6;

  // Transaction ID (4 bytes, big-endian)
  packet[4] = (transactionId >> 24) & 0xff;
  packet[5] = (transactionId >> 16) & 0xff;
  packet[6] = (transactionId >> 8) & 0xff;
  packet[7] = transactionId & 0xff;

  // ciaddr (4 bytes, offset 12)
  const cIp = ipToBytes(clientIp);
  packet[12] = cIp[0]!;
  packet[13] = cIp[1]!;
  packet[14] = cIp[2]!;
  packet[15] = cIp[3]!;

  // yiaddr (4 bytes, offset 16)
  packet[16] = cIp[0]!;
  packet[17] = cIp[1]!;
  packet[18] = cIp[2]!;
  packet[19] = cIp[3]!;

  // siaddr (4 bytes, offset 20)
  const sIp = ipToBytes(serverIp);
  packet[20] = sIp[0]!;
  packet[21] = sIp[1]!;
  packet[22] = sIp[2]!;
  packet[23] = sIp[3]!;

  // chaddr (6 bytes, offset 28)
  const macBytes = macToBytes(clientMac);
  packet[28] = macBytes[0]!;
  packet[29] = macBytes[1]!;
  packet[30] = macBytes[2]!;
  packet[31] = macBytes[3]!;
  packet[32] = macBytes[4]!;
  packet[33] = macBytes[5]!;

  // Magic cookie (4 bytes, offset 236)
  packet[236] = (BOOTP_MAGIC_COOKIE >> 24) & 0xff;
  packet[237] = (BOOTP_MAGIC_COOKIE >> 16) & 0xff;
  packet[238] = (BOOTP_MAGIC_COOKIE >> 8) & 0xff;
  packet[239] = BOOTP_MAGIC_COOKIE & 0xff;

  // Build DHCP options at offset 240
  const options = buildOfferOptions(serverIp, bootfile);
  packet.set(options, 240);

  return packet.slice(0, 240 + options.length);
}

/**
 * Build DHCP options for DHCPOFFER.
 */
function buildOfferOptions(serverIp: string, bootfile: string): Uint8Array {
  const sIp = ipToBytes(serverIp);
  const bootfileBytes = asciiToBytes(bootfile);

  // Option 53: DHCP Message Type (Offer = 2)
  // Option 54: Server Identifier
  // Option 67: Bootfile Name
  // Option 255: End
  return concat(
    new Uint8Array([53, 1, 2]), // Message Type: Offer
    new Uint8Array([54, 4, sIp[0]!, sIp[1]!, sIp[2]!, sIp[3]!]), // Server ID
    new Uint8Array([67, bootfileBytes.length, ...bootfileBytes]), // Bootfile
    new Uint8Array([255]) // End
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert 4 bytes to IP string */
function bytesToIp(bytes: Uint8Array): string {
  return [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!].join(".");
}

/** Convert MAC bytes to string (colon-separated) */
function bytesToMac(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":");
}

/** Extract null-terminated ASCII string from buffer */
function toAsciiString(data: Uint8Array, start: number, end: number): string {
  let result = "";
  for (let i = start; i < end; i++) {
    if (data[i] === 0) break;
    result += String.fromCharCode(data[i]!);
  }
  return result;
}

/** Convert IP string to byte array */
function ipToBytes(ip: string): number[] {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
  return parts;
}

/** Convert MAC string to byte array */
function macToBytes(mac: string): number[] {
  const cleaned = mac.replace(/[:\-]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < 6; i++) {
    bytes.push(parseInt(cleaned.slice(i * 2, i * 2 + 2), 16));
  }
  return bytes;
}

/** Encode ASCII string to byte array */
function asciiToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** Concatenate multiple Uint8Arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ── BootpServer ────────────────────────────────────────────────────────────────

/** Options for {@link BootpServer}. */
export interface BootpServerOptions {
  /** Server IP address placed in DHCPOFFER (siaddr / option 54). */
  serverIp: string;
  /** Boot filename advertised to the device (option 67). */
  bootfile: string;
  /**
   * If set, only respond to DISCOVER packets from this MAC address.
   * All others are silently ignored.
   */
  deviceMac?: string;
}

/** Payload of the `"offer"` event emitted by {@link BootpServer}. */
export interface BootpOfferEvent {
  clientMac: string;
  serverIp: string;
  bootfile: string;
}

/**
 * Single-session BOOTP/DHCP server for netinstall device discovery.
 *
 * Listens for DHCP DISCOVER broadcasts on UDP port 67 and responds with a
 * DHCPOFFER carrying the TFTP server address and boot filename.
 *
 * Emits:
 * - `"discover"` `BootpPacket` — DISCOVER received (before OFFER sent).
 * - `"offer"` `BootpOfferEvent` — OFFER sent successfully.
 * - `"error"` `Error` — socket or encoding error.
 *
 * @example
 * ```ts
 * const server = new BootpServer({ serverIp: "192.168.88.1", bootfile: "netinstall.img" });
 * server.on("offer", ({ clientMac }) => console.log("Offered to", clientMac));
 * await server.listen();
 * ```
 */
export class BootpServer extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private readonly serverIp: string;
  private readonly bootfile: string;
  private readonly deviceMac: string | undefined;

  constructor(opts: BootpServerOptions) {
    super();
    this.serverIp = opts.serverIp;
    this.bootfile = opts.bootfile;
    this.deviceMac = opts.deviceMac?.toLowerCase();
  }

  /**
   * Bind the BOOTP UDP socket and start listening.
   *
   * @param port - Port to bind. Default: {@link BOOTP_SERVER_PORT} (67).
   */
  listen(port: number = BOOTP_SERVER_PORT): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.socket = sock;

      sock.on("error", (err) => {
        if (!this.socket) return;
        this.emit("error", err);
      });

      sock.on("message", (msg, _rinfo) => {
        try {
          this.handleMessage(msg);
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      });

      sock.on("listening", () => {
        try {
          sock.setBroadcast(true);
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      try {
        sock.bind(port);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Close the UDP socket. */
  close(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }

  private handleMessage(msg: Buffer): void {
    let packet: ReturnType<typeof parseBootpPacket>;
    try {
      packet = parseBootpPacket(msg);
    } catch {
      return; // malformed packet — ignore
    }

    if (packet.messageType !== "discover") return;

    if (this.deviceMac !== undefined && packet.clientMac.toLowerCase() !== this.deviceMac) {
      return; // not our device
    }

    this.emit("discover", packet);

    const offer = buildDhcpOffer({
      transactionId: packet.transactionId,
      clientMac: packet.clientMac,
      serverIp: this.serverIp,
      bootfile: this.bootfile,
    });

    this.socket?.send(offer, BOOTP_CLIENT_PORT, "255.255.255.255", (err) => {
      if (err) {
        this.emit("error", err);
        return;
      }
      this.emit("offer", {
        clientMac: packet.clientMac,
        serverIp: this.serverIp,
        bootfile: this.bootfile,
      } satisfies BootpOfferEvent);
    });
  }
}
