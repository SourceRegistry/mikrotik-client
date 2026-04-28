import type { DeviceTransport } from "../routeros/transport";
import { MikrotikError, type MikrotikErrorCode, type MikrotikErrorContext } from "../errors/index";

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a call is rejected because the circuit is open.
 * `retriable: true` — callers can back off and retry after `recoveryMs`.
 */
export class CircuitOpenError extends MikrotikError {
  public readonly code: MikrotikErrorCode = "circuit_open";
  public readonly retriable = true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Visible state of the circuit breaker for observability. */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Configuration for the circuit breaker.
 *
 * @example
 * ```ts
 * const transport = withCircuitBreaker(client, {
 *   failureThreshold: 5,
 *   recoveryMs: 10_000,
 *   probeSuccessCount: 2,
 * });
 * ```
 */
export type CircuitBreakerConfig = {
  /**
   * Consecutive failures before the circuit opens.
   * Default: 5.
   */
  failureThreshold: number;
  /**
   * Time to wait in open state before allowing probe requests (ms).
   * Default: 30_000 (30 seconds).
   */
  recoveryMs: number;
  /**
   * Consecutive successes in half-open state required to close the circuit.
   * Default: 2.
   */
  probeSuccessCount: number;
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryMs: 30_000,
  probeSuccessCount: 2,
};

// ─── Circuit breaker ──────────────────────────────────────────────────────────

/**
 * Circuit breaker instance. Can be shared across multiple transports or used
 * as a per-device singleton when combined with `withCircuitBreaker`.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private halfOpenSuccesses = 0;

  constructor(private readonly config: CircuitBreakerConfig) {}

  /** Current observable state. */
  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Check whether a call should be allowed.
   * Transitions open → half-open when `recoveryMs` has elapsed.
   * Throws `CircuitOpenError` if the circuit is open and not yet in recovery.
   */
  checkAndAllow(context?: MikrotikErrorContext): void {
    if (this.state === "closed") return;

    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.config.recoveryMs) {
        this.state = "half-open";
        this.halfOpenSuccesses = 0;
      } else {
        throw new CircuitOpenError(
          `Circuit breaker is open — device unreachable. Retrying after ${this.config.recoveryMs} ms.`,
          { ...(context !== undefined && { context }) }
        );
      }
    }
    // half-open: allow the probe through
  }

  /** Record a successful call result. */
  recordSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.probeSuccessCount) {
        this.state = "closed";
        this.failures = 0;
        this.halfOpenSuccesses = 0;
      }
    } else if (this.state === "closed") {
      this.failures = 0;
    }
  }

  /** Record a failed call result. */
  recordFailure(): void {
    if (this.state === "half-open") {
      // Single failure in half-open reopens the circuit
      this.state = "open";
      this.openedAt = Date.now();
      this.halfOpenSuccesses = 0;
      return;
    }
    this.failures++;
    if (this.failures >= this.config.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  /** Reset the circuit to closed state (e.g. after manual intervention). */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = 0;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wrap a `DeviceTransport` with a circuit breaker.
 *
 * The circuit opens after `failureThreshold` consecutive failures and
 * rejects calls immediately (throwing `CircuitOpenError`) until `recoveryMs`
 * has elapsed. Then it enters half-open state and allows probe requests.
 * `probeSuccessCount` consecutive successes close the circuit again.
 *
 * @example
 * ```ts
 * const transport = withCircuitBreaker(client, DEFAULT_CIRCUIT_BREAKER_CONFIG);
 * ```
 */
export function withCircuitBreaker(
  transport: DeviceTransport,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
): DeviceTransport & { readonly circuitBreaker: CircuitBreaker } {
  const cb = new CircuitBreaker(config);

  async function guard<T>(fn: () => Promise<T>, context?: MikrotikErrorContext): Promise<T> {
    cb.checkAndAllow(context);
    try {
      const result = await fn();
      cb.recordSuccess();
      return result;
    } catch (err) {
      cb.recordFailure();
      throw err;
    }
  }

  return {
    execute(command, options) {
      return guard(() => transport.execute(command, options), { command });
    },
    print(command, options) {
      return guard(() => transport.print(command, options), { command });
    },
    listen(command, options) {
      return guard(() => transport.listen(command, options), { command });
    },
    get circuitBreaker() {
      return cb;
    },
  };
}
