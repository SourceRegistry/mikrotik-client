import { describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  withCircuitBreaker,
  type CircuitBreakerConfig,
} from "./circuit-breaker";
import type { DeviceTransport } from "../routeros/transport";

const fastConfig: CircuitBreakerConfig = {
  failureThreshold: 3,
  recoveryMs: 50,
  probeSuccessCount: 2,
};

function makeTransport(executeFn: () => Promise<unknown>): DeviceTransport {
  return {
    execute: vi.fn(executeFn) as DeviceTransport["execute"],
    print: vi.fn(async () => []) as DeviceTransport["print"],
    listen: vi.fn(async () => {
      throw new Error("not implemented");
    }) as DeviceTransport["listen"],
  };
}

// ─── CircuitBreaker unit tests ────────────────────────────────────────────────

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    const cb = new CircuitBreaker(fastConfig);
    expect(cb.currentState).toBe("closed");
  });

  it("opens after failureThreshold consecutive failures", () => {
    const cb = new CircuitBreaker(fastConfig);
    for (let i = 0; i < fastConfig.failureThreshold; i++) {
      cb.recordFailure();
    }
    expect(cb.currentState).toBe("open");
  });

  it("throws CircuitOpenError when open", () => {
    const cb = new CircuitBreaker(fastConfig);
    for (let i = 0; i < fastConfig.failureThreshold; i++) cb.recordFailure();
    expect(() => cb.checkAndAllow()).toThrow(CircuitOpenError);
  });

  it("transitions to half-open after recoveryMs", async () => {
    const cb = new CircuitBreaker(fastConfig);
    for (let i = 0; i < fastConfig.failureThreshold; i++) cb.recordFailure();
    expect(cb.currentState).toBe("open");

    await new Promise((r) => setTimeout(r, fastConfig.recoveryMs + 10));
    expect(() => cb.checkAndAllow()).not.toThrow(); // probe allowed
    expect(cb.currentState).toBe("half-open");
  });

  it("closes from half-open after probeSuccessCount successes", async () => {
    const cb = new CircuitBreaker(fastConfig);
    for (let i = 0; i < fastConfig.failureThreshold; i++) cb.recordFailure();
    await new Promise((r) => setTimeout(r, fastConfig.recoveryMs + 10));
    cb.checkAndAllow(); // enter half-open

    for (let i = 0; i < fastConfig.probeSuccessCount; i++) {
      cb.recordSuccess();
    }
    expect(cb.currentState).toBe("closed");
  });

  it("reopens from half-open on failure", async () => {
    const cb = new CircuitBreaker(fastConfig);
    for (let i = 0; i < fastConfig.failureThreshold; i++) cb.recordFailure();
    await new Promise((r) => setTimeout(r, fastConfig.recoveryMs + 10));
    cb.checkAndAllow(); // enter half-open

    cb.recordFailure(); // fail in half-open
    expect(cb.currentState).toBe("open");
  });

  it("resets to closed on reset()", () => {
    const cb = new CircuitBreaker(fastConfig);
    for (let i = 0; i < fastConfig.failureThreshold; i++) cb.recordFailure();
    cb.reset();
    expect(cb.currentState).toBe("closed");
    expect(() => cb.checkAndAllow()).not.toThrow();
  });

  it("success in closed state resets failure count", () => {
    const cb = new CircuitBreaker(fastConfig);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // reset
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe("closed"); // still only 2 after reset
  });
});

// ─── withCircuitBreaker integration ──────────────────────────────────────────

describe("withCircuitBreaker", () => {
  it("exposes circuitBreaker property", () => {
    const transport = withCircuitBreaker(
      makeTransport(async () => ({})),
      fastConfig
    );
    expect(transport.circuitBreaker).toBeInstanceOf(CircuitBreaker);
  });

  it("passes through on success", async () => {
    const inner = makeTransport(async () => ({ records: [], traps: [], tag: "1" }));
    const transport = withCircuitBreaker(inner, fastConfig);
    await transport.execute("/system/identity");
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it("opens circuit after threshold failures", async () => {
    const inner = makeTransport(async () => {
      throw new Error("device down");
    });
    const transport = withCircuitBreaker(inner, fastConfig);

    for (let i = 0; i < fastConfig.failureThreshold; i++) {
      await expect(transport.execute("/system/identity")).rejects.toThrow();
    }

    // Circuit should now be open
    await expect(transport.execute("/system/identity")).rejects.toBeInstanceOf(CircuitOpenError);
    // Inner not called again
    expect(inner.execute).toHaveBeenCalledTimes(fastConfig.failureThreshold);
  });

  it("recovers after recoveryMs", async () => {
    const inner = makeTransport(async () => {
      throw new Error("fail");
    });
    const transport = withCircuitBreaker(inner, fastConfig);

    for (let i = 0; i < fastConfig.failureThreshold; i++) {
      await expect(transport.execute("/x")).rejects.toThrow();
    }

    await new Promise((r) => setTimeout(r, fastConfig.recoveryMs + 10));

    // Now probe goes through (and fails, reopening)
    await expect(transport.execute("/x")).rejects.not.toBeInstanceOf(CircuitOpenError);
  });

  it("CircuitOpenError has code circuit_open and retriable true", async () => {
    const inner = makeTransport(async () => {
      throw new Error("fail");
    });
    const transport = withCircuitBreaker(inner, fastConfig);

    for (let i = 0; i < fastConfig.failureThreshold; i++) {
      await expect(transport.execute("/x")).rejects.toThrow();
    }

    const err = await transport.execute("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CircuitOpenError);
    if (err instanceof CircuitOpenError) {
      expect(err.code).toBe("circuit_open");
      expect(err.retriable).toBe(true);
    }
  });
});
