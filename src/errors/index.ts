/**
 * Discriminated error code taxonomy for all mikrotik-client errors.
 * Stable across minor versions; breaking changes require a major bump.
 */
export type MikrotikErrorCode =
  | "auth_failed"
  | "permission_denied"
  | "connection_refused"
  | "connection_timeout"
  | "tls_failed"
  | "trap"
  | "rate_limited"
  | "circuit_open"
  | "protocol_violation"
  | "parse_failed"
  | "aborted"
  | "unsupported_version"
  | "precondition_failed"
  | "ssh_failed"
  | "http_error";

export const MIKROTIK_ERROR_CODES: readonly MikrotikErrorCode[] = [
  "auth_failed",
  "permission_denied",
  "connection_refused",
  "connection_timeout",
  "tls_failed",
  "trap",
  "rate_limited",
  "circuit_open",
  "protocol_violation",
  "parse_failed",
  "aborted",
  "unsupported_version",
  "precondition_failed",
  "ssh_failed",
  "http_error",
] as const;

export type MikrotikErrorContext = {
  /** Device hostname or IP, if known. */
  host?: string;
  /** RouterOS command path, if applicable. */
  command?: string;
  /** RouterOS API tag, if applicable. */
  tag?: string;
  /** Phase of the operation (e.g. "connect", "login", "execute"). */
  phase?: string;
};

/**
 * Base class for all errors thrown by mikrotik-client.
 *
 * @example
 * ```ts
 * try {
 *   await client.connect();
 * } catch (err) {
 *   if (err instanceof MikrotikError) {
 *     console.error(err.code, err.retriable, err.context);
 *   }
 * }
 * ```
 */
export abstract class MikrotikError extends Error {
  public abstract readonly code: MikrotikErrorCode;
  public abstract readonly retriable: boolean;
  public readonly context: MikrotikErrorContext;

  public constructor(
    message: string,
    options?: { cause?: unknown; context?: MikrotikErrorContext }
  ) {
    super(message, { cause: options?.cause });
    this.context = options?.context ?? {};
  }
}
