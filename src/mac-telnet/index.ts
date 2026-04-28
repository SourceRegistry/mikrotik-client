/**
 * @module mac-telnet
 *
 * MAC-Telnet transport for MikroTik RouterOS devices.
 *
 * MAC-Telnet is a Layer 2 protocol (UDP/20561) used to bootstrap RouterOS
 * devices directly over Ethernet. It supports shell commands and EC-SRP
 * authentication.
 *
 * @example
 * ```ts
 * import { MacTelnetClient, listActiveInterfaces, validateInterface } from "@sourceregistry/mikrotik-client/mac-telnet";
 *
 * // List active network interfaces
 * const interfaces = listActiveInterfaces();
 * console.log("Active interfaces:", interfaces.map((i) => i.name));
 *
 * // Create a client targeting a RouterOS device
 * const client = new MacTelnetClient({
 *   targetMac: "aa:bb:cc:dd:ee:ff",
 *   username: "admin",
 *   password: "password",
 *   authType: "ec-srp", // or "md5" for legacy devices
 * });
 *
 * // Connect and run commands
 * await client.connect();
 * const result = await client.sendCommand("/system/identity/print");
 * console.log(result.output);
 *
 * // Disconnect
 * await client.disconnect();
 * ```
 */

// ── Client ──────────────────────────────────────────────────────────────────────

export {
    MacTelnetClient,
    BROADCAST_MAC,
} from "./client";
export type {
    MacTelnetClientConfig,
    ShellCommandResult,
    StateChangeEvent,
    RawDataEvent,
    ShellDataEvent,
    AuthType,
    ClientState,
} from "./client";

// ── Packet Codec ────────────────────────────────────────────────────────────

export {
    encodePacket,
    decodePacket,
    decodeControlPackets,
    encodeControlPacket,
    parseMac,
    formatMac,
    buildStartPacket,
    buildEndPacket,
    buildControlDataPacket,
    buildShellDataPacket,
    buildAckPacket,
    CONTROL_PACKET_MAGIC_BYTES,
    HEADER_LEN,
    CONTROL_HEADER_LEN,
    MACTELNET_PORT,
    PROTOCOL_VERSION as PACKET_PROTOCOL_VERSION,
    CLIENT_TYPE_MACTELNET,
    CLIENT_TYPE_WINBOX,
    MAX_PACKET_SIZE,
    MAC_TELNET_CONTROL_PACKET_TYPES,
    MAC_TELNET_PACKET_TYPES,
} from "./packet";
export type {
    MacTelnetPacketType,
    MacTelnetControlPacketType,
    MacTelnetPacket,
    MacTelnetControlPacket,
} from "./packet";

// ── Authentication ────────────────────────────────────────────────────────

export {
    generateClientECDHKey,
    computeMD5Hash,
    computeECSRPHash,
    parseEcPoint,
    isValidEcPublicKey,
    EC_CURVE,
    EC_COORDINATE_SIZE,
    EC_POINT_UNCOMPRESSED_SIZE,
} from "./auth";
export type { ECKeyPair } from "./auth";

// ── Session State Machine ────────────────────────────────────────────────────

export {
    createSessionState,
    stageFromState,
    transitionState,
    updateByteCounter,
    sessionError,
    createRetransmitEvent,
    resetRetransmit,
} from "./session";
export type {
    SessionState,
    SessionStage,
    MacTelnetSession,
    ByteCounter,
    SessionEvent,
} from "./session";

// ── Network Interfaces ──────────────────────────────────────────────────────

export {
    listNetworkInterfaces,
    listActiveInterfaces,
    findInterface,
    validateInterface,
} from "./interfaces";
export type { NetworkInterface, NetworkInterfaceAddress, AddressFamily } from "./interfaces";
