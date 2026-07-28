import type { DeviceTransport } from "../routeros/transport";
import type { RouterOSCommandOptions } from "../routeros/index";
import { saveBackup, removeBackup, type BackupOptions } from "./backup";
import {
  parseExport,
  diff,
  renderPatch,
  applyPatch,
  isResourceBlock,
  type Patch,
  type RouterOSConfig,
} from "../ir";

/**
 * Menus whose `/export` a full snapshot would otherwise omit when left at
 * their default value (RouterOS only exports non-default state). These are
 * all fixed-cardinality, `set`-only menus — entries can't be added or
 * removed, so an omitted-then-changed entry is exactly the scenario that
 * previously produced an unusable (or invalid) revert. They're small
 * enough that scoping `export verbose` to just the menu (via
 * `<path>/export`, not the unsupported `/export path=...`) keeps every
 * capture well under RouterOS's file-content read-back size limit.
 *
 * `/ip service` is the headline case — it's what controls whether the api,
 * ssh, www, and winbox ports stay reachable at all, so a change to an
 * untouched entry there is the single most likely way to self-lock-out.
 */
const ALWAYS_CAPTURE_PATHS = ["/ip service", "/system identity", "/system clock", "/system note"];

/** Convert an IR-style space-separated path to an API/command slash path. */
function toCommandPath(path: string): string {
  return path.trim().replace(/\s+/g, "/");
}

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
 * Read a `.rsc` file's text content back off the device via `/file/print`.
 * Returns `""` if the file has no content or wasn't found.
 */
async function readFileContents(
  transport: DeviceTransport,
  fileNameNoExt: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): Promise<string> {
  const result = await transport.execute(
    "/file/print",
    buildOpts(
      {
        attributes: { ".proplist": ["contents"] },
        queries: [`?name=${fileNameNoExt}.rsc`],
      },
      signal,
      timeoutMs
    )
  );
  return result.records[0]?.contents ?? "";
}

/**
 * Read a throwaway `.rsc` file's contents and remove it, resolving `.id`
 * first rather than removing by `numbers=<name>.rsc`. Found live: removing
 * a just-created file by name reports success ("!done") but the file is
 * still there moments later — whatever RouterOS does internally to index a
 * fresh file by name apparently hasn't finished by the time a rapid
 * create → read → remove sequence gets to the remove step. Removing by
 * `.id` (resolved in the same print call that reads the contents) has no
 * such lag.
 */
async function readAndRemoveFile(
  transport: DeviceTransport,
  fileNameNoExt: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): Promise<string> {
  let fileId: string | undefined;
  let contents = "";
  try {
    const result = await transport.execute(
      "/file/print",
      buildOpts(
        {
          attributes: { ".proplist": ["contents", ".id"] },
          queries: [`?name=${fileNameNoExt}.rsc`],
        },
        signal,
        timeoutMs
      )
    );
    fileId = result.records[0]?.[".id"];
    contents = result.records[0]?.contents ?? "";
  } catch {
    // fall through — still attempt removal by name below
  }
  try {
    await transport.execute(
      "/file/remove",
      buildOpts({ attributes: { numbers: fileId ?? `${fileNameNoExt}.rsc` } }, signal, timeoutMs)
    );
  } catch {
    // best-effort — throwaway file
  }
  return contents;
}

/**
 * Capture a full, verbose `export` of a single menu (including entries at
 * their default value) and parse it. Best-effort — returns an empty config
 * if the menu doesn't exist on this device/RouterOS build, rather than
 * failing the whole snapshot over one optional path.
 */
async function captureMenuVerbose(
  transport: DeviceTransport,
  path: string,
  fileNameNoExt: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): Promise<RouterOSConfig> {
  try {
    await transport.execute(
      `${toCommandPath(path)}/export`,
      buildOpts({ attributes: { verbose: null, file: fileNameNoExt } }, signal, timeoutMs)
    );
  } catch {
    // Menu doesn't exist on this device/RouterOS build, or export failed —
    // nothing was written, so there's nothing to clean up either.
    return { items: [] };
  }

  const text = await readAndRemoveFile(transport, fileNameNoExt, signal, timeoutMs);
  return parseExport(text);
}

