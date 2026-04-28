/**
 * @module mac-telnet/client
 *
 * MAC-Telnet client for MikroTik device communication.
 *
 * MAC-Telnet is a Layer 2 protocol that uses standard UDP (port 20561) for
 * communication with MikroTik devices. It supports both legacy MD5 and
 * modern EC-SRP authentication.
 *
 * @example
 * ```ts
 * import { MacTelnetClient, parseMac } from "@sourceregistry/mikrotik-client/mac-telnet";
 *
 * const client = new MacTelnetClient({
 *   targetMac: "aa:bb:cc:dd:ee:ff",
 *   username: "admin",
 *   password: "password",
 * });
 *
 * await client.connect();
 * const result = await client.sendCommand("/system/identity/print");
 * console.log(result.output);
 * await client.disconnect();
 * ```
 */

import type * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import dgram from "node:dgram";
import {
  decodePacket,
  decodeControlPackets,
  buildStartPacket,
  buildEndPacket,
  buildControlDataPacket,
  buildShellDataPacket,
  buildAckPacket,
  parseMac,
  MACTELNET_PORT,
  HEADER_LEN,
} from "./packet";
import { validateInterface } from "./interfaces";
import type { MacTelnetControlPacket } from "./packet";
import { generateClientECDHKey, computeECSRPHash, computeMD5Hash } from "./auth";
import { createSessionState, transitionState, updateByteCounter } from "./session";
import type { MacTelnetSession } from "./session";

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Default broadcast MAC address for MAC-Telnet discovery.
 */
export const BROADCAST_MAC = "ff:ff:ff:ff:ff:ff";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Authentication type for MAC-Telnet.
 *
 * @example
 * ```ts
 * const authType: AuthType = "ec-srp";
 * ```
 */
export type AuthType = "md5" | "ec-srp";

/**
 * Connection lifecycle states for the client.
 *
 * @example
 * ```ts
 * const state: ClientState = "disconnected";
 * ```
 */
export type ClientState = "disconnected" | "connecting" | "connected" | "disconnecting" | "error";

/**
 * Configuration for {@link MacTelnetClient}.
 *
 * @example
 * ```ts
 * const config: MacTelnetClientConfig = {
 *   targetMac: "aa:bb:cc:dd:ee:ff",
 *   username: "admin",
 *   password: "password",
 *   authType: "ec-srp",
 * };
 * ```
 */
export interface MacTelnetClientConfig {
  /** Target device MAC address. */
  targetMac: string;
  /** Username for authentication. */
  username: string;
  /** Password for authentication. */
  password: string;
  /** Authentication type: MD5 (legacy) or EC-SRP (modern). Default: `"ec-srp"`. */
  authType?: AuthType;
  /** Session key for the connection. Default: random 16-bit value. */
  sessionKey?: number;
  /** Abort signal for cleanup. */
  signal?: AbortSignal;
  /** Timeout for individual operations. Default: 5000ms. */
  timeoutMs?: number;
  /** Number of retry attempts for failed packets. Default: 3. */
  maxRetries?: number;
  /**
   * Name of the local network interface to use (e.g. `"en0"`, `"eth0"`).
   *
   * Required for correct source MAC in packets. The interface must be up
   * and have a valid MAC address. If omitted, source MAC defaults to
   * all-zeros — device replies will not be routable back to the client.
   */
  interfaceName?: string;
  /**
   * Interval in ms between keep-alive ACK packets sent while connected.
   * Default: 1000ms. Set to 0 to disable (not recommended).
   */
  keepAliveIntervalMs?: number;
}

/**
 * Shell command result from {@link MacTelnetClient.sendCommand}.
 *
 * @example
 * ```ts
 * const result = await client.sendCommand("/system/identity/print");
 * console.log(result.output);
 * ```
 */
export interface ShellCommandResult {
  /** The command that was executed. */
  command: string;
  /** Output from the command. */
  output: string;
  /** Whether the command completed successfully. */
  success: boolean;
  /** Session counter used for the command. */
  counter: number;
}

/**
 * Event emitted when a state change occurs.
 *
 * @example
 * ```ts
 * client.on("stateChange", (event) => {
 *   console.log(`State changed from ${event.from} to ${event.to}`);
 * });
 * ```
 */
export interface StateChangeEvent {
  /** Previous state. */
  from: ClientState;
  /** New state. */
  to: ClientState;
  /** Timestamp of the transition. */
  timestamp: number;
}

