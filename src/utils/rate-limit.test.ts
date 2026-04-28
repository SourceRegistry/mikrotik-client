import { describe, expect, it, vi } from "vitest";
import { withRateLimit, RateLimitError, type RateLimitConfig } from "./rate-limit";
import type { DeviceTransport } from "../routeros";

function makeTransport(): DeviceTransport {
  return {
    execute: vi.fn(async () => ({ records: [], traps: [], tag: "1" })),
    print: vi.fn(async () => []),
    listen: vi.fn(async () => { throw new Error("not implemented"); }),
  } as DeviceTransport;
}

describe("withRateLimit", () => {
  it("passes through when tokens available", async () => {
    const inner = makeTransport();
    const transport = withRateLimit(inner, {
      tokensPerSecond: 100,
      burstSize: 5,
      acquireTimeoutMs: 1000,
    });

    await transport.execute("/system/identity");
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it("allows burst up to burstSize without delay", async () => {
    const inner = makeTransport();
    const config: RateLimitConfig = {
      tokensPerSecond: 1, // very slow refill
      burstSize: 3,
      acquireTimeoutMs: 100,
    };
    const transport = withRateLimit(inner, config);

    // 3 calls should succeed immediately (burst)
    await transport.execute("/system/identity");
    await transport.execute("/system/identity");
    await transport.execute("/system/identity");
    expect(inner.execute).toHaveBeenCalledTimes(3);
  });

  it("throws RateLimitError when bucket exhausted and timeout exceeded", async () => {
    const config: RateLimitConfig = {
      tokensPerSecond: 0.01, // essentially never refills in test timeframe
      burstSize: 1,
      acquireTimeoutMs: 50,
    };
    const transport = withRateLimit(makeTransport(), config);

    // Exhaust the burst
    await transport.execute("/system/identity");

    // Next call should timeout
    await expect(transport.execute("/system/identity")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("RateLimitError has code rate_limited and retriable true", async () => {
    const config: RateLimitConfig = {
      tokensPerSecond: 0.01,
      burstSize: 1,
      acquireTimeoutMs: 50,
    };
    const transport = withRateLimit(makeTransport(), config);
    await transport.execute("/x");

    const err = await transport.execute("/y").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    if (err instanceof RateLimitError) {
      expect(err.code).toBe("rate_limited");
      expect(err.retriable).toBe(true);
    }
  });

  it("pre-aborted signal throws immediately", async () => {
    const transport = withRateLimit(makeTransport(), {
      tokensPerSecond: 0.01,
      burstSize: 1,
      acquireTimeoutMs: 5000,
    });
    await transport.execute("/x"); // exhaust burst

    const controller = new AbortController();
    controller.abort(new Error("aborted"));

    await expect(
      transport.execute("/y", { signal: controller.signal })
    ).rejects.toThrow("aborted");
  });

  it("print goes through rate limiter", async () => {
    const inner = makeTransport();
    const config: RateLimitConfig = {
      tokensPerSecond: 0.01,
      burstSize: 2,
      acquireTimeoutMs: 50,
    };
    const transport = withRateLimit(inner, config);

    await transport.print("/interface");
    await transport.print("/interface");

    await expect(transport.print("/interface")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("listen goes through rate limiter", async () => {
    const inner = makeTransport();
    const config: RateLimitConfig = {
      tokensPerSecond: 0.01,
      burstSize: 0,
      acquireTimeoutMs: 50,
    };
    const transport = withRateLimit(inner, config);

    await expect(transport.listen("/log")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("aborts acquire via signal during polling", async () => {
    const inner = makeTransport();
    const config: RateLimitConfig = {
      tokensPerSecond: 0.01,
      burstSize: 1,
      acquireTimeoutMs: 500,
    };
    const transport = withRateLimit(inner, config);
    const controller = new AbortController();

    await transport.execute("/warmup"); // exhaust burst

    const p = transport.execute("/queued", { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled")), 10);
    await expect(p).rejects.toThrow("cancelled");
  });

  it("acquires via gradual refill during polling", async () => {
    const inner = makeTransport();
    const config: RateLimitConfig = {
      tokensPerSecond: 50, // fast refill
      burstSize: 1,
      acquireTimeoutMs: 2000,
    };
    const transport = withRateLimit(inner, config);

    // Exhaust the burst
    await transport.execute("/warmup");

    // Next call should acquire via refill during polling
    await transport.execute("/after-refill");
    expect(inner.execute).toHaveBeenCalledTimes(2);
  });

  it("successful listen passes through rate limiter", async () => {
    const inner: DeviceTransport = {
      execute: vi.fn(async () => ({ records: [], traps: [], tag: "1" })),
      print: vi.fn(async () => []),
      listen: vi.fn(async () => [] as any), // succeed instead of throwing
    };
    const config: RateLimitConfig = {
      tokensPerSecond: 100,
      burstSize: 5,
      acquireTimeoutMs: 1000,
    };
    const transport = withRateLimit(inner, config);

    const result = await transport.listen("/log");
    expect(result).toEqual([]);
    expect(inner.listen).toHaveBeenCalledWith("/log", undefined);
  });
});