/**
 * Capture a config snapshot: the normal full-tree export (reliably catches
 * additions/removals of genuinely add/removable resources) merged with a
 * verbose, per-menu capture of {@link ALWAYS_CAPTURE_PATHS} (which the
 * full-tree export would silently omit if left at default). The curated
 * captures win over anything the plain export happened to also mention for
 * those same paths, since they're guaranteed complete.
 */
async function captureSnapshot(
  transport: DeviceTransport,
  plainConfig: RouterOSConfig,
  txid: string,
  tag: string,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): Promise<RouterOSConfig> {
  // Sequential, not Promise.all: concurrent export/file-read/file-remove
  // triples over one API session were unreliable in practice — some of the
  // temporary files never got cleaned up (the device doesn't reliably
  // handle overlapping file operations on the same connection).
  const curatedItems: RouterOSConfig["items"] = [];
  for (let i = 0; i < ALWAYS_CAPTURE_PATHS.length; i++) {
    const menuConfig = await captureMenuVerbose(
      transport,
      ALWAYS_CAPTURE_PATHS[i]!,
      `cc-${txid}-${tag}-${i}`,
      signal,
      timeoutMs
    );
    curatedItems.push(...menuConfig.items);
  }

  const isCuratedPath = (path: string): boolean => ALWAYS_CAPTURE_PATHS.includes(path);
  const remainingPlainItems = plainConfig.items.filter(
    (item) => !isResourceBlock(item) || !isCuratedPath(item.path)
  );

  return { ...plainConfig, items: [...remainingPlainItems, ...curatedItems] };
}

/**
 * Apply a revert {@link Patch} and throw if any operation failed.
 * `applyPatch` never throws on its own — it collects failures in the
 * result — so callers that need rollback failures to surface must check.
 */
async function applyRevertPatch(
  transport: DeviceTransport,
  patch: Patch,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined
): Promise<void> {
  const applyOpts = {
    ...(signal !== undefined && { signal }),
    ...(timeoutMs !== undefined && { timeoutMs }),
  };
  const result = await applyPatch(transport, patch, applyOpts);
  if (result.failed.length > 0) {
    const detail = result.failed.map((f) => f.error).join("; ");
    throw new Error(
      `commitConfirm rollback incomplete (${result.failed.length} failed): ${detail}`
    );
  }
}

