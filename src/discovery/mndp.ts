import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import { EventEmitter } from "node:events";
import { createDeferred, withTimeout } from "../shared";

export const MNDP_PORT = 5678;

export const MNDP_TLV_ADDRESS = 0x0001;
export const MNDP_TLV_IDENTITY = 0x0005;
export const MNDP_TLV_VERSION = 0x0007;
export const MNDP_TLV_PLATFORM = 0x0008;
export const MNDP_TLV_TIMESTAMP = 0x000a;
export const MNDP_TLV_SOFT_ID = 0x000b;
export const MNDP_TLV_HARDWARE = 0x000c;
export const MNDP_TLV_INTERFACE_NAME = 0x0010;

export type MNDPTlvValue = string | number | Uint8Array;

export type MNDPKnownTlvType =
  | typeof MNDP_TLV_ADDRESS
  | typeof MNDP_TLV_IDENTITY
  | typeof MNDP_TLV_VERSION
  | typeof MNDP_TLV_PLATFORM
  | typeof MNDP_TLV_TIMESTAMP
  | typeof MNDP_TLV_SOFT_ID
  | typeof MNDP_TLV_HARDWARE
  | typeof MNDP_TLV_INTERFACE_NAME;

export type MNDPTlv = {
  type: number;
  length: number;
  raw: Uint8Array;
  value: MNDPTlvValue;
};

export type MNDPPacket = {
  version: number;
  ttl: number;
  checksum: number;
  tlvs: MNDPTlv[];
  raw: Uint8Array;
};

export type MNDPAdvertisement = {
  version: number;
  ttl: number;
  checksum: number;
  macAddress?: string;
  identity?: string;
  versionString?: string;
  platform?: string;
  uptimeSeconds?: number;
  softId?: string;
  hardware?: string;
  interfaceName?: string;
  remoteAddress: string;
  remotePort: number;
  remoteFamily: string;
  receivedAt: Date;
  packet: MNDPPacket;
  rawTlvs: ReadonlyMap<number, readonly MNDPTlv[]>;
};

export type MNDPParseError = {
  error: unknown;
  remoteAddress: string;
  remotePort: number;
  remoteFamily: string;
  payload: Uint8Array;
};

export type MNDPEventMap<T> = {
  advertisement: [advertisement: T];
  parseError: [error: MNDPParseError];
  close: [error?: unknown];
};

export type ListenMNDPOptions = {
  port?: number;
  host?: string;
  protocol?: "udp4" | "udp6";
  request?: boolean;
  requestIntervalMs?: number;
  broadcastAddress?: string;
  socketFactory?: (options: Required<Pick<ListenMNDPOptions, "protocol">>) => Socket;
};

export type DiscoverMNDPOptions = ListenMNDPOptions & {
  timeoutMs?: number;
  dedupe?: boolean;
};

function decodeUtf8(value: Uint8Array): string {
  return Buffer.from(value).toString("utf8");
}

function decodeMacAddress(value: Uint8Array): string | undefined {
  if (value.length < 6) {
    return undefined;
  }
  return [...value.subarray(0, 6)].map((part) => part.toString(16).padStart(2, "0")).join(":");
}

function decodeLittleEndianUint32(value: Uint8Array): number | undefined {
  if (value.length < 4) {
    return undefined;
  }
  return value[0]! | (value[1]! << 8) | (value[2]! << 16) | (value[3]! << 24);
}

function decodeTlvValue(type: number, raw: Uint8Array): MNDPTlvValue {
  switch (type) {
    case MNDP_TLV_ADDRESS:
      return decodeMacAddress(raw) ?? raw;
    case MNDP_TLV_IDENTITY:
    case MNDP_TLV_VERSION:
    case MNDP_TLV_PLATFORM:
    case MNDP_TLV_SOFT_ID:
    case MNDP_TLV_HARDWARE:
    case MNDP_TLV_INTERFACE_NAME:
      return decodeUtf8(raw);
    case MNDP_TLV_TIMESTAMP:
      return decodeLittleEndianUint32(raw) ?? raw;
    default:
      return raw;
  }
}

function appendMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

