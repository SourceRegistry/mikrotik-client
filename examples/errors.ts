/**
 * Error handling example.
 *
 * Demonstrates the `MikrotikError` taxonomy — all errors thrown by
 * mikrotik-client extend this base class with a discriminated `.code`.
 *
 * Shows:
 * - Catching typed errors
 * - Inspecting error context (host, command, tag, phase)
 * - Understanding retriable errors vs. permanent failures
 * - The 15 error codes and when they occur
 */

import { MikrotikError, type MikrotikErrorCode } from "../src/errors";
import { RouterOSClient } from "../src/routeros";

async function main() {
  console.log("=== Error Handling Demo ===\n");

  // ── Error Code Reference ─────────────────────────────────────────────
  console.log("Available error codes:");
  const errorCodes: MikrotikErrorCode[] = [
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
  ];

  for (const code of errorCodes) {
    const retriable = isRetriable(code);
    console.log(`  ${code.padEnd(24)} — retriable: ${retriable}`);
  }

  // ── Example: auth_failed ─────────────────────────────────────────────
  console.log("\n=== Example: auth_failed ===\n");

  const authClient = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: "admin",
    password: "wrong-password", // Intentionally wrong
    tls: process.env.MIKROTIK_TLS === "true",
    ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
  });

  try {
    await authClient.connect();
    console.log("Connected (unexpected — password was wrong!)");
    await authClient.close();
  } catch (err) {
    handleMikrotikError(err);
  }

  // ── Example: connection_refused ──────────────────────────────────────
  console.log("\n=== Example: connection_refused ===\n");

  const refusedClient = new RouterOSClient({
    host: "192.0.2.1", // Documentation range — unreachable
    username: "admin",
    password: "",
    timeoutMs: 2000,
  });

  try {
    await refusedClient.connect();
    await refusedClient.close();
  } catch (err) {
    handleMikrotikError(err);
  }

  console.log("\nDone.");
}

/**
 * Handle a MikrotikError with structured logic.
 *
 * @example
 * ```ts
 * try {
 *   await client.execute("/ip/address/print");
 * } catch (err) {
 *   handleMikrotikError(err);
 * }
 * ```
 */
function handleMikrotikError(err: unknown): void {
  if (err instanceof MikrotikError) {
    console.log(`  Code:      ${err.code}`);
    console.log(`  Retriable: ${err.retriable}`);
    console.log(`  Context:   host=${err.context.host ?? "?"}, phase=${err.context.phase ?? "?"}`);
    console.log(`  Message:   ${err.message}`);

    if (err.cause) {
      console.log(`  Root cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);
    }

    // Decision: retry or abort?
    if (err.retriable) {
      console.log("  → Action: Retry with backoff");
    } else {
      console.log("  → Action: Abort — this error is not retriable");
    }
  } else {
    // Non-MikrotikError — unexpected (network error, etc.)
    console.log(`  Unknown error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Determine if an error code is retry-worthy.
 *
 * Auth/permission errors are NEVER retriable.
 * Connection-level errors are retriable.
 *
 * @example
 * ```ts
 * if (isRetriable(err.code)) {
 *   await retry(fn, { maxAttempts: 3, ... });
 * }
 * ```
 */
function isRetriable(code: MikrotikErrorCode): boolean {
  const retriableCodes: ReadonlySet<MikrotikErrorCode> = new Set([
    "connection_refused",
    "connection_timeout",
    "rate_limited",
    "circuit_open",
  ]);
  return retriableCodes.has(code);
}

void main();
