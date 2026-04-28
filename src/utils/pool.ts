import type { DeviceTransport } from "../routeros/transport";
import type { RouterOSStream } from "../routeros/index";
import { MikrotikError, type MikrotikErrorCode, type MikrotikErrorContext } from "../errors/index";

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown when `ConnectionPool.acquire` times out waiting for a free connection.
 */
export class PoolAcquireTimeoutError extends MikrotikError {
  public readonly code: MikrotikErrorCode = "connection_timeout";
  public readonly retriable = true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Configuration for `ConnectionPool`.
 *
 * @example
 * ```ts
 * const pool = new ConnectionPool(
 *   () => RouterOSClient.connect({ host: "192.168.1.1", ... }),
 *   { min: 1, max: 5 }
 * );
 * ```
 */
export type PoolConfig = {
  /** Minimum connections to keep alive. Default: 1. */
  min: number;
  /** Maximum simultaneous connections. Default: 5. */
  max: number;
  /**
   * Milliseconds of inactivity after which an idle connection is closed.
   * 0 = never close idle connections. Default: 60_000.
   */
  idleTimeoutMs: number;
  /**
   * Maximum time to wait for a free connection slot (ms).
   * Default: 10_000.
   */
  acquireTimeoutMs: number;
  /**
   * Interval for sending heartbeat commands to keep connections alive (ms).
   * 0 = no heartbeat. Default: 30_000.
   */
  heartbeatMs: number;
  /**
   * Number of consecutive heartbeat failures before a connection is
   * discarded from the pool. Default: 3.
   */
  heartbeatFailureThreshold: number;
};

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  min: 1,
  max: 5,
  idleTimeoutMs: 60_000,
  acquireTimeoutMs: 10_000,
  heartbeatMs: 30_000,
  heartbeatFailureThreshold: 3,
};

// ─── Pool entry ───────────────────────────────────────────────────────────────

type PoolEntry<T> = {
  transport: T;
  lastUsedMs: number;
  heartbeatFailures: number;
};