export function parseMNDPPacket(payload: Uint8Array): MNDPPacket {
  if (payload.length < 18) {
    throw new Error("Invalid MNDP packet: expected at least 18 bytes.");
  }

  const view = Buffer.from(payload);
  const version = view.readUInt8(0);
  const ttl = view.readUInt8(1);
  const checksum = view.readUInt16BE(2);
  const tlvs: MNDPTlv[] = [];
  let offset = 4;

  while (offset + 4 <= payload.length) {
    const type = view.readUInt16BE(offset);
    const length = view.readUInt16BE(offset + 2);
    offset += 4;

    if (offset + length > payload.length) {
      throw new Error(`Invalid MNDP packet: TLV length ${length} exceeds packet size.`);
    }

    const raw = payload.slice(offset, offset + length);
    tlvs.push({
      type,
      length,
      raw,
      value: decodeTlvValue(type, raw),
    });
    offset += length;
  }

  return {
    version,
    ttl,
    checksum,
    tlvs,
    raw: payload.slice(),
  };
}

export function toMNDPAdvertisement(
  packet: MNDPPacket,
  remote: Pick<RemoteInfo, "address" | "port" | "family">
): MNDPAdvertisement {
  const tlvs = new Map<number, MNDPTlv[]>();

  for (const tlv of packet.tlvs) {
    appendMapValue(tlvs, tlv.type, tlv);
  }

  const first = (type: number): MNDPTlvValue | undefined => tlvs.get(type)?.[0]?.value;

  const macAddress =
    typeof first(MNDP_TLV_ADDRESS) === "string" ? (first(MNDP_TLV_ADDRESS) as string) : undefined;
  const identity =
    typeof first(MNDP_TLV_IDENTITY) === "string" ? (first(MNDP_TLV_IDENTITY) as string) : undefined;
  const versionString =
    typeof first(MNDP_TLV_VERSION) === "string" ? (first(MNDP_TLV_VERSION) as string) : undefined;
  const platform =
    typeof first(MNDP_TLV_PLATFORM) === "string" ? (first(MNDP_TLV_PLATFORM) as string) : undefined;
  const uptimeSeconds =
    typeof first(MNDP_TLV_TIMESTAMP) === "number"
      ? (first(MNDP_TLV_TIMESTAMP) as number)
      : undefined;
  const softId =
    typeof first(MNDP_TLV_SOFT_ID) === "string" ? (first(MNDP_TLV_SOFT_ID) as string) : undefined;
  const hardware =
    typeof first(MNDP_TLV_HARDWARE) === "string" ? (first(MNDP_TLV_HARDWARE) as string) : undefined;
  const interfaceName =
    typeof first(MNDP_TLV_INTERFACE_NAME) === "string"
      ? (first(MNDP_TLV_INTERFACE_NAME) as string)
      : undefined;

  return {
    version: packet.version,
    ttl: packet.ttl,
    checksum: packet.checksum,
    ...(macAddress !== undefined && { macAddress }),
    ...(identity !== undefined && { identity }),
    ...(versionString !== undefined && { versionString }),
    ...(platform !== undefined && { platform }),
    ...(uptimeSeconds !== undefined && { uptimeSeconds }),
    ...(softId !== undefined && { softId }),
    ...(hardware !== undefined && { hardware }),
    ...(interfaceName !== undefined && { interfaceName }),
    remoteAddress: remote.address,
    remotePort: remote.port,
    remoteFamily: remote.family,
    receivedAt: new Date(),
    packet,
    rawTlvs: tlvs,
  };
}

function fingerprintAdvertisement(advertisement: MNDPAdvertisement): string {
  return [
    advertisement.macAddress ?? "",
    advertisement.identity ?? "",
    advertisement.remoteAddress,
    advertisement.interfaceName ?? "",
  ].join("|");
}