/**
 * Event emitted when raw data is received.
 *
 * @example
 * ```ts
 * client.on("raw", (event) => {
 *   console.log(`Received ${event.ptype} packet, counter: ${event.counter}`);
 * });
 * ```
 */
export interface RawDataEvent {
  /** Raw packet data. */
  data: Buffer;
  /** Packet type from header. */
  ptype: "start" | "data" | "ack" | "end";
  /** Session counter. */
  counter: number;
}

/**
 * Event emitted when shell output arrives.
 *
 * @example
 * ```ts
 * client.on("data", (event) => {
 *   process.stdout.write(event.text);
 * });
 * ```
 */
export interface ShellDataEvent {
  /** Raw bytes from the device. */
  data: Uint8Array;
  /** Decoded text (latin1). */
  text: string;
}

// ── MacTelnetClient ────────────────────────────────────────────────────────

/**
 * MAC-Telnet client for MikroTik device communication.
 *
 * MAC-Telnet is a Layer 2 protocol that uses standard UDP (port 20561) for
 * communication with MikroTik devices. It supports both legacy MD5 and
 * modern EC-SRP authentication.
 *
 * @example
 * ```ts
 * const client = new MacTelnetClient({
 *   targetMac: "aa:bb:cc:dd:ee:ff",
 *   username: "admin",
 *   password: "password",
 * });
 *
 * await client.connect();
 * const result = await client.sendCommand("/system/identity/print");
 * console.log(result.output);
 * await client.disconnect();
 * ```
 */
export class MacTelnetClient extends EventEmitter {
  // ── Configuration (readonly) ───────────────────────────────────────────

  /** Target device MAC address. */
  readonly targetMac: string;
  /** Username for authentication. */
  readonly username: string;
  /** Password for authentication. */
  readonly password: string;
  /** Authentication type. */
  readonly authType: AuthType;
  /** Timeout for operations. */
  readonly timeoutMs: number;
  /** Maximum retry attempts. */
  readonly maxRetries: number;
  /** Local interface name for source MAC resolution. */
  readonly interfaceName: string | undefined;
  /** Keep-alive ACK interval in ms. */
  readonly keepAliveIntervalMs: number;

  // ── Socket ─────────────────────────────────────────────────────────────

  /** UDP socket for communication. */
  private socket: dgram.Socket | null = null;

  // ── Keep-alive ─────────────────────────────────────────────────────────

  /** Interval handle for keep-alive ACK packets. */
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // ── Source MAC ─────────────────────────────────────────────────────────

  /** Resolved source MAC for outgoing packets. All-zeros until connect(). */
  private sourceMac: Uint8Array = parseMac("00:00:00:00:00:00");

  // ── Session State ──────────────────────────────────────────────────────

  /** Current lifecycle state. */
  private state: ClientState = "disconnected";
  /** Session tracking state. */
  private session: MacTelnetSession | null = null;
  /** Session counter for outgoing packets. */
  private sendCounter: number = 0;
  /** Session key for the connection. */
  private sessionKey: number;

  // ── Pending Operations ────────────────────────────────────────────────