type Waiter<T> = {
  resolve: (t: T) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ─── ConnectionPool ───────────────────────────────────────────────────────────

/**
 * Generic connection pool for any `DeviceTransport`.
 *
 * Manages a bounded set of connections created by a factory function.
 * Implements `DeviceTransport` itself — callers acquire, use, and release
 * a connection transparently on every call.
 *
 * Features:
 * - Min/max connection bounds
 * - Idle timeout (connections unused beyond `idleTimeoutMs` are closed)
 * - Acquire timeout (throws `PoolAcquireTimeoutError` if pool is saturated)
 * - Application-level heartbeat via `/system/identity/print`
 *
 * @example
 * ```ts
 * const pool = new ConnectionPool(
 *   () => RouterOSClient.connect({ host: "192.168.1.1", username: "admin", password: "" }),
 *   DEFAULT_POOL_CONFIG
 * );
 *
 * // Use as a DeviceTransport:
 * const helpers = createRouterOSHelpers(pool);
 * const interfaces = await helpers.interface.list();
 *
 * // Cleanup:
 * await pool.close();
 * ```
 */
export class ConnectionPool<T extends DeviceTransport> implements DeviceTransport {
  private readonly idle: PoolEntry<T>[] = [];
  private size = 0;
  private readonly waiters: Waiter<T>[] = [];
  private closed = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private idleTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly factory: () => Promise<T>,
    private readonly config: PoolConfig = DEFAULT_POOL_CONFIG,
    private readonly disposeTransport?: (t: T) => Promise<void>
  ) {
    if (config.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), config.heartbeatMs);
    }
    if (config.idleTimeoutMs > 0) {
      const checkInterval = Math.min(config.idleTimeoutMs, 10_000);
      this.idleTimer = setInterval(() => void this.pruneIdle(), checkInterval);
    }
    // Pre-warm minimum connections
    if (config.min > 0) {
      void this.prewarm();
    }
  }

  // ─── Acquire / release ───────────────────────────────────────────────────

  /**
   * Acquire a connection from the pool.
   * Returns immediately if an idle connection is available; creates a new one
   * if below `max`; otherwise waits up to `acquireTimeoutMs`.
   */
  async acquire(signal?: AbortSignal, context?: MikrotikErrorContext): Promise<T> {
    if (this.closed)
      throw new PoolAcquireTimeoutError("Pool is closed", {
        ...(context !== undefined && { context }),
      });

    // Prefer idle
    while (this.idle.length > 0) {
      const entry = this.idle.pop()!;
      return entry.transport;
    }

    // Create new connection if below max
    if (this.size < this.config.max) {
      this.size++;
      try {
        const transport = await this.factory();
        return transport;
      } catch (err) {
        this.size--;
        throw err;
      }
    }

    // Wait for a release
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }

      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(
          new PoolAcquireTimeoutError(
            `Connection pool exhausted — no free connection within ${this.config.acquireTimeoutMs} ms`,
            { ...(context !== undefined && { context }) }
          )
        );
      }, this.config.acquireTimeoutMs);

      const waiter: Waiter<T> = { resolve, reject, timer };
      this.waiters.push(waiter);

      signal?.addEventListener(
        "abort",
        () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true }
      );
    });
  }

  /**
   * Return a connection to the pool.
   * Directly hands off to a waiting acquire caller if one exists.
   */
  release(transport: T): void {
    if (this.closed) {
      void this.disposeOne(transport);
      return;
    }

    // Hand directly to a waiter
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      clearTimeout(waiter.timer);
      waiter.resolve(transport);
      return;
    }

    // Return to idle pool
    this.idle.push({ transport, lastUsedMs: Date.now(), heartbeatFailures: 0 });
  }

  /**
   * Run `fn` with an acquired connection, then release it automatically.
   * Releases on both success and error.
   */
  async withConnection<R>(fn: (transport: T) => Promise<R>, signal?: AbortSignal): Promise<R> {
    const t = await this.acquire(signal);
    try {
      const result = await fn(t);
      this.release(t);
      return result;
    } catch (err) {
      this.release(t);
      throw err;
    }
  }

  // ─── DeviceTransport ─────────────────────────────────────────────────────

  execute(
    command: Parameters<DeviceTransport["execute"]>[0],
    options?: Parameters<DeviceTransport["execute"]>[1]
  ): ReturnType<DeviceTransport["execute"]> {
    return this.withConnection((t) => t.execute(command, options), options?.signal);
  }

  print(
    command: Parameters<DeviceTransport["print"]>[0],
    options?: Parameters<DeviceTransport["print"]>[1]
  ): ReturnType<DeviceTransport["print"]> {
    return this.withConnection((t) => t.print(command, options), options?.signal);
  }

  /**
   * Acquire a dedicated connection for the stream's lifetime.
   * The connection is returned to the pool when the stream emits `"close"`.
   */
  async listen(
    command: Parameters<DeviceTransport["listen"]>[0],
    options?: Parameters<DeviceTransport["listen"]>[1]
  ): Promise<RouterOSStream> {
    const t = await this.acquire(options?.signal);
    let stream: RouterOSStream;
    try {
      stream = await t.listen(command, options);
    } catch (err) {
      this.release(t);
      throw err;
    }
    // Release connection when stream closes
    stream.once("close", () => this.release(t));
    return stream;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Close all connections and stop background timers.
   * After calling `close()`, any new calls to `acquire`, `execute`, `print`,
   * or `listen` will throw immediately.
   */
  async close(): Promise<void> {
    this.closed = true;

    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    if (this.idleTimer !== undefined) clearInterval(this.idleTimer);

    // Reject all waiters
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new PoolAcquireTimeoutError("Pool closed"));
    }

    // Dispose idle connections
    const idleTransports = this.idle.splice(0).map((e) => e.transport);
    await Promise.allSettled(idleTransports.map((t) => this.disposeOne(t)));
  }

  /** Current number of connections (idle + busy). */
  get connectionCount(): number {
    return this.size;
  }

  /** Current number of idle (available) connections. */
  get idleCount(): number {
    return this.idle.length;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async prewarm(): Promise<void> {
    const toCreate = Math.min(this.config.min, this.config.max);
    for (let i = 0; i < toCreate; i++) {
      try {
        this.size++;
        const transport = await this.factory();
        this.idle.push({ transport, lastUsedMs: Date.now(), heartbeatFailures: 0 });
      } catch {
        this.size--;
      }
    }
  }

  private async pruneIdle(): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    const threshold = this.config.idleTimeoutMs;
    const toKeep: PoolEntry<T>[] = [];
    const toPrune: T[] = [];

    for (const entry of this.idle) {
      const wouldGoBelowMin = this.size - toPrune.length - 1 < this.config.min;
      const shouldPrune = !wouldGoBelowMin && now - entry.lastUsedMs >= threshold;
      if (shouldPrune) {
        toPrune.push(entry.transport);
      } else {
        toKeep.push(entry);
      }
    }

    this.idle.length = 0;
    for (const e of toKeep) this.idle.push(e);

    this.size -= toPrune.length;
    await Promise.allSettled(toPrune.map((t) => this.disposeOne(t)));
  }

  private async runHeartbeat(): Promise<void> {
    if (this.closed) return;
    const threshold = this.config.heartbeatFailureThreshold;
    const toDrop: T[] = [];
    const surviving: PoolEntry<T>[] = [];

    for (const entry of this.idle) {
      try {
        await entry.transport.print("/system/identity");
        entry.heartbeatFailures = 0;
        entry.lastUsedMs = Date.now();
        surviving.push(entry);
      } catch {
        entry.heartbeatFailures++;
        if (entry.heartbeatFailures >= threshold) {
          toDrop.push(entry.transport);
        } else {
          surviving.push(entry);
        }
      }
    }

    this.idle.length = 0;
    for (const e of surviving) this.idle.push(e);

    this.size -= toDrop.length;
    await Promise.allSettled(toDrop.map((t) => this.disposeOne(t)));
  }

  private async disposeOne(t: T): Promise<void> {
    if (this.disposeTransport !== undefined) {
      await this.disposeTransport(t);
    }
  }
}
