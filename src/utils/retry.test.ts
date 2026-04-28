import { describe, expect, it, vi } from "vitest";
import { withRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry";
import { MikrotikError, type MikrotikErrorCode, type MikrotikErrorContext } from "../errors/index";
import type { DeviceTransport } from "../routeros/transport";

// ─── Test error ───────────────────────────────────────────────────────────────

class TestError extends MikrotikError {
  constructor(
    public readonly code: MikrotikErrorCode,
    public readonly retriable: boolean,
    context?: MikrotikErrorContext
  ) {
    super(`test error: ${code}`, { context });
  }
}

// ─── Mock transport ───────────────────────────────────────────────────────────

function makeTransport(executeFn: () => Promise<unknown>): DeviceTransport {
  return {
    execute: vi.fn(executeFn) as DeviceTransport["execute"],
    print: vi.fn(async () => []) as DeviceTransport["print"],
    listen: vi.fn(async () => { throw new Error("listen not implemented"); }) as DeviceTransport["listen"],
  };
}

const policy: RetryPolicy = {
  ...DEFAULT_RETRY_POLICY,
  maxAttempts: 3,
  baseMs: 0,
  maxMs: 0,
  jitter: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const inner = makeTransport(async () => ({ records: [], traps: [], tag: "1" }));
    const transport = withRetry(inner, policy);

    await transport.execute("/system/identity");
    expect(inner.execute).toHaveBeenCalledTimes(1);
  });

  it("retries on retriable error and succeeds", async () => {
    let calls = 0;
    const inner = makeTransport(async () => {
      calls++;
      if (calls < 3) throw new TestError("connection_timeout", true);
      return { records: [], traps: [], tag: "1" };
    });
    const transport = withRetry(inner, policy);

    await transport.execute("/system/identity");
    expect(calls).toBe(3);
  });

  it("does not retry non-retriable error", async () => {
    let calls = 0;
    const inner = makeTransport(async () => {
      calls++;
      throw new TestError("auth_failed", false);
    });
    const transport = withRetry(inner, policy);

    await expect(transport.execute("/system/identity")).rejects.toBeInstanceOf(TestError);
    expect(calls).toBe(1);
  });

  it("does not retry error code not in policy retriableCodes", async () => {
    let calls = 0;
    const inner = makeTransport(async () => {
      calls++;
      // retriable=true but code not in retriableCodes list
      throw new TestError("trap", true);
    });
    const transport = withRetry(inner, policy);

    await expect(transport.execute("/system/identity")).rejects.toBeInstanceOf(TestError);
    expect(calls).toBe(1);
  });

  it("exhausts maxAttempts and rethrows last error", async () => {
    let calls = 0;
    const inner = makeTransport(async () => {
      calls++;
      throw new TestError("connection_timeout", true);
    });
    const transport = withRetry(inner, policy);

    await expect(transport.execute("/system/identity")).rejects.toBeInstanceOf(TestError);
    expect(calls).toBe(policy.maxAttempts);
  });

  it("does not retry listen", async () => {
    let calls = 0;
    const inner: DeviceTransport = {
      execute: vi.fn(async () => ({ records: [], traps: [], tag: "1" })),
      print: vi.fn(async () => []),
      listen: vi.fn(async () => {
        calls++;
        throw new TestError("connection_timeout", true);
      }),
    };
    const transport = withRetry(inner, policy);

    await expect(transport.listen("/interface/listen")).rejects.toBeInstanceOf(TestError);
    expect(calls).toBe(1);
  });

  it("respects aborted signal — does not attempt", async () => {
    let calls = 0;
    const inner = makeTransport(async () => {
      calls++;
      return { records: [], traps: [], tag: "1" };
    });
    const transport = withRetry(inner, policy);
    const controller = new AbortController();
    controller.abort(new Error("aborted"));

    await expect(
      transport.execute("/system/identity", { signal: controller.signal })
    ).rejects.toThrow("aborted");
    expect(calls).toBe(0);
  });

  it("retries print the same as execute", async () => {
    let calls = 0;
    const inner: DeviceTransport = {
      execute: vi.fn(async () => ({ records: [], traps: [], tag: "1" })),
      print: vi.fn(async () => {
        calls++;
        if (calls < 2) throw new TestError("connection_refused", true);
        return [];
      }),
      listen: vi.fn(async () => { throw new Error(); }),
    };
    const transport = withRetry(inner, policy);

    const result = await transport.print("/interface");
    expect(result).toEqual([]);
    expect(calls).toBe(2);
  });

  it("aborts during sleep between retries", async () => {
    const inner = makeTransport(async () => {
      throw new TestError("connection_timeout", true);
    });
    const controller = new AbortController();
    const slowPolicy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 5,
      baseMs: 100,
      maxMs: 1000,
      jitter: 0,
    };
    const transport = withRetry(inner, slowPolicy);
    const p = transport.execute("/s", { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled")), 10);
    await expect(p).rejects.toThrow("cancelled");
  });
});