export class MNDPListener
  extends EventEmitter<MNDPEventMap<MNDPAdvertisement>>
  implements AsyncIterable<MNDPAdvertisement>
{
  private readonly queue: MNDPAdvertisement[] = [];
  private readonly waiters: Array<
    ReturnType<typeof createDeferred<IteratorResult<MNDPAdvertisement>>>
  > = [];
  private closed = false;
  private closeError?: unknown;
  private requestTimer: NodeJS.Timeout | undefined;

  public constructor(public readonly socket: Socket) {
    super();
  }

  public setRequestTimer(timer: NodeJS.Timeout | undefined): void {
    if (this.requestTimer) {
      clearInterval(this.requestTimer);
    }
    this.requestTimer = timer;
  }

  public push(advertisement: MNDPAdvertisement): void {
    if (this.closed) {
      return;
    }

    this.emit("advertisement", advertisement);

    if (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value: advertisement, done: false });
      return;
    }

    this.queue.push(advertisement);
  }

  public async nextAdvertisement(timeoutMs?: number): Promise<MNDPAdvertisement | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }

    if (this.closed) {
      if (this.closeError) {
        throw this.closeError;
      }
      return undefined;
    }

    const deferred = createDeferred<IteratorResult<MNDPAdvertisement>>();
    this.waiters.push(deferred);
    const result = await withTimeout(
      deferred.promise,
      timeoutMs,
      `Timed out waiting for MNDP advertisement`
    );
    return result.done ? undefined : result.value;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.socket.close(() => resolve());
    });
    this.finish();
  }

  public finish(error?: unknown): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.closeError = error;
    if (this.requestTimer) {
      clearInterval(this.requestTimer);
      this.requestTimer = undefined;
    }

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }

    this.emit("close", error);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<MNDPAdvertisement> {
    while (true) {
      const advertisement = await this.nextAdvertisement();
      if (!advertisement) {
        return;
      }
      yield advertisement;
    }
  }
}

export async function listenMNDP(options: ListenMNDPOptions = {}): Promise<MNDPListener> {
  const {
    port = MNDP_PORT,
    host,
    protocol = "udp4",
    request = true,
    requestIntervalMs,
    broadcastAddress = "255.255.255.255",
    socketFactory,
  } = options;
  const socket =
    socketFactory?.({ protocol }) ??
    dgram.createSocket({
      type: protocol,
      reuseAddr: true,
    });

  const listener = new MNDPListener(socket);

  socket.on("message", (message, remote) => {
    try {
      const packet = parseMNDPPacket(new Uint8Array(message));
      listener.push(toMNDPAdvertisement(packet, remote));
    } catch (error) {
      listener.emit("parseError", {
        error,
        remoteAddress: remote.address,
        remotePort: remote.port,
        remoteFamily: remote.family,
        payload: new Uint8Array(message),
      } satisfies MNDPParseError);
    }
  });

  socket.on("close", () => {
    listener.finish();
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("listening", resolve);
    socket.once("error", reject);
    socket.bind(port, host);
  });

  socket.removeAllListeners("error");
  socket.on("error", (error) => {
    listener.finish(error);
  });

  const sendRequest = async (): Promise<void> => {
    socket.setBroadcast(true);
    await new Promise<void>((resolve, reject) => {
      socket.send(Buffer.alloc(4), port, broadcastAddress, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };

  if (request && protocol === "udp4") {
    await sendRequest();

    if (requestIntervalMs && requestIntervalMs > 0) {
      listener.setRequestTimer(
        setInterval(() => {
          void sendRequest().catch((error) => listener.finish(error));
        }, requestIntervalMs)
      );
    }
  }

  return listener;
}

export async function discoverMNDP(
  options: DiscoverMNDPOptions = {}
): Promise<MNDPAdvertisement[]> {
  const { timeoutMs = 3_000, dedupe = true, ...listenOptions } = options;
  const listener = await listenMNDP(listenOptions);
  const seen = new Map<string, MNDPAdvertisement>();

  const onAdvertisement = (advertisement: MNDPAdvertisement) => {
    if (!dedupe) {
      seen.set(`${seen.size}:${Date.now()}`, advertisement);
      return;
    }
    seen.set(fingerprintAdvertisement(advertisement), advertisement);
  };

  listener.on("advertisement", onAdvertisement);

  try {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  } finally {
    listener.off("advertisement", onAdvertisement);
    await listener.close();
  }

  return [...seen.values()];
}
