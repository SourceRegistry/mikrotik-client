/**
 * @module netinstall/session
 *
 * Orchestrates a complete MikroTik netinstall session: BOOTP device discovery
 * followed by TFTP image delivery, with progress events and post-install hook.
 *
 * Single-device, single-session model. Concurrency is the caller's responsibility.
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

import { EventEmitter } from "node:events";
import { BootpServer } from "./bootp";
import type { BootpPacket, BootpOfferEvent } from "./bootp";
import { TftpServer } from "./tftp";
import type { TftpProgressEvent } from "./tftp";
import { BOOTP_SERVER_PORT } from "./bootp";
import { TFTP_PORT } from "./tftp";

// ── Progress event ─────────────────────────────────────────────────────────────

/**
 * Progress event emitted by {@link NetinstallSession}.
 *
 * Discriminated by `kind`:
 * - `"discovering"` — session started, waiting for DHCP DISCOVER.
 * - `"offering"` — DHCPOFFER sent to device.
 * - `"tftp_start"` — device requested the boot image via TFTP RRQ.
 * - `"tftp_progress"` — block acknowledged; transfer in progress.
 * - `"tftp_complete"` — all blocks transferred and acknowledged.
 * - `"installed"` — post-install hook about to be called.
 */
export type NetinstallProgressEvent =
  | { kind: "discovering" }
  | { kind: "offering"; deviceMac: string }
  | { kind: "tftp_start"; filename: string; clientAddress: string }
  | { kind: "tftp_progress"; blockNumber: number; bytesTransferred: number; totalBytes: number }
  | { kind: "tftp_complete"; totalBytes: number }
  | { kind: "installed" };

// ── Session options ────────────────────────────────────────────────────────────

/**
 * Options for {@link NetinstallSession}.
 *
 * @example
 * ```ts
 * const session = new NetinstallSession({
 *   imageBuffer: fs.readFileSync("netinstall.img"),
 *   serverIp: "192.168.88.1",
 *   bootfile: "netinstall.img",
 *   deviceMac: "aa:bb:cc:dd:ee:ff",
 * });
 * ```
 */
export interface NetinstallSessionOptions {
  /** Boot image bytes to serve via TFTP. */
  imageBuffer: Buffer;
  /** IP address of this machine (placed in DHCPOFFER and used as TFTP server address). */
  serverIp: string;
  /** Boot filename advertised in DHCPOFFER and enforced on TFTP RRQ. Default: `"netinstall.img"`. */
  bootfile?: string;
  /** If set, only respond to a device with this MAC address. */
  deviceMac?: string;
  /**
   * Overall session timeout in ms. If the installation does not complete
   * within this window the session rejects with a timeout error. Default: 120000.
   */
  timeoutMs?: number;
  /**
   * Async callback invoked after the TFTP transfer completes.
   * Awaited before {@link NetinstallSession.start} resolves.
   */
  onInstalled?: () => Promise<void> | void;
  /** BOOTP server port. Default: 67. Override for testing. */
  bootpPort?: number;
  /** TFTP server port. Default: 69. Override for testing. */
  tftpPort?: number;
  /** TFTP block retransmit timeout in ms. Default: 1000. */
  tftpRetransmitMs?: number;
}

// ── Session state ──────────────────────────────────────────────────────────────

/** Lifecycle state of a {@link NetinstallSession}. */
export type NetinstallSessionState =
  | "idle"
  | "discovering"
  | "running"
  | "complete"
  | "aborted"
  | "error";

// ── NetinstallSession ──────────────────────────────────────────────────────────

/**
 * Orchestrates a complete MikroTik netinstall flow.
 *
 * ### Flow
 * 1. Starts a BOOTP/DHCP server (port 67) that responds to DISCOVER with OFFER.
 * 2. Starts a TFTP server (port 69) that serves `imageBuffer` on request.
 * 3. Emits `progress` events throughout.
 * 4. Resolves when the final TFTP block is acknowledged and `onInstalled` completes.
 *
 * ### Single-session constraint
 * Each instance handles one device installation. Create a new instance per device.
 * Calling `start()` on an already-started session throws.
 *
 * @example
 * ```ts
 * const session = new NetinstallSession({
 *   imageBuffer: readFileSync("netinstall-7.14.img"),
 *   serverIp: "192.168.88.1",
 *   deviceMac: "aa:bb:cc:dd:ee:ff",
 * });
 *
 * session.on("progress", (evt) => {
 *   if (evt.kind === "tftp_progress") {
 *     const pct = Math.round(evt.bytesTransferred / evt.totalBytes * 100);
 *     console.log(`Transfer: ${pct}%`);
 *   }
 * });
 *
 * await session.start({ signal: controller.signal });
 * ```
 */
export class NetinstallSession extends EventEmitter {
  private state: NetinstallSessionState = "idle";
  private bootp: BootpServer | null = null;
  private tftp: TftpServer | null = null;

  private readonly imageBuffer: Buffer;
  private readonly serverIp: string;
  private readonly bootfile: string;
  private readonly deviceMac: string | undefined;
  private readonly timeoutMs: number;
  private readonly onInstalled: (() => Promise<void> | void) | undefined;
  private readonly bootpPort: number;
  private readonly tftpPort: number;
  private readonly tftpRetransmitMs: number;

