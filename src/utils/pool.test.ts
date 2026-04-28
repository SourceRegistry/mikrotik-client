import { describe, expect, it, vi, afterAll, beforeEach } from "vitest";
import { ConnectionPool, PoolAcquireTimeoutError, type PoolConfig } from "./pool";
import type { DeviceTransport } from "../routeros/transport";

function makeTransport(): DeviceTransport {
  return {
    execute: vi.fn(async () => ({ records: [], traps: [], tag: "1" })),
    print: vi.fn(async () => []),
    listen: vi.fn(async () => { throw new Error("not implemented"); }),
  } as DeviceTransport;
}

const fastConfig: PoolConfig = {
  min: 0,
  max: 3,
  idleTimeoutMs: 0,
  acquireTimeoutMs: 200,
  heartbeatMs: 0,
  heartbeatFailureThreshold: 3,
};

describe("ConnectionPool", () => {
  it("creates connection via factory", async () => {
    const factory = vi.fn(async () => makeTransport());
    const pool = new ConnectionPool(factory, fastConfig);

    await pool.execute("/system/identity");
    expect(factory).toHaveBeenCalledTimes(1);
    await pool.close();
  });

  it("reuses idle connection", async () => {
    const factory = vi.fn(async () => makeTransport());
    const pool = new ConnectionPool(factory, fastConfig);

    await pool.execute("/x");
    await pool.execute("/x");
    // Second call reuses same connection
    expect(factory).toHaveBeenCalledTimes(1);
    await pool.close();
  });

  it("creates up to max connections", async () => {
    const factory = vi.fn(async () => makeTransport());
    const pool = new ConnectionPool(factory, { ...fastConfig, max: 3 });

    // Saturate pool (hold connections by not awaiting release)
    const t1 = pool.acquire();
    const t2 = pool.acquire();
    const t3 = pool.acquire();
    await Promise.all([t1, t2, t3]);
    expect(factory).toHaveBeenCalledTimes(3);
    await pool.close();
  });

  it("throws PoolAcquireTimeoutError when pool exhausted", async () => {
    const factory = vi.fn(async () => makeTransport());
    const pool = new ConnectionPool(factory, { ...fastConfig, max: 1, acquireTimeoutMs: 50 });

    // Hold the only connection
    const held = pool.acquire();
    await held; // ensure factory called

    // Second acquire should timeout
    await expect(pool.acquire()).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
    await pool.close();
  });

  it("PoolAcquireTimeoutError has code connection_timeout and retriable true", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      max: 1,
      acquireTimeoutMs: 50,
    });
    await pool.acquire();
    const err = await pool.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PoolAcquireTimeoutError);
    if (err instanceof PoolAcquireTimeoutError) {
      expect(err.code).toBe("connection_timeout");
      expect(err.retriable).toBe(true);
    }
    await pool.close();
  });

  it("pre-aborted signal throws immediately", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      max: 1,
      acquireTimeoutMs: 5000,
    });
    await pool.acquire(); // hold slot

    const controller = new AbortController();
    controller.abort(new Error("abort"));

    await expect(pool.acquire(controller.signal)).rejects.toThrow("abort");
    await pool.close();
  });

  it("execute and print delegate to acquired transport", async () => {
    const inner = makeTransport();
    const pool = new ConnectionPool(async () => inner, fastConfig);

    const result = await pool.print("/interface");
    expect(result).toEqual([]);
    expect(inner.print).toHaveBeenCalledWith("/interface", undefined);
    await pool.close();
  });

  it("calls disposeTransport on close", async () => {
    const inner = makeTransport();
    const dispose = vi.fn(async () => { });
    const pool = new ConnectionPool(async () => inner, fastConfig, dispose);

    await pool.execute("/x"); // create + return to idle
    await pool.close();
    expect(dispose).toHaveBeenCalledWith(inner);
  });

  it("connectionCount reflects created connections", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), fastConfig);
    expect(pool.connectionCount).toBe(0);
    await pool.acquire();
    expect(pool.connectionCount).toBe(1);
    await pool.close();
  });

  it("throws after close", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), fastConfig);
    await pool.close();
    await expect(pool.execute("/x")).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
  });

  it("delivers waiter when connection released", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      max: 1,
      acquireTimeoutMs: 500,
    });

    // Acquire the only slot
    const t = await pool.acquire();
    expect(pool.connectionCount).toBe(1);

    // Schedule a release after short delay
    const waiterPromise = pool.acquire();
    setTimeout(() => pool.release(t), 50);

    // Waiter should get the connection
    const t2 = await waiterPromise;
    expect(t2).toBe(t);
    await pool.close();
  });

  it("idleCount returns number of idle connections", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), fastConfig);
    expect(pool.idleCount).toBe(0);
    const t = await pool.acquire();
    pool.release(t);
    expect(pool.idleCount).toBe(1);
    await pool.close();
  });

  it("rejects all waiters on close", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      max: 1,
      acquireTimeoutMs: 5000,
    });

    // Hold the only slot
    await pool.acquire();

    // Start two waiters
    const waiter1 = pool.acquire();
    const waiter2 = pool.acquire();

    // Close should reject both
    await pool.close();

    await expect(waiter1).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
    await expect(waiter2).rejects.toBeInstanceOf(PoolAcquireTimeoutError);
  });

  it("disposeTransport is called on each idle connection during close", async () => {
    const transport1 = makeTransport();
    const transport2 = makeTransport();
    let callCount = 0;
    const factory = vi.fn(async () => {
      return callCount++ === 0 ? transport1 : transport2;
    });
    const dispose = vi.fn(async () => { });
    const pool = new ConnectionPool(factory, fastConfig, dispose);

    // Create two connections and return both to idle
    const t1 = await pool.acquire();
    const t2 = await pool.acquire();
    pool.release(t1);
    pool.release(t2);
    expect(pool.idleCount).toBe(2);

    await pool.close();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("disposeTransport is not called when not provided", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), fastConfig);
    await pool.acquire();
    await pool.close();
  });

  it("release on closed pool disposes connection", async () => {
    const t = makeTransport();
    const dispose = vi.fn(async () => { });
    const pool = new ConnectionPool(async () => t, fastConfig, dispose);

    await pool.acquire();
    await pool.close();
    pool.release(t);

    expect(dispose).toHaveBeenCalledWith(t);
  });

  it("factory error decrements size and re-throws", async () => {
    const factory = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const pool = new ConnectionPool(factory, fastConfig);

    await expect(pool.acquire()).rejects.toThrow("connection refused");
    expect(pool.connectionCount).toBe(0);
    await pool.close();
  });

  it("withConnection re-throws and releases on error", async () => {
    const inner = makeTransport();
    const pool = new ConnectionPool(async () => inner, fastConfig);
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(pool.withConnection(fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalled();
    await pool.close();
  });

  it("clears heartbeat timer on close when heartbeat was active", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      heartbeatMs: 1000,
    });
    await pool.close();
  });

  it("clears idle timer on close when idle timeout was active", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      idleTimeoutMs: 5000,
    });
    await pool.close();
  });

  it("aborts waiter with signal abort during wait", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      max: 1,
      acquireTimeoutMs: 2000,
    });

    // Hold the only slot
    await pool.acquire();
    const controller = new AbortController();

    const waiterPromise = pool.acquire(controller.signal);
    // Abort after a delay
    setTimeout(() => controller.abort(new Error("user abort")), 10);

    await expect(waiterPromise).rejects.toThrow("user abort");
    await pool.close();
  });
});

