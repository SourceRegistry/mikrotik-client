// ─── CHR Test Harness ─────────────────────────────────────────────────────
// Spins RouterOS CHR v7 Docker containers for integration testing.
// Parallel-safe via port randomisation. Snapshot/reset between tests.
//
// Usage in vitest integration tests:
//   import { spinCHR, TestDevice } from "../../harness/chr";
//
//   describe("interface CRUD", () => {
//     let device: TestDevice;
//     beforeEach(async () => {
//       device = await spinCHR();
//     });
//     afterEach(async () => {
//       await device.dispose();
//     });
//     it("lists default interfaces", async () => {
//       const client = new RouterOSClient({ host: device.host, port: device.port });
//       const helpers = createRouterOSHelpers(client);
//       const ifaces = await helpers.interface.list();
//       expect(ifaces.length).toBeGreaterThan(0);
//     });
//   });

import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

import type { DeviceTransport } from "../../src/routeros/transport";

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Handle returned by `spinCHR`. Gives callers everything needed to
 * connect to a test device and tear it down afterwards.
 *
 * @example
 * ```ts
 * const device = await spinCHR();
 * const client = new RouterOSClient({ host: device.host, port: device.port, username: device.user, password: device.pass });
 * // … tests …
 * await device.dispose();
 * ```
 */
export interface TestDevice {
  /** Container name (unique per spin). */
  containerId: string;
  /** Host to connect to (usually `127.0.0.1` — mapped port). */
  host: string;
  /** TCP port for the RouterOS API (8728). */
  port: number;
  /** RouterOS version string (e.g., `"7.16"`). */
  version: string;
  /** Default admin username. */
  user: string;
  /** Default admin password (CHR images default to empty string). */
  pass: string;

  /**
   * Create a snapshot of the current device configuration via
   * `/export file=<name>` and return the filename for later restore.
   *
   * @param transport - Connected device transport.
   * @param name - Optional backup name (defaults to `snapshot-<timestamp>`).
   * @returns The backup filename on the device.
   */
  snapshot(transport: DeviceTransport, name?: string): Promise<string>;

  /**
   * Restore a previously created snapshot via `/import file=<name>`,
   * then remove the backup file.
   *
   * @param transport - Connected device transport.
   * @param name - Backup filename returned by `snapshot()`.
   */
  restore(transport: DeviceTransport, name: string): Promise<void>;

  /**
   * Dispose the container: stop + remove.
   * Idempotent — safe to call multiple times.
   */
  dispose(): Promise<void>;
}

/**
 * Options for spinning a CHR container.
 */
export interface SpinChROptions {
  /**
   * Docker image tag. Defaults to env `MIKROTIK_CHR_IMAGE` or `mikrotik/chr:latest`.
   * Examples: `"mikrotik/chr:7.16"`, `"mikrotik/chr:stable"`.
   */
  image?: string;

  /**
   * Bind the API port to a specific host port. Default: random ephemeral port.
   * Only use for debugging — random ports enable parallel test execution.
   */
  hostPort?: number;

  /**
   * Timeout (ms) for waiting API port readiness. Default: 60 000 ms.
   */
  readyTimeoutMs?: number;

  /**
   * RouterOS password to set. Default: `""` (empty, CHR default).
   * Some custom images may require a different default.
   */
  password?: string;

  /**
   * Extra Docker run arguments (e.g., `"--labels=test"`).
   */
  dockerArgs?: string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function pickImage(opts: SpinChROptions): string {
  return opts.image ?? process.env.MIKROTIK_CHR_IMAGE ?? "mikrotik/chr:latest";
}

/**
 * Ask Docker to allocate a random TCP port and return it.
 * Uses `docker run --publish` with host port `0` (Docker picks).
 * We resolve the actual port from `docker port <container>`.
 */
async function findPublishedPort(containerId: string, containerPort: number): Promise<number> {
  const { stdout } = await execFileAsync("docker", ["port", containerId, String(containerPort)]);
  // Output: `0.0.0.0:49152\n` or `::::49152\n`
  const match = stdout.trim().match(/:(\d+)$/);
  if (!match) throw new Error(`unexpected docker port output: ${stdout.trim()}`);
  return Number(match[1]);
}

/**
 * Wait until the API TCP port accepts a connection.
 * Polls every 500ms until `readyTimeoutMs` or success.
 */
function waitTcpReady(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt(): void {
      if (Date.now() > deadline) {
        reject(new Error(`CHR API port ${host}:${port} not ready after ${timeoutMs}ms`));
        return;
      }
      const sock = net.createConnection({ host, port });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        setTimeout(attempt, 500);
      });
    }
    attempt();
  });
}

/**
 * Generate a unique container name with timestamp + random suffix.
 */
