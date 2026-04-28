/**
 * @module netinstall
 *
 * MikroTik Netinstall protocol implementation.
 *
 * Provides a programmatic API for reflashing RouterOS devices over the network
 * using the BOOTP discovery + TFTP image delivery protocol.
 *
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { NetinstallSession } from "@sourceregistry/mikrotik-client/netinstall";
 *
 * const session = new NetinstallSession({
 *   imageBuffer: readFileSync("netinstall-7.14.img"),
 *   serverIp: "192.168.88.1",
 *   bootfile: "netinstall-7.14.img",
 *   deviceMac: "aa:bb:cc:dd:ee:ff",
 * });
 *
 * session.on("progress", (evt) => console.log(evt.kind));
 * await session.start();
 * ```
 */

// ── Session ────────────────────────────────────────────────────────────────────
export { NetinstallSession } from "./session";
export type {
    NetinstallSessionOptions,
    NetinstallSessionState,
    NetinstallProgressEvent,
} from "./session";

// ── BOOTP ──────────────────────────────────────────────────────────────────────
export { BootpServer, parseBootpPacket, buildDhcpOffer, getMessageType, getOptionData } from "./bootp";
export type {
    BootpServerOptions,
    BootpOfferEvent,
    BootpPacket,
    BootpOpCode,
    DhcpMessageType,
    DhcpOption,
    DhcpOfferOptions,
} from "./bootp";
export {
    BOOTP_HEADER_LEN,
    BOOTP_SERVER_PORT,
    BOOTP_CLIENT_PORT,
    BOOTP_MAGIC_COOKIE,
    HARDWARE_TYPE_ETHERNET,
    ETHERNET_HLEN,
    DHCP_MESSAGE_TYPES,
    DHCP_OPTION_CODES,
} from "./bootp";

// ── TFTP ───────────────────────────────────────────────────────────────────────
export { TftpServer, parseTftpPacket, buildTftpData, buildTftpAck, buildTftpError, isSafeFilename } from "./tftp";
export type {
    TftpServerOptions,
    TftpProgressEvent,
    TftpPacket,
    TftpPacketType,
    TftpRrqPacket,
    TftpWrqPacket,
    TftpDataPacket,
    TftpAckPacket,
    TftpErrorPacket,
} from "./tftp";
export {
    TFTP_BLOCK_SIZE,
    TFTP_PORT,
    TFTP_MAX_PACKET_SIZE,
    TFTP_ERROR_CODES,
} from "./tftp";
