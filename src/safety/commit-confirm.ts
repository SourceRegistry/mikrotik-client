import type { DeviceTransport } from "../routeros/transport";
import type { RouterOSCommandOptions } from "../routeros/index";
import { saveBackup, removeBackup, importExport, type BackupOptions } from "./backup";

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
 * Build BackupOptions with conditional inclusion of optional fields.
 */
function buildBackupOpts(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): BackupOptions {
  const opts: BackupOptions = {};
  if (signal !== undefined) opts.signal = signal;
  if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
  return opts;
}

/**
 * The confirm/rollback contract returned by {@link commitConfirm}.
 *
 * After the mutation function executes, the caller must either:
 * - Call `confirm()` to accept the changes and cancel the auto-revert.
 * - Call `rollback()` to trigger an immediate revert.
 * - Let the deadline expire, in which case the device auto-reverts.
 */
export type CommitConfirmHandle = {
  /** Call to accept the changes and cancel the auto-revert. */
  confirm(): Promise<void>;
  /** Call to trigger an immediate revert. */
  rollback(): Promise<void>;
  /** The transaction ID (used for backup/scheduler names). */
  txid: string;
  /** The deadline for auto-revert (epoch ms). */
  deadlineMs: number;
  /** Whether the transaction has been settled (confirmed, rolled back, or timed out). */
  isSettled(): boolean;
  /** Dispose the handle regardless of state (best-effort cleanup). */
  dispose(): Promise<void>;
};

/**
 * Options for {@link commitConfirm}.
 */
export type CommitConfirmOptions = {
  /** Transport to use. */
  transport: DeviceTransport;
  /** The mutation function to execute. Receives the transport for making changes. */
  fn: (transport: DeviceTransport) => Promise<void>;
  /** Confirmation window in seconds. Default: 120. */
  windowSeconds?: number;
  /** Backup file name prefix. Default: "cc". */
  backupName?: string;
  /** Whether to delete backup after confirm. Default: true. */
  cleanupAfterConfirm?: boolean;
  /** Skip commit-confirm wrapper entirely (unsafe direct apply). Default: false.
   * When true, only `fn(transport)` is called — no backup, no auto-revert scheduler.
   * Logs a warning at warn level. */
  unsafeDirectApply?: boolean;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Timeout per command (ms). Default: 60000. */
  timeoutMs?: number;
};

/**
 * State of the commit-confirm transaction.
 */
type TransactionState = "pending" | "confirming" | "rollingBack" | "settled";

/**
 * Apply changes to a device with a commit-confirm safety wrapper.
 *
 * ### How it works:
 *
 * 1. Save a script export: `/export file=pre-${txid}`.
 * 2. Run `fn(transport)` to apply the mutation.
 * 3. Schedule an auto-revert via `/system scheduler` that imports the
 *    backup after `windowSeconds` if `confirm()` is not called.
 * 4. Return `CommitConfirmHandle` with `confirm()` and `rollback()`.
 *
 * ### confirm()
 *
 * 1. Remove the revert scheduler.
 * 2. Delete the backup file (if `cleanupAfterConfirm: true`).
 *
 * ### rollback()
 *
 * 1. Import the backup: `/import file=pre-${txid}.rsc`.
 * 2. Remove the revert scheduler.
 * 3. Delete the backup file.
 *
 * @example
 * ```ts
 * import { commitConfirm } from '@sourceregistry/mikrotik-client/safety';
 *
 * const handle = await commitConfirm({
 *   transport,
 *   windowSeconds: 300,
 *   async fn(t) {
 *     // Apply changes to the device
 *     await t.execute('/ip/address/add', {
 *       attributes: { address: '10.0.0.1/24', interface: 'ether1' },
 *     });
 *   },
 * });
 *
 * // If all looks good, confirm within the window:
 * await handle.confirm();
 *
 * // Or rollback:
 * await handle.rollback();
 * ```
 */
