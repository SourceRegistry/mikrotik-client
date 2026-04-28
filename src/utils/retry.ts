import type { DeviceTransport } from "../routeros/transport";
import { MikrotikError, type MikrotikErrorCode } from "../errors/index";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetryBackoff = "exponential" | "fixed";

/**
 * Policy controlling how failed commands are retried.
 *
 * @example
 * ```ts
 * const transport = withRetry(client, {
 *   ...DEFAULT_RETRY_POLICY,
 *   maxAttempts: 5,
 *   baseMs: 500,
 * });
 * ```
 */
export type RetryPolicy = {
  /** Maximum number of attempts (including the first). */
  maxAttempts: number;
  /** Backoff strategy between attempts. */
  backoff: RetryBackoff;
  /** Base delay in milliseconds. */
  baseMs: number;
  /** Maximum delay cap for exponential backoff (milliseconds). */
  maxMs: number;
  /**
   * Add random jitter as a fraction of the computed delay.
   * `0` = no jitter, `0.2` = ±20% of delay.
   */
  jitter: number;
  /**
   * Error codes that are eligible for retry.
   * Codes not in this list cause immediate failure regardless of `retriable`.
   */
  retriableCodes: readonly MikrotikErrorCode[];
};

/**
 * Default set of error codes eligible for retry.
 * Authentication and permission errors are excluded deliberately — retrying
 * those wastes time and can trigger account lockout.
 */
export const DEFAULT_RETRIABLE_CODES: readonly MikrotikErrorCode[] = [
  "connection_refused",
  "connection_timeout",
  "tls_failed",
  "rate_limited",
  "protocol_violation",
  "aborted",
] as const;

/** Default retry policy — 3 attempts, exponential backoff, 200 ms base. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: "exponential",
  baseMs: 200,
  maxMs: 5000,
  jitter: 0.2,
  retriableCodes: DEFAULT_RETRIABLE_CODES,
};

// ─── Internals ────────────────────────────────────────────────────────────────

function computeDelay(attempt: number, policy: RetryPolicy): number {
  const base =
    policy.backoff === "exponential"
      ? Math.min(policy.baseMs * 2 ** attempt, policy.maxMs)
      : policy.baseMs;
  const jitterAmount = base * policy.jitter * (2 * Math.random() - 1);
  return Math.max(0, Math.round(base + jitterAmount));
}

function shouldRetry(err: unknown, policy: RetryPolicy): boolean {
  if (!(err instanceof MikrotikError)) return false;
  if (!err.retriable) return false;
  return (policy.retriableCodes as readonly string[]).includes(err.code);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

async function withRetryFn<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < policy.maxAttempts; i++) {
    if (signal?.aborted) throw signal.reason;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err, policy) || i === policy.maxAttempts - 1) break;
      await sleep(computeDelay(i, policy), signal);
    }
  }
  throw lastErr;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap a `DeviceTransport` with retry logic.
 *
 * - `execute` and `print` are retried on eligible errors.
 * - `listen` is **never** retried — streams are caller-managed.
 * - Retries respect the `signal` from command options (an aborted signal
 *   cancels any pending sleep between attempts).
 *
 * @example
 * ```ts
 * const transport = withRetry(client, DEFAULT_RETRY_POLICY);
 * const helpers = createRouterOSHelpers(transport);
 * ```
 */
export function withRetry(
  transport: DeviceTransport,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): DeviceTransport {
  return {
    execute(command, options) {
      return withRetryFn(() => transport.execute(command, options), policy, options?.signal);
    },
    print(command, options) {
      return withRetryFn(() => transport.print(command, options), policy, options?.signal);
    },
    listen(command, options) {
      return transport.listen(command, options);
    },
  };
}