/**
 * Apply changes to a device with a commit-confirm safety wrapper.
 *
 * ### How it works:
 *
 * 1. Save a script export (`/export file=pre-${txid}`) — kept on the device
 *    for the duration of the window as a manual last-resort artifact — and
 *    parse it as the "before" snapshot, topped up with a verbose per-menu
 *    capture of `/ip service`, `/system identity`, `/system clock`, and
 *    `/system note` (see `ALWAYS_CAPTURE_PATHS`), since RouterOS's export
 *    omits entries left at their default value and these are exactly the
 *    fixed-cardinality menus most likely to matter for a lockout (`/ip
 *    service` controls whether the api/ssh/www/winbox ports stay reachable
 *    at all).
 * 2. Run `fn(transport)` to apply the mutation, then take a second,
 *    throwaway export (plus the same verbose top-up) and parse it as the
 *    "after" snapshot.
 * 3. Diff `after` → `before` and render the result as a RouterOS script —
 *    this is the *targeted* set of `add`/`set`/`remove` commands needed to
 *    undo exactly what `fn()` changed (unlike replaying a raw `/export`
 *    dump, which chokes on default objects that already exist and can't
 *    delete anything `fn()` added in the first place).
 * 4. Schedule that script via `/system scheduler` to run after
 *    `windowSeconds` if `confirm()` is not called.
 * 5. Return `CommitConfirmHandle` with `confirm()` and `rollback()`.
 *
 * ### confirm()
 *
 * 1. Remove the revert scheduler.
 * 2. Delete the backup file (if `cleanupAfterConfirm: true`).
 *
 * ### rollback()
 *
 * 1. Apply the revert patch computed in step 3 above.
 * 2. Remove the revert scheduler.
 * 3. Delete the backup file.
 *
 * **Known limitation**: RouterOS's `/export` omits entries left at their
 * default value. The verbose top-up in step 1 covers the menus in
 * `ALWAYS_CAPTURE_PATHS`, but for any *other* fixed-cardinality, `set`-only
 * menu, if `fn()` changes something that was previously at its default,
 * the "before" snapshot never captured that entity at all, so the revert
 * can't diff it back to its original state — that specific change is
 * silently left out of the revert patch rather than reverted incorrectly.
 * Everything else `fn()` touched still reverts normally.
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
  const afterFile = `post-${txid}`;
  const schedulerName = `revert-${txid}`;

  // Step 2: Save export backup (kept as a manual fallback for the whole
  // window) and parse it as the "before" snapshot, topped up with a
  // verbose per-menu capture of ALWAYS_CAPTURE_PATHS so entries left at
  // default (which the plain export omits) are still known.
  await saveBackup(transport, backupFile, buildBackupOpts(signal, timeoutMs));
  const plainBeforeConfig = parseExport(
    await readFileContents(transport, backupFile, signal, timeoutMs)
  );
  const beforeConfig = await captureSnapshot(
    transport,
    plainBeforeConfig,
    txid,
    "before",
    signal,
    timeoutMs
  );

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

  // Step 3.5: Take a throwaway "after" snapshot and compute the revert patch —
  // the minimal set of add/set/remove commands that undo exactly what fn()
  // changed. This is what actually gets scheduled and what rollback() applies.
  await saveBackup(transport, afterFile, buildBackupOpts(signal, timeoutMs));
  const plainAfterConfig = parseExport(
    await readAndRemoveFile(transport, afterFile, signal, timeoutMs)
  );
  const afterConfig = await captureSnapshot(
    transport,
    plainAfterConfig,
    txid,
    "after",
    signal,
    timeoutMs
  );
  const revertPatch = diff(afterConfig, beforeConfig);

  // Step 4: Schedule auto-revert
  const deadlineMs = Date.now() + windowSeconds * 1000;
  const deadlineDate = new Date(deadlineMs);

  // Build the scheduled revert command.
  // RouterOS scheduler start-date requires a month abbreviation, e.g. "jan/02/2027" —
  // zero-padded numeric months (e.g. "01/02/2027") are rejected with "invalid date".
  const MONTH_ABBREVIATIONS = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ] as const;
  const year = deadlineDate.getUTCFullYear().toString();
  const month = MONTH_ABBREVIATIONS[deadlineDate.getUTCMonth()];
  const day = deadlineDate.getUTCDate().toString().padStart(2, "0");
  const hours = deadlineDate.getUTCHours().toString().padStart(2, "0");
  const minutes = deadlineDate.getUTCMinutes().toString().padStart(2, "0");
  const seconds = deadlineDate.getUTCSeconds().toString().padStart(2, "0");
  const startDate = `${month}/${day}/${year}`;
  const startTime = `${hours}:${minutes}:${seconds}`;

  const revertScript = renderPatch(revertPatch);

  const cmdOpts = buildOpts(
    {
      attributes: {
        name: schedulerName,
        "on-event": revertScript,
        "start-date": startDate,
        "start-time": startTime,
        policy: "read,write,policy,test",
      },
    },
    signal,
    timeoutMs
  );
  try {
    await transport.execute("/system/scheduler/add", cmdOpts);
  } catch (err) {
    // The mutation from Step 3 is already live on the device but has no
    // auto-revert armed. Leaving it in place would defeat the point of
    // commit-confirm, so roll back immediately using the revert patch.
    try {
      await applyRevertPatch(transport, revertPatch, signal, timeoutMs);
    } catch {
      // best-effort — still surface the original scheduler error below
    }
    try {
      await removeBackup(transport, backupFile, buildBackupOpts(signal, timeoutMs));
    } catch {
      // best-effort
    }
    throw err;
  }

  // Step 5: Create and return the handle
  let state: TransactionState = "pending";

  const markSettled = (): void => {
    state = "settled";
  };

  const cleanupScheduler = async (): Promise<void> => {
    try {
      // /system/scheduler/remove takes a `numbers=` selector (id or unique
      // name) — a `?query` filter is rejected with "missing =.id=" and
      // silently removes nothing, leaving the entry to fire later even
      // after confirm().
      const rmOpts = buildOpts(
        {
          attributes: { numbers: schedulerName },
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
      await applyRevertPatch(transport, revertPatch, signal, timeoutMs);
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