  constructor(opts: NetinstallSessionOptions) {
    super();
    this.imageBuffer = opts.imageBuffer;
    this.serverIp = opts.serverIp;
    this.bootfile = opts.bootfile ?? "netinstall.img";
    this.deviceMac = opts.deviceMac;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.onInstalled = opts.onInstalled;
    this.bootpPort = opts.bootpPort ?? BOOTP_SERVER_PORT;
    this.tftpPort = opts.tftpPort ?? TFTP_PORT;
    this.tftpRetransmitMs = opts.tftpRetransmitMs ?? 1000;
  }

  /** Current session lifecycle state. */
  get sessionState(): NetinstallSessionState {
    return this.state;
  }

  /**
   * Start the netinstall session.
   *
   * Binds BOOTP (port 67) and TFTP (port 69) servers, waits for the device
   * to discover, request, and fully receive the image, then resolves.
   *
   * @param opts - Optional abort signal for cancellation.
   * @throws If the session is not in `"idle"` state or if an abort/timeout occurs.
   *
   * @example
   * ```ts
   * const controller = new AbortController();
   * await session.start({ signal: controller.signal });
   * ```
   */
  async start(opts?: { signal?: AbortSignal }): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(
        `NetinstallSession.start() called in state "${this.state}" — create a new instance per installation`
      );
    }

    const signal = opts?.signal;

    if (signal?.aborted === true) {
      throw new Error("AbortSignal already aborted before start");
    }

    this.state = "discovering";

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      const fail = (err: Error): void => {
        settle(() => {
          this.state = "error";
          this.cleanup();
          reject(err);
        });
      };

      // Overall timeout
      const timeoutHandle = setTimeout(() => {
        fail(new Error(`NetinstallSession timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      // AbortSignal
      const onAbort = (): void => {
        settle(() => {
          this.state = "aborted";
          this.cleanup();
          clearTimeout(timeoutHandle);
          reject(new Error("NetinstallSession aborted"));
        });
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      // ── BOOTP server ─────────────────────────────────────────────────
      const bootp = new BootpServer({
        serverIp: this.serverIp,
        bootfile: this.bootfile,
        ...(this.deviceMac !== undefined && { deviceMac: this.deviceMac }),
      });
      this.bootp = bootp;

      bootp.on("error", (err: Error) => fail(err));

      bootp.on("discover", (packet: BootpPacket) => {
        this.emit("progress", {
          kind: "offering",
          deviceMac: packet.clientMac,
        } satisfies NetinstallProgressEvent);
      });

      bootp.on("offer", (_evt: BootpOfferEvent) => {
        // Offer sent; TFTP server is already listening
      });

      // ── TFTP server ──────────────────────────────────────────────────
      const tftp = new TftpServer({
        imageBuffer: this.imageBuffer,
        allowedFilename: this.bootfile,
        retransmitMs: this.tftpRetransmitMs,
      });
      this.tftp = tftp;

      tftp.on("error", (err: Error) => fail(err));

      tftp.on(
        "request",
        ({ filename, clientAddress }: { filename: string; clientAddress: string }) => {
          this.state = "running";
          this.emit("progress", {
            kind: "tftp_start",
            filename,
            clientAddress,
          } satisfies NetinstallProgressEvent);
        }
      );

      tftp.on("progress", (evt: TftpProgressEvent) => {
        this.emit("progress", {
          kind: "tftp_progress",
          blockNumber: evt.blockNumber,
          bytesTransferred: evt.bytesTransferred,
          totalBytes: evt.totalBytes,
        } satisfies NetinstallProgressEvent);
      });

      tftp.on("complete", () => {
        const totalBytes = this.imageBuffer.length;
        this.emit("progress", {
          kind: "tftp_complete",
          totalBytes,
        } satisfies NetinstallProgressEvent);
        this.emit("progress", { kind: "installed" } satisfies NetinstallProgressEvent);
        this.emit("installed");

        clearTimeout(timeoutHandle);
        signal?.removeEventListener("abort", onAbort);
        this.cleanup();
        this.state = "complete";

        settle(() => {
          Promise.resolve()
            .then(() => this.onInstalled?.())
            .then(() => resolve())
            .catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
        });
      });

      // ── Start both servers ───────────────────────────────────────────
      this.emit("progress", { kind: "discovering" } satisfies NetinstallProgressEvent);

      Promise.all([bootp.listen(this.bootpPort), tftp.listen(this.tftpPort)]).catch(
        (err: unknown) => {
          clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
  }

  /**
   * Abort an in-progress session.
   *
   * Stops both servers and transitions to `"aborted"` state.
   * Resolves immediately; the `start()` promise will reject with an abort error.
   *
   * @example
   * ```ts
   * await session.abort();
   * ```
   */
  async abort(): Promise<void> {
    if (this.state === "idle" || this.state === "complete") return;
    this.state = "aborted";
    this.cleanup();
  }

  private cleanup(): void {
    this.bootp?.close();
    this.bootp = null;
    this.tftp?.close();
    this.tftp = null;
  }
}
