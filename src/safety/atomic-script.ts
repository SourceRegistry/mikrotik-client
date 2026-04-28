import type { DeviceTransport } from "../routeros/transport";
import type { RouterOSCommandOptions } from "../routeros/index";
import {
  commitConfirm,
  type CommitConfirmOptions,
  type CommitConfirmHandle,
} from "./commit-confirm";

/**
 * Build RouterOSCommandOptions with conditional inclusion of optional fields.
 * Required due to `exactOptionalPropertyTypes: true`.
 */
function buildOpts(
  base: Omit<RouterOSCommandOptions, "signal" | "timeoutMs">,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): RouterOSCommandOptions {
  const opts: RouterOSCommandOptions = { ...base };
  if (signal !== undefined) opts.signal = signal;
  if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
  return opts;
}

/**
 * Build CommitConfirmOptions safely.
 */
function buildCommitConfirmOpts(
  base: Omit<CommitConfirmOptions, "signal" | "timeoutMs">,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): CommitConfirmOptions {
  const opts: CommitConfirmOptions = { ...base };
  if (signal !== undefined) opts.signal = signal;
  if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
  return opts;
}

/**
 * Options for {@link atomicScript}.
 */
export type AtomicScriptOptions = {
  /** Confirmation window in seconds. Default: 120. */
  windowSeconds?: number;
  /** Backup file name prefix. Default: "cc". */
  backupName?: string;
  /** Whether to delete backup after confirm. Default: true. */
  cleanupAfterConfirm?: boolean;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Timeout per command (ms). Default: 60000. */
  timeoutMs?: number;
};

/**
 * Push and execute a RouterOS script as a single atomic operation,
 * wrapped in a commit-confirm safety window.
 *
 * ### How it works:
 *
 * 1. Takes a pre-export backup of the current running config.
 * 2. Creates a temporary script via `/system script add name=tmp-${txid}`.
 * 3. Runs the script via `/system script run tmp-${txid}`.
 * 4. Removes the temporary script via `/system script remove`.
 * 5. Returns a `CommitConfirmHandle` — caller must `confirm()` or `rollback()`
 *    within the window, or the device auto-reverts.
 *
 * This is useful for applying large configuration changes in one shot
 * where the script contains multiple dependent commands that should
 * fail atomically if any step errors.
 *
 * On RouterOS v7, imported scripts halt on first error by default.
 * On v6, use `:err` in the script to halt manually.
 *
 * @example
 * ```ts
 * import { atomicScript } from '@sourceregistry/mikrotik-client/safety';
 *
 * const script = `
 *   /interface ethernet set ether1 disabled=no
 *   /ip address add address=10.0.0.1/24 interface=ether1
 *   /ip route add dst-address=0.0.0.0/0 gateway=10.0.0.254
 * `;
 *
 * const handle = await atomicScript(transport, {
 *   script,
 *   windowSeconds: 300,
 * });
 *
 * // Verify connectivity, then confirm:
 * await handle.confirm();
 * ```
 */
export async function atomicScript(
  transport: DeviceTransport,
  opts: { script: string } & AtomicScriptOptions
): Promise<CommitConfirmHandle> {
  const {
    script,
    windowSeconds = 120,
    backupName = "cc",
    cleanupAfterConfirm = true,
    signal,
    timeoutMs = 60000,
  } = opts;

  // Strip leading/trailing whitespace
  const trimmed = script.trim();

  return commitConfirm(
    buildCommitConfirmOpts(
      {
        transport,
        windowSeconds,
        backupName,
        cleanupAfterConfirm,
        async fn(t) {
          // Generate a unique script name for this execution
          const txid = crypto.randomUUID().slice(0, 8);
          const scriptName = `tmp-${txid}`;

          // Step 1: Create temporary script
          const createOpts = buildOpts(
            {
              attributes: {
                name: scriptName,
                source: trimmed,
              },
            },
            signal,
            timeoutMs
          );
          await t.execute("/system/script/add", createOpts);

          // Step 2: Run the script
          const runOpts = buildOpts(
            {
              queries: [`name=${scriptName}`],
            },
            signal,
            timeoutMs
          );
          await t.execute("/system/script/run", runOpts);

          // Step 3: Remove the temporary script
          const rmOpts = buildOpts(
            {
              queries: [`name=${scriptName}`],
            },
            signal,
            timeoutMs
          );
          await t.execute("/system/script/remove", rmOpts);
        },
      },
      signal,
      timeoutMs
    )
  );
}