export async function commitConfirm(opts: CommitConfirmOptions): Promise<CommitConfirmHandle> {
  const {
    transport,
    fn,
    windowSeconds = 120,
    backupName: _backupName = "cc",
    cleanupAfterConfirm = true,
    unsafeDirectApply = false,
    signal,
    timeoutMs = 60000,
  } = opts;

  // Unsafe direct apply — skip commit-confirm wrapper
  if (unsafeDirectApply) {
    // eslint-disable-next-line no-console
    console.warn("[mikrotik-client] unsafeDirectApply=true — skipping commit-confirm wrapper");
    await fn(transport);
    return {
      txid: "",
      deadlineMs: Date.now() + Number.MAX_SAFE_INTEGER,
      isSettled: () => true,
      async confirm() {
        // no-op
      },
      async rollback() {
        // no-op
      },
      async dispose() {
        // no-op
      },
    };
  }

  // Step 1: Generate transaction ID
  const txid = crypto.randomUUID().slice(0, 8);
  const backupFile = `pre-${txid}`;
  const schedulerName = `revert-${txid}`;

  // Step 2: Save export backup
  await saveBackup(transport, backupFile, buildBackupOpts(signal, timeoutMs));

  // Step 3: Run the mutation function — clean up backup on failure
  try {
    await fn(transport);
  } catch (err) {
    try {
      await removeBackup(transport, backupFile, buildBackupOpts(signal, timeoutMs));
    } catch {
      // best-effort
    }
    throw err;
  }

  // Step 4: Schedule auto-revert
  const deadlineMs = Date.now() + windowSeconds * 1000;
  const deadlineDate = new Date(deadlineMs);

  // Build the scheduled revert command
  // Format: YYYY/Mm/DD h:mm:ss (RouterOS date format)
  const year = deadlineDate.getUTCFullYear().toString();
  const month = (deadlineDate.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = deadlineDate.getUTCDate().toString().padStart(2, "0");
  const hours = deadlineDate.getUTCHours().toString().padStart(2, "0");
  const minutes = deadlineDate.getUTCMinutes().toString().padStart(2, "0");
  const seconds = deadlineDate.getUTCSeconds().toString().padStart(2, "0");
  const startDate = `${month}/${day}/${year}`;
  const startTime = `${hours}:${minutes}:${seconds}`;

  const revertScript = `/import file=${backupFile}.rsc`;

  const cmdOpts = buildOpts(
    {
      attributes: {
        name: schedulerName,
        "on-event": revertScript,
        "start-date": startDate,
        "start-time": startTime,
        policy: "read,write,admin,test",
      },
    },
    signal,
    timeoutMs
  );
  await transport.execute("/system/scheduler/add", cmdOpts);

  // Step 5: Create and return the handle
  let state: TransactionState = "pending";

  const markSettled = (): void => {
    state = "settled";
  };

  const cleanupScheduler = async (): Promise<void> => {
    try {
      const rmOpts = buildOpts(
        {
          queries: [`name=${schedulerName}`],
        },
        signal,
        timeoutMs
      );
      await transport.execute("/system/scheduler/remove", rmOpts);
    } catch {
      // Scheduler may have already fired or been removed
    }
  };

  const cleanupBackup = async (): Promise<void> => {
    try {
      await removeBackup(transport, backupFile, buildBackupOpts(signal, timeoutMs));
    } catch {
      // File may have been cleaned up already
    }
  };

  const confirm = async (): Promise<void> => {
    if (state !== "pending") return;
    state = "confirming";
    await cleanupScheduler();
    if (cleanupAfterConfirm) {
      await cleanupBackup();
    }
    markSettled();
  };

  const rollback = async (): Promise<void> => {
    if (state !== "pending") return;
    state = "rollingBack";
    try {
      await importExport(transport, backupFile, {
        ...buildBackupOpts(signal, timeoutMs),
        confirm: true,
      });
    } finally {
      await cleanupScheduler();
      await cleanupBackup();
      markSettled();
    }
  };

  const dispose = async (): Promise<void> => {
    // Best-effort cleanup: remove scheduler and backup regardless of state
    await cleanupScheduler();
    if (state === "pending") {
      await cleanupBackup();
    }
    markSettled();
  };

  return {
    txid,
    deadlineMs,
    isSettled: () => state === "settled",
    confirm,
    rollback,
    dispose,
  };
}