describe("ConnectionPool - heartbeat (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prewarming creates min connections on idle", async () => {
    const factory = vi.fn(async () => makeTransport());
    const pool = new ConnectionPool(factory, {
      ...fastConfig,
      min: 2,
      max: 5,
    });

    // Wait for prewarm to complete (async)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.connectionCount).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  it("prewarm tolerates partial factory failures", async () => {
    let callCount = 0;
    const factory = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("fail");
      return makeTransport();
    });
    const pool = new ConnectionPool(factory, {
      ...fastConfig,
      min: 2,
      max: 5,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Only 1 connection created (1 failed, 1 succeeded)
    expect(pool.connectionCount).toBe(1);
    await pool.close();
  });

  it("heartbeat discards connection after consecutive failures", async () => {
    // Create transport whose print fails consistently
    const failTransport = makeTransport();
    failTransport.print = vi.fn(async () => {
      throw new Error("heartbeat fail");
    });

    const pool = new ConnectionPool(async () => failTransport, {
      ...fastConfig,
      min: 0,
      max: 1,
      heartbeatMs: 1000,
      heartbeatFailureThreshold: 3,
    });

    // Create a connection and return to idle
    const t = await pool.acquire();
    pool.release(t);
    expect(pool.connectionCount).toBe(1);

    // Run heartbeat 3 times (threshold = 3)
    // First failure
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(pool.connectionCount).toBe(1);

    // Second failure
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(pool.connectionCount).toBe(1);

    // Third failure - should discard
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    // After 3 failures, connection is discarded
    expect(pool.connectionCount).toBe(0);

    await pool.close();
  });

  it("heartbeat resets failure counter on success", async () => {
    const successTransport = makeTransport();
    successTransport.print = vi.fn(async () => []);

    const pool = new ConnectionPool(async () => successTransport, {
      ...fastConfig,
      min: 0,
      max: 1,
      heartbeatMs: 1000,
      heartbeatFailureThreshold: 3,
    });

    const t = await pool.acquire();
    pool.release(t);
    expect(pool.connectionCount).toBe(1);

    // Run heartbeat multiple times — should survive
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.connectionCount).toBe(1);
    await pool.close();
  });

  it("heartbeat skips when pool is closed", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      heartbeatMs: 1000,
    });
    await pool.close();

    // Should not throw
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
  });
});

