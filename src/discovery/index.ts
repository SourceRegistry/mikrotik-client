import { EventEmitter } from "node:events";
import {
  discoverMNDP,
  listenMNDP,
  type DiscoverMNDPOptions,
  type ListenMNDPOptions,
  type MNDPAdvertisement,
  type MNDPListener,
} from "./mndp";

export * from "./mndp";

export type NeighborDiscoverySource = "mndp";

export type DiscoveredNeighbor = {
  source: NeighborDiscoverySource;
  id: string;
  identity?: string;
  macAddress?: string;
  platform?: string;
  version?: string;
  hardware?: string;
  interfaceName?: string;
  address?: string;
  raw: MNDPAdvertisement;
};

export type DiscoverNeighborsOptions = DiscoverMNDPOptions;

export type ListenNeighborsOptions = ListenMNDPOptions & {
  dedupe?: boolean;
};

export type NeighborDiscoveryEventMap<T> = {
  neighbor: [neighbor: T, previous: T | undefined];
  close: [error?: unknown];
};

export type NeighborDiscoveryEventName = keyof NeighborDiscoveryEventMap<DiscoveredNeighbor>;

export type NeighborDiscoveryEventListener<K extends NeighborDiscoveryEventName> = (
  ...args: NeighborDiscoveryEventMap<DiscoveredNeighbor>[K]
) => void;

function fromMNDP(advertisement: MNDPAdvertisement): DiscoveredNeighbor {
  return {
    source: "mndp",
    id: [
      "mndp",
      advertisement.macAddress ?? "",
      advertisement.identity ?? "",
      advertisement.remoteAddress,
    ].join("|"),
    identity: advertisement.identity,
    macAddress: advertisement.macAddress,
    platform: advertisement.platform,
    version: advertisement.versionString,
    hardware: advertisement.hardware,
    interfaceName: advertisement.interfaceName,
    address: advertisement.remoteAddress,
    raw: advertisement,
  };
}

function dedupeKey(neighbor: DiscoveredNeighbor): string {
  return neighbor.macAddress ?? neighbor.identity ?? neighbor.id;
}

function dedupeNeighbors(neighbors: readonly DiscoveredNeighbor[]): DiscoveredNeighbor[] {
  const map = new Map<string, DiscoveredNeighbor>();

  for (const neighbor of neighbors) {
    map.set(dedupeKey(neighbor), neighbor);
  }

  return [...map.values()];
}

export class NeighborDiscoveryService
  extends EventEmitter<NeighborDiscoveryEventMap<DiscoveredNeighbor>>
  implements AsyncIterable<DiscoveredNeighbor>
{
  private readonly queue: DiscoveredNeighbor[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<DiscoveredNeighbor>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private readonly neighbors = new Map<string, DiscoveredNeighbor>();
  private readonly dedupe: boolean;
  private closed = false;
  private closeError?: unknown;
  private _listener?: MNDPListener;
  private readonly onAdvertisement = (advertisement: MNDPAdvertisement) => {
    this.ingest(fromMNDP(advertisement));
  };
  private readonly onClose = (error?: unknown) => {
    this._listener = undefined;
    this.finish(error);
  };

  public constructor(
    private readonly options: ListenNeighborsOptions = {}
  ) {
    super();
    this.dedupe = options.dedupe ?? true;
  }

  public on<K extends NeighborDiscoveryEventName>(
    eventName: K,
    listener: NeighborDiscoveryEventListener<K>
  ): this;
  public on(eventName: string | symbol, listener: (...args: any[]) => void): this;
  public on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
  }

  public once<K extends NeighborDiscoveryEventName>(
    eventName: K,
    listener: NeighborDiscoveryEventListener<K>
  ): this;
  public once(eventName: string | symbol, listener: (...args: any[]) => void): this;
  public once(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(eventName, listener);
  }

  public off<K extends NeighborDiscoveryEventName>(
    eventName: K,
    listener: NeighborDiscoveryEventListener<K>
  ): this;
  public off(eventName: string | symbol, listener: (...args: any[]) => void): this;
  public off(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(eventName, listener);
  }

  public addListener<K extends NeighborDiscoveryEventName>(
    eventName: K,
    listener: NeighborDiscoveryEventListener<K>
  ): this;
  public addListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
  public addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.addListener(eventName, listener);
  }

  public removeListener<K extends NeighborDiscoveryEventName>(
    eventName: K,
    listener: NeighborDiscoveryEventListener<K>
  ): this;
  public removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this;
  public removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.removeListener(eventName, listener);
  }

  public get listener(): MNDPListener | undefined {
    return this._listener;
  }

  public list(): DiscoveredNeighbor[] {
    return [...this.neighbors.values()];
  }

  private ingest(neighbor: DiscoveredNeighbor): void {
    if (this.closed) {
      return;
    }

    const key = dedupeKey(neighbor);
    const previous = this.neighbors.get(key);
    if (this.dedupe || !previous) {
      this.neighbors.set(key, neighbor);
    }

    this.emit("neighbor", neighbor, previous);

    if (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value: neighbor, done: false });
      return;
    }

    this.queue.push(neighbor);
  }

  public async nextNeighbor(timeoutMs?: number): Promise<DiscoveredNeighbor | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }

    if (this.closed) {
      if (this.closeError) {
        throw this.closeError;
      }
      return undefined;
    }

    return await new Promise<DiscoveredNeighbor | undefined>((resolve, reject) => {
      this.waiters.push({
        resolve: (result) => resolve(result.done ? undefined : result.value),
        reject,
      });

      if (timeoutMs && timeoutMs > 0) {
        setTimeout(() => {
          const index = this.waiters.findIndex((waiter) => waiter.reject === reject);
          if (index >= 0) {
            this.waiters.splice(index, 1);
            resolve(undefined);
          }
        }, timeoutMs);
      }
    });
  }

  public async start(): Promise<this> {
    if (this.closed) {
      throw new Error("NeighborDiscoveryService is closed.");
    }

    if (this._listener) {
      return this;
    }

    const { dedupe: _dedupe, ...mndpOptions } = this.options;
    const listener = await listenMNDP(mndpOptions);
    listener.on("advertisement", this.onAdvertisement);
    listener.on("close", this.onClose);
    this._listener = listener;
    return this;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this._listener) {
      const listener = this._listener;
      this._listener = undefined;
      listener.off("advertisement", this.onAdvertisement);
      listener.off("close", this.onClose);
      await listener.close();
    }

    this.finish();
  }

  public finish(error?: unknown): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.closeError = error;

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

  public async *[Symbol.asyncIterator](): AsyncIterator<DiscoveredNeighbor> {
    while (true) {
      const neighbor = await this.nextNeighbor();
      if (!neighbor) {
        return;
      }
      yield neighbor;
    }
  }
}

export async function discoverNeighbors(
  options: DiscoverNeighborsOptions = {}
): Promise<DiscoveredNeighbor[]> {
  const { dedupe = true, ...mndpOptions } = options;
  const neighbors = (await discoverMNDP(mndpOptions)).map(fromMNDP);
  return dedupe ? dedupeNeighbors(neighbors) : neighbors;
}

export async function listenNeighbors(
  options: ListenNeighborsOptions = {}
): Promise<NeighborDiscoveryService> {
  return new NeighborDiscoveryService(options).start();
}