function containerName(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `chr-test-${ts}-${rand}`;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Spin a RouterOS CHR Docker container and return a `TestDevice` handle.
 *
 * The handle provides port info, credentials, and `dispose()` for cleanup.
 * Snapshot/restore methods let you reset device state between tests.
 *
 * **Requirements**: Docker daemon running, `mikrotik/chr` image available locally
 * (pull with `docker pull mikrotik/chr:latest` or set `MIKROTIK_CHR_IMAGE`).
 *
 * @example
 * ```ts
 * const device = await spinCHR({ image: "mikrotik/chr:7.16" });
 * // device.host → "127.0.0.1", device.port → 49152
 * await device.dispose();
 * ```
 */
export async function spinCHR(opts: SpinChROptions = {}): Promise<TestDevice> {
  const image = pickImage(opts);
  const name = containerName();
  const readyTimeout = opts.readyTimeoutMs ?? 60_000;
  const password = opts.password ?? "";

  // Build docker run command
  const runArgs = [
    "run",
    "--name",
    name,
    "--rm", // auto-remove on exit
    "-d", // detached
  ];

  // Port mapping: publish container 8728 (API) to host port
  if (opts.hostPort !== undefined) {
    runArgs.push("-p", `${opts.hostPort}:8728`);
  } else {
    runArgs.push("-p", "0:8728"); // Docker picks random port
  }

  // Extra docker args from caller
  if (opts.dockerArgs?.length) {
    runArgs.push(...opts.dockerArgs);
  }

  // Environment: NOPASS (empty password allowed)
  runArgs.push("-e", "EULA_ACCEPT=YES");
  if (password !== "") {
    runArgs.push("-e", `PASSWORD=${password}`);
  }

  runArgs.push(image);

  await execFileAsync("docker", runArgs);

  // Resolve published port
  const port = opts.hostPort ?? (await findPublishedPort(name, 8728));

  // Wait for API readiness
  await waitTcpReady("127.0.0.1", port, readyTimeout);

  // Extract version from container (via docker inspect label or first API call)
  let version = "unknown";
  try {
    const { stdout: inspectOut } = await execFileAsync("docker", [
      "inspect",
      name,
      "--format",
      "{{.Config.Image}}",
    ]);
    const imageStr = inspectOut.trim();
    // Image tag usually contains version: mikrotik/chr:7.16 → 7.16
    const tagMatch = imageStr.match(/:(.+)$/);
    if (tagMatch?.[1]) {
      version = tagMatch[1];
    }
  } catch {
    // Non-fatal — version may be "unknown"
  }

  return {
    containerId: name,
    host: "127.0.0.1",
    port,
    version,
    user: "admin",
    pass: password,

    async snapshot(transport: DeviceTransport, snapName?: string): Promise<string> {
      const fileName = snapName ?? `snapshot-${Date.now()}`;
      await transport.execute("/export", {
        attributes: { file: fileName, "show-sensitive": "yes" },
      });
      return fileName;
    },

    async restore(transport: DeviceTransport, snapName: string): Promise<void> {
      await transport.execute("/import", {
        attributes: { "file-name": `${snapName}.rsc` },
      });
      try {
        await transport.execute("/file/remove", {
          attributes: { numbers: `${snapName}.rsc` },
        });
      } catch {
        // File may not exist — non-fatal
      }
    },

    async dispose(): Promise<void> {
      // docker rm -f (stop + remove). --rm flag from run should handle this,
      // but force it for safety.
      try {
        await execFileAsync("docker", ["rm", "-f", name]);
      } catch {
        // Container already gone
      }
    },
  };
}

/**
 * Helper: run a vitest `beforeEach`/`afterEach` pair for CHR fixtures.
 *
 * Returns `[setup, teardown]` functions.
 *
 * @example
 * ```ts
 * const [setupCHR, teardownCHR] = chrFixture();
 * beforeEach(setupCHR);
 * afterEach(teardownCHR);
 * // `ctx.device` is available in tests.
 * ```
 */
export function chrFixture<S>(
  opts?: SpinChROptions
): [
  setup: (ctx: S & { device?: TestDevice }) => Promise<void>,
  teardown: (ctx: S & { device?: TestDevice }) => Promise<void>,
] {
  return [
    async (ctx: any) => {
      (ctx as any).device = await spinCHR(opts);
    },
    async (ctx: any) => {
      await (ctx as any).device?.dispose();
      delete (ctx as any).device;
    },
  ];
}

/**
 * Skip a vitest `describe` or `it` block when CHR image is unavailable.
 *
 * @example
 * ```ts
 * describe("interface CRUD", chrSkip(), () => {
 *   // …
 * });
 * ```
 */
export function chrSkip(): string | undefined {
  if (!process.env.MIKROTIK_CHR_IMAGE && !process.env.RUN_CHR_INTEGRATION) {
    // Skip unless explicitly configured
    return "CHR integration test (set MIKROTIK_CHR_IMAGE or RUN_CHR_INTEGRATION=1)";
  }
  return undefined;
}
