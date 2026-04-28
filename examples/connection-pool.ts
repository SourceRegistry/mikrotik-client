/**
 * Connection pool and middleware example.
 *
 * Demonstrates composable connection management:
 * - `ConnectionPool<T>` — bounded connection pool with heartbeats
 * - `RetryPolicy` — retry with exponential backoff
 * - `RateLimiter` — token bucket rate limiting
 * - `CircuitBreaker` — half-open probe circuit breaker
 *
 * All middleware wraps the `DeviceTransport` interface.
 */

import { RouterOSClient, createRouterOSHelpers } from "../src/routeros";
import { ConnectionPool, DEFAULT_POOL_CONFIG } from "../src/utils/pool";
import type { RetryPolicy } from "../src/utils/retry";
import { DEFAULT_RETRY_POLICY } from "../src/utils/retry";
import { withRateLimit, DEFAULT_RATE_LIMIT_CONFIG } from "../src/utils/rate-limit";
import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from "../src/utils/circuit-breaker";

async function main() {
  const host = process.env.MIKROTIK_HOST ?? "192.168.88.1";
  const username = process.env.MIKROTIK_USERNAME ?? "admin";
  const password = process.env.MIKROTIK_PASSWORD ?? "";

  // ── Connection Pool ──────────────────────────────────────────────
  console.log("=== Connection Pool ===\n");

  const pool = new ConnectionPool(
    async () => {
      const client = new RouterOSClient({
        host,
        username,
        password,
        tls: process.env.MIKROTIK_TLS === "true",
        ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
      });
      await client.connect();
      return client;
    },
    {
      min: 1,
      max: 5,
      idleTimeoutMs: 60_000,
      acquireTimeoutMs: 10_000,
      heartbeatMs: 30_000,
      heartbeatFailureThreshold: 3,
    },
    async (transport) => {
      if (transport instanceof RouterOSClient) {
        await transport.close();
      }
    }
  );

  // The pool itself implements DeviceTransport — use it directly:
  const helpers = createRouterOSHelpers(pool);
  const interfaces = await helpers.interface.list();
  console.log(`Pool acquired a connection and listed ${interfaces.length} interfaces:`);
  for (const iface of interfaces) {
    console.log(`  ${iface.name} (running: ${iface.running ?? "?"})`);
  }

  await pool.close();
  console.log("\nPool closed.")

  // ── Retry Policy ─────────────────────────────────────────────────
  console.log("\n=== Retry Policy ===\n");

  const retryPolicy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    maxAttempts: 3,
    baseMs: 1000,
    maxMs: 30_000,
  };

  console.log("Retry policy: 3 attempts, exponential backoff, retries on:");
  console.log("  " + retryPolicy.retriableCodes.join(", "));

  // ── Rate Limiter ─────────────────────────────────────────────────
  console.log("\n=== Rate Limiter ===\n");

  console.log("Rate limiter config:");
  console.log(`  tokensPerSecond: ${DEFAULT_RATE_LIMIT_CONFIG.tokensPerSecond}`);
  console.log(`  burstSize: ${DEFAULT_RATE_LIMIT_CONFIG.burstSize}`);
  console.log("Use withRateLimit(client, config) to wrap a transport");

  // ── Circuit Breaker ──────────────────────────────────────────────
  console.log("\n=== Circuit Breaker ===\n");

  const circuitBreaker = new CircuitBreaker({
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    failureThreshold: 3,
  });

  console.log("Circuit breaker: opens after 3 failures, resets after 30s");
  console.log(`State: ${circuitBreaker.currentState}`);

  console.log("\nDone.");
}

void main();