  /** Map of pending command promises keyed by counter. */
  private pendingCommands = new Map<
    number,
    {
      resolve: (result: ShellCommandResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Resolve function for connect() promise. */
  private connectResolve: (() => void) | null = null;
  /** Reject function for connect() promise. */
  private connectReject: ((error: Error) => void) | null = null;
  /** Timeout for connection. */
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Authentication ────────────────────────────────────────────────────

  /** Client ECDH key pair (for EC-SRP auth). */
  private clientECDH: crypto.ECDH | null = null;
  /** Client's ECDH public key (uncompressed, 65 bytes). */
  private clientPublicKey: Uint8Array | null = null;
  /** Server's ECDH public key (uncompressed, 65 bytes). */
  private serverPublicKey: Uint8Array | null = null;
  /** Salt from device for MD5 auth. */
  private deviceSalt: Uint8Array | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  private destroyed = false;

  constructor(config: MacTelnetClientConfig) {
    super();
    this.targetMac = config.targetMac;
    this.username = config.username;
    this.password = config.password;
    this.authType = config.authType ?? "ec-srp";
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.maxRetries = config.maxRetries ?? 3;
    this.sessionKey = config.sessionKey ?? Math.floor(Math.random() * 0xffff);
    this.interfaceName = config.interfaceName;
    this.keepAliveIntervalMs = config.keepAliveIntervalMs ?? 1000;

    if (config.signal) {
      config.signal.addEventListener("abort", () => this.destroy(), {
        once: true,
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Connect to the device and complete authentication.
   *
   * @returns Promise that resolves when the session is authenticated.
   *
   * @example
   * ```ts
   * await client.connect();
   * console.log("Connected!");
   * ```
   */
  async connect(): Promise<void> {
    if (this.destroyed) {
      throw new Error("Client has been destroyed");
    }
    if (this.state !== "disconnected") {
      throw new Error(`Cannot connect: current state is ${this.state}`);
    }

    // Initialize session
    this.session = createSessionState({ sessionKey: this.sessionKey });
    this.setState("connecting");

    // Resolve source MAC from named interface
    if (this.interfaceName !== undefined) {
      const iface = validateInterface(this.interfaceName);
      this.sourceMac = parseMac(iface.mac);
    } else {
      // No interface specified — warn once; device cannot send unicast replies
      // eslint-disable-next-line no-console
      console.warn(
        "[mikrotik-client] MacTelnetClient: no interfaceName set — source MAC is 00:00:00:00:00:00; device replies may not route back"
      );
    }

    // Generate ECDH keys for EC-SRP auth
    if (this.authType === "ec-srp") {
      const keyPair = generateClientECDHKey();
      this.clientECDH = keyPair.ecdh;
      this.clientPublicKey = keyPair.publicKey;
    }

    // Open UDP socket
    await this.openSocket();

    // Send start packet
    const startRaw = buildStartPacket({
      srcMac: this.getLocalMac(),
      dstMac: parseMac(this.targetMac),
      sessionKey: this.sessionKey,
    });
    await this.sendRaw(startRaw);

    // Wait for connection to complete
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      this.connectTimer = setTimeout(() => {
        this.connectResolve = null;
        this.connectReject = null;
        reject(new Error(`Connection timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }

  /**
   * Send a shell command to the device.
   *
   * @param command - The command string to execute.
   * @param options - Optional settings for the command.
   * @returns The command result.
   *
   * @example
   * ```ts
   * const result = await client.sendCommand("/system/identity/print");
   * console.log(result.output);
   * ```
   */
  async sendCommand(
    command: string,
    options?: { timeoutMs?: number }
  ): Promise<ShellCommandResult> {
    if (this.state !== "connected") {
      throw new Error(`Not connected: current state is ${this.state}`);
    }
    if (!this.session) {
      throw new Error("No active session");
    }

    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;

    // Increment counter for new command
    this.sendCounter++;
    const cmdCounter = this.sendCounter;

    // Create shell data packet
    const shellBytes = new TextEncoder().encode(command);
    const packetRaw = buildShellDataPacket({
      srcMac: this.getLocalMac(),
      dstMac: parseMac(this.targetMac),
      sessionKey: this.sessionKey,
      counter: cmdCounter,
      shellData: shellBytes,
    });

    // Set up promise and timeout
    const promise = new Promise<ShellCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(cmdCounter);
        reject(new Error(`Command timeout after ${timeoutMs}ms: "${command}"`));
      }, timeoutMs);

      this.pendingCommands.set(cmdCounter, { resolve, reject, timer });
    });

    // Send packet
    await this.sendRaw(packetRaw);

    // Await response
    const result = await promise;
    this.pendingCommands.delete(cmdCounter);
    return result;
  }

  /**
   * Disconnect from the device gracefully.
   *
   * @returns Promise that resolves when disconnected.
   *
   * @example
   * ```ts
   * await client.disconnect();
   * ```
   */
  async disconnect(): Promise<void> {
    if (this.state === "disconnected" || this.state === "disconnecting") {
      return;
    }

    this.setState("disconnecting");

    // Send end packet
    try {
      const endRaw = buildEndPacket({
        srcMac: this.getLocalMac(),
        dstMac: parseMac(this.targetMac),
        sessionKey: this.sessionKey,
      });
      await this.sendRaw(endRaw);
    } catch {
      // Ignore send errors during disconnect
    }

    this.cleanup();
  }

  /**
   * Destroy the client and release resources.
   *
   * After calling destroy(), the client cannot be reused.
   *
   * @example
   * ```ts
   * client.destroy();
   * ```
   */
  destroy(): void {
    this.destroyed = true;
    this.setState("disconnected");
    this.cleanup();
  }

  // ── Internal Methods ───────────────────────────────────────────────────

  private setState(newState: ClientState): void {
    const oldState = this.state;
    this.state = newState;

    // Update session state
    if (this.session) {
      this.session = transitionState(this.session, sessionState(newState));
    }

    this.emit("stateChange", {
      from: oldState,
      to: newState,
      timestamp: Date.now(),
    } as StateChangeEvent);
  }

  private async openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.socket = dgram.createSocket("udp4");

        this.socket.on("error", (err) => {
          if (!this.destroyed) {
            this.emit("error", err);
          }
        });

        this.socket.on("message", (msg, info) => {
          this.handleMessage(msg, info);
        });

        this.socket.on("listening", () => {
          resolve();
        });

        // Bind to any local address (MAC-Telnet uses UDP broadcast)
        this.socket.bind(0);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async sendRaw(data: Uint8Array): Promise<void> {
    if (!this.socket) {
      throw new Error("Socket not open");
    }

    return new Promise<void>((resolve, reject) => {
      this.socket!.send(data, MACTELNET_PORT, "255.255.255.255", (err) => {
        if (err) reject(err);
        else {
          // Update byte counter
          if (this.session) {
            this.session = updateByteCounter(this.session, data.length, "sent");
          }
          resolve();
        }
      });
    });
  }

  private getLocalMac(): Uint8Array {
    return this.sourceMac;
  }

  private startKeepAlive(): void {
    if (this.keepAliveIntervalMs <= 0 || this.keepAliveTimer !== null) return;
    this.keepAliveTimer = setInterval(() => {
      if (this.state !== "connected" || !this.socket) {
        this.stopKeepAlive();
        return;
      }
      const ackRaw = buildAckPacket({
        srcMac: this.getLocalMac(),
        dstMac: parseMac(this.targetMac),
        sessionKey: this.sessionKey,
        counter: this.sendCounter,
      });
      this.sendRaw(ackRaw).catch(() => {
        // best-effort keep-alive; transient send errors are non-fatal
      });
    }, this.keepAliveIntervalMs);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private handleMessage(msg: Buffer, _info: dgram.RemoteInfo): void {
    try {
      // Decode packet header
      const packet = decodePacket(msg);
      this.emit("raw", {
        data: msg,
        ptype: packet.ptype,
        counter: packet.counter,
      } as RawDataEvent);

      // Update byte counter
      if (this.session) {
        this.session = updateByteCounter(this.session, msg.length, "received");
      }

      // Process based on packet type
      switch (packet.ptype) {
        case "start":
          this.handleStartPacket(packet, msg);
          break;
        case "data":
          this.handleDataPacket(packet, msg);
          break;
        case "ack":
          // ACK packets acknowledge our sends
          break;
        case "end":
          this.handleEndPacket();
          break;
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleStartPacket(_packet: ReturnType<typeof decodePacket>, msg: Buffer): void {
    // The device responds to our START with another START containing a CHALLENGE
    if (this.state === "connecting") {
      const controls = decodeControlPackets(msg.slice(HEADER_LEN));
      for (const control of controls.controlPackets) {
        if (control.type === "passsalt") {
          // Device sends passsalt (challenge) containing salt or EC public key
          this.processChallenge(control);
          break;
        }
      }
    }
  }

  private handleDataPacket(packet: ReturnType<typeof decodePacket>, msg: Buffer): void {
    if (this.state === "connecting") {
      // During auth, data packets may contain auth responses
      const { controlPackets } = decodeControlPackets(msg.slice(HEADER_LEN));
      for (const control of controlPackets) {
        if (control.type === "username") {
          // Device is requesting username
          this.sendUsername();
          break;
        } else if (control.type === "passsalt") {
          this.processChallenge(control);
          break;
        } else if (control.type === "passsalt_client") {
          this.processKeyRequest(control);
          break;
        } else if (control.type === "end_auth") {
          // Device confirms authentication complete
          this.setState("connected");
          this.startKeepAlive();
          this.connectResolve?.();
          break;
        }
      }
    } else if (this.state === "connected") {
      // Extract shell data from non-control bytes
      const { rawData } = decodeControlPackets(msg.slice(HEADER_LEN));

      if (rawData.length > 0) {
        const text = new TextDecoder("utf-8", {
          fatal: false,
        }).decode(rawData);
        this.emit("data", { data: rawData, text } as ShellDataEvent);

        // Check if this completes a pending command
        const pending = this.pendingCommands.get(packet.counter);
        if (pending) {
          pending.resolve({
            command: "",
            output: text,
            success: true,
            counter: packet.counter,
          });
        }
      }
    }
  }

  private handleEndPacket(): void {
    this.setState("disconnected");
  }

  private processChallenge(
    control: ReturnType<typeof decodeControlPackets>["controlPackets"][0]
  ): void {
    if (this.authType === "md5" && control && control.data.length >= 16) {
      this.deviceSalt = control.data.slice(0, 16);
      this.sendMD5Response();
    } else if (this.authType === "ec-srp" && control && control.data.length >= 65) {
      this.serverPublicKey = control.data.slice(0, 65);
      this.sendECSRPResponse();
    }
  }

  private processKeyRequest(
    _control: ReturnType<typeof decodeControlPackets>["controlPackets"][0]
  ): void {
    if (this.authType === "ec-srp" && this.serverPublicKey) {
      this.sendECSRPResponse();
    }
  }

  private sendUsername(): void {
    // Build username (null-terminated)
    const usernameBytes = new TextEncoder().encode(this.username + "\0");

    // Build username control packet
    const usernameControl: MacTelnetControlPacket = {
      type: "username",
      data: usernameBytes,
    };

    const packetRaw = buildControlDataPacket({
      srcMac: this.getLocalMac(),
      dstMac: parseMac(this.targetMac),
      sessionKey: this.sessionKey,
      counter: this.sendCounter,
      controlPackets: [usernameControl],
    });

    this.sendRaw(packetRaw).catch(() => {
      // Ignore send errors during auth
    });
  }

  private sendECSRPResponse(): void {
    if (!this.serverPublicKey || !this.clientECDH || !this.clientPublicKey) {
      throw new Error("Missing authentication data");
    }

    // Compute EC-SRP response hash
    const responseHash = computeECSRPHash({
      username: this.username,
      clientECDH: this.clientECDH,
      serverPublicKey: this.serverPublicKey,
    });

    // Build username (null-terminated)
    const usernameBytes = new TextEncoder().encode(this.username + "\0");

    // Combine: username || hash || client_pub_key
    const responseData = new Uint8Array(
      usernameBytes.length + responseHash.length + this.clientPublicKey.length
    );
    responseData.set(usernameBytes, 0);
    responseData.set(responseHash, usernameBytes.length);
    responseData.set(this.clientPublicKey, usernameBytes.length + responseHash.length);

    // Build PW_REQUEST control packet
    const pwRequestControl: MacTelnetControlPacket = {
      type: "password",
      data: responseData,
    };

    const packetRaw = buildControlDataPacket({
      srcMac: this.getLocalMac(),
      dstMac: parseMac(this.targetMac),
      sessionKey: this.sessionKey,
      counter: this.sendCounter,
      controlPackets: [pwRequestControl],
    });

    this.sendRaw(packetRaw).catch(() => {
      // Ignore send errors during auth
    });
  }

  private sendMD5Response(): void {
    if (!this.deviceSalt) {
      throw new Error("Missing device salt for MD5 auth");
    }

    // Compute MD5 response hash
    const responseHash = computeMD5Hash(this.password, this.deviceSalt);

    // Build username (null-terminated)
    const usernameBytes = new TextEncoder().encode(this.username + "\0");

    // Combine: username || md5_hash
    const responseData = new Uint8Array(usernameBytes.length + responseHash.length);
    responseData.set(usernameBytes, 0);
    responseData.set(responseHash, usernameBytes.length);

    // Build PW_REQUEST control packet
    const pwRequestControl: MacTelnetControlPacket = {
      type: "password",
      data: responseData,
    };

    const packetRaw = buildControlDataPacket({
      srcMac: this.getLocalMac(),
      dstMac: parseMac(this.targetMac),
      sessionKey: this.sessionKey,
      counter: this.sendCounter,
      controlPackets: [pwRequestControl],
    });

    this.sendRaw(packetRaw).catch(() => {
      // Ignore send errors during auth
    });
  }

  private cleanup(): void {
    // Stop keep-alive
    this.stopKeepAlive();

    // Reset source MAC for next connect()
    this.sourceMac = parseMac("00:00:00:00:00:00");

    // Clear connection timeout
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.connectResolve = null;
    this.connectReject = null;

    // Clear pending commands
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingCommands.clear();

    // Close socket
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.close();
      } catch {
        // Ignore close errors
      }
      this.socket = null;
    }

    // Clear session
    this.session = null;
    this.sendCounter = 0;
    this.clientECDH = null;
    this.clientPublicKey = null;
    this.serverPublicKey = null;
    this.deviceSalt = null;

    if (this.state !== "disconnected") {
      this.setState("disconnected");
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map client lifecycle state to session state.
 */
function sessionState(
  clientState: ClientState
): "disconnected" | "connecting" | "authenticating" | "connected" | "disconnecting" | "error" {
  switch (clientState) {
    case "disconnected":
      return "disconnected";
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnecting":
      return "disconnecting";
    case "error":
      return "error";
  }
}