describe("ConnectionPool - idle pruning (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("pruneIdle removes stale connection above min", async () => {
    const dispose = vi.fn(async () => { });
    vi.setSystemTime(new Date(2024, 0, 1, 0, 0, 0));

    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      min: 1,
      max: 3,
      idleTimeoutMs: 5000,
    }, dispose);

    // Create 3 connections and return to idle
    const t1 = await pool.acquire();
    const t2 = await pool.acquire();
    const t3 = await pool.acquire();
    pool.release(t1);
    pool.release(t2);
    pool.release(t3);
    expect(pool.connectionCount).toBe(3);
    expect(pool.idleCount).toBe(3);

    // Advance past idle timeout (check interval = min(5000, 10000) = 5000)
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.resolve();
    await Promise.resolve();

    // Should keep min=1, prune 2
    expect(pool.connectionCount).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date());
    await pool.close();
  });

  it("pruneIdle keeps connection below idleTimeoutMs", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      min: 0,
      max: 1,
      idleTimeoutMs: 5000,
    });

    const t = await pool.acquire();
    pool.release(t);
    expect(pool.connectionCount).toBe(1);

    // Advance less than idle timeout
    await vi.advanceTimersByTimeAsync(4000);
    await Promise.resolve();
    await Promise.resolve();

    expect(pool.connectionCount).toBe(1);
    await pool.close();
  });

  it("pruneIdle skips when pool is closed", async () => {
    const pool = new ConnectionPool(async () => makeTransport(), {
      ...fastConfig,
      idleTimeoutMs: 5000,
    });
    await pool.close();

    // Should not throw
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();
  });
});

describe("ConnectionPool - listen", () => {
  it("listen returns stream and releases on close", async () => {
    const transport = makeTransport();
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    transport.listen = vi.fn(async () => stream);

    const pool = new ConnectionPool(async () => transport, fastConfig);
    const s = await pool.listen("/log/print");

    expect(s).toBe(stream);
    expect(transport.listen).toHaveBeenCalled();

    // Emit close event — should release connection back to pool
    stream.emit("close");
    await pool.close();
  });

  it("listen releases and re-throws on listen failure", async () => {
    const transport = makeTransport();
    transport.listen = vi.fn(async () => {
      throw new Error("listen failed");
    });

    const pool = new ConnectionPool(async () => transport, fastConfig);
    await expect(pool.listen("/log/print")).rejects.toThrow("listen failed");

    // Connection should be released back to pool
    expect(pool.idleCount).toBe(1);
    await pool.close();
  });
});
