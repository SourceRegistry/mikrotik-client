import type { DeviceTransport } from "../routeros/transport";
import { MikrotikError, type MikrotikErrorCode, type MikrotikErrorContext } from "../errors/index";

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown when the rate-limit token bucket cannot be acquired within
 * `acquireTimeoutMs`.
 */
export class RateLimitError extends MikrotikError {
  public readonly code: MikrotikErrorCode = "rate_limited";
  public readonly retriable = true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Configuration for the token-bucket rate limiter.
 *
 * RouterOS API flood protection activates around 50+ commands/second.
 * The defaults (20 tps, burst 5) are safely below that threshold.
 *
 * @example
 * ```ts
 * const transport = withRateLimit(client, { tokensPerSecond: 10, burstSize: 3 });
 * ```
 */
export type RateLimitConfig = {
  /** Tokens added per second (sustained throughput). Default: 20. */
  tokensPerSecond: number;
  /** Bucket capacity — maximum burst size. Default: 5. */
  burstSize: number;
  /**
   * How long to wait for a token before throwing `RateLimitError` (ms).
   * Default: 5000.
   */
  acquireTimeoutMs: number;
};

/** Conservative defaults — safe for RouterOS API flood protection. */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  tokensPerSecond: 20,
  burstSize: 5,
  acquireTimeoutMs: 5000,
};

// ─── Token bucket ─────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly config: RateLimitConfig) {
    this.tokens = config.burstSize;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillMs) / 1000;
    this.tokens = Math.min(
      this.config.burstSize,
      this.tokens + elapsed * this.config.tokensPerSecond
    );
    this.lastRefillMs = now;
  }

  /** Acquire one token. Resolves immediately if available, else waits. */
  acquire(signal?: AbortSignal, context?: MikrotikErrorContext): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }

      const deadline = Date.now() + this.config.acquireTimeoutMs;
      // Poll at the token refill interval, but never wait longer than remaining time.
      // Cap at 50 ms so tests with tiny acquireTimeoutMs exit promptly.
      const basePollMs = Math.ceil(1000 / this.config.tokensPerSecond);

      const attempt = (): void => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve();
        } else if (Date.now() >= deadline) {
          reject(
            new RateLimitError(
              `Rate limit token not available within ${this.config.acquireTimeoutMs} ms`,
              { ...(context !== undefined && { context }) }
            )
          );
        } else {
          const remaining = deadline - Date.now();
          const pollMs = Math.min(basePollMs, remaining + 1, 50);
          setTimeout(attempt, Math.max(1, pollMs));
        }
      };

      const firstPoll = Math.min(basePollMs, this.config.acquireTimeoutMs + 1, 50);
      setTimeout(attempt, Math.max(1, firstPoll));
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap a `DeviceTransport` with a token-bucket rate limiter.
 *
 * Each `execute`, `print`, or `listen` call acquires one token before
 * forwarding to the inner transport. If no token is available within
 * `acquireTimeoutMs`, a `RateLimitError` is thrown.
 *
 * @example
 * ```ts
 * const transport = withRateLimit(client, DEFAULT_RATE_LIMIT_CONFIG);
 * ```
 */
export function withRateLimit(
  transport: DeviceTransport,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): DeviceTransport {
  const bucket = new TokenBucket(config);

  return {
    async execute(command, options) {
      await bucket.acquire(options?.signal, { command });
      return transport.execute(command, options);
    },
    async print(command, options) {
      await bucket.acquire(options?.signal, { command });
      return transport.print(command, options);
    },
    async listen(command, options) {
      await bucket.acquire(options?.signal, { command });
      return transport.listen(command, options);
    },
  };
}
