import type { DeviceTransport } from '../routeros/transport';
import type { RouterOSCommandOptions } from '../routeros/index';

/**
 * Build RouterOSCommandOptions with conditional inclusion of optional fields.
 * Required due to `exactOptionalPropertyTypes: true`.
 */
function buildOpts(
    base: Omit<RouterOSCommandOptions, 'signal' | 'timeoutMs'>,
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined
): RouterOSCommandOptions {
    const opts: RouterOSCommandOptions = { ...base };
    if (signal !== undefined) opts.signal = signal;
    if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
    return opts;
}

/**
 * Options for backup operations.
 */
export type BackupOptions = {
    /** Abort signal for cancellation. */
    signal?: AbortSignal;
    /** Timeout per command (ms). */
    timeoutMs?: number;
};

/**
 * Save a script export backup to the device.
 *
 * This creates a portable `.rsc` file via `/export file=<name>`.
 * Unlike binary backups (`/system backup save`), exports are version-portable
 * and don't require a password for import.
 *
 * @example
 * ```ts
 * import { saveBackup } from '@sourceregistry/mikrotik-client/safety';
 *
 * await saveBackup(transport, 'pre-change');
 * // Creates /user-backup/pre-change.rsc on the device
 * ```
 *
 * @param transport - The device transport.
 * @param name - The backup file name (without `.rsc` extension).
 * @param options - Optional signal and timeout.
 */
export async function saveBackup(
    transport: DeviceTransport,
    name: string,
    options: BackupOptions = {}
): Promise<void> {
    const opts = buildOpts(
        { attributes: { file: name } },
        options.signal,
        options.timeoutMs
    );
    await transport.execute('/export', opts);
}

/**
 * Remove a backup file from the device.
 *
 * @example
 * ```ts
 * import { removeBackup } from '@sourceregistry/mikrotik-client/safety';
 *
 * await removeBackup(transport, 'pre-change');
 * // Removes /user-backup/pre-change.rsc
 * ```
 *
 * @param transport - The device transport.
 * @param name - The backup file name (without `.rsc` extension).
 * @param options - Optional signal and timeout.
 */
export async function removeBackup(
    transport: DeviceTransport,
    name: string,
    options: BackupOptions = {}
): Promise<void> {
    const opts = buildOpts(
        { queries: [`name=${name}.rsc`] },
        options.signal,
        options.timeoutMs
    );
    await transport.execute('/file/remove', opts);
}

/**
 * Import a script export file back into the device.
 *
 * This is a **destructive** operation that overwrites the current running
 * configuration with the contents of the export file.
 *
 * **Requires `confirm: true` to prevent accidental use.**
 *
 * @example
 * ```ts
 * import { importExport } from '@sourceregistry/mikrotik-client/safety';
 *
 * await importExport(transport, 'pre-change', { confirm: true });
 * ```
 *
 * @param transport - The device transport.
 * @param fileName - The backup file name (without `.rsc` extension).
 * @param options - Must include `confirm: true`.
 * @throws {Error} If `confirm: true` is not provided.
 */
export async function importExport(
    transport: DeviceTransport,
    fileName: string,
    options: BackupOptions & { confirm: true }
): Promise<void> {
    if (options.confirm !== true) {
        throw new Error(
            'importExport requires confirm: true to prevent accidental configuration overwrite'
        );
    }
    const opts = buildOpts(
        { attributes: { file: `${fileName}.rsc` } },
        options.signal,
        options.timeoutMs
    );
    await transport.execute('/import', opts);
}

/**
 * List backup files on the device matching a name prefix.
 *
 * @example
 * ```ts
 * import { listBackups } from '@sourceregistry/mikrotik-client/safety';
 *
 * const backups = await listBackups(transport, 'pre-');
 * // Returns files like ['pre-a1b2c3d4.rsc', 'pre-e5f6g7h8.rsc']
 * ```
 */
export async function listBackups(
    transport: DeviceTransport,
    prefix?: string,
    options: BackupOptions = {}
): Promise<Record<string, string>[]> {
    const queries = prefix !== undefined ? [`name~^${prefix}`] : [];
    const opts = buildOpts({ queries }, options.signal, options.timeoutMs);
    return transport.print('/file', opts).then((results) =>
        results.filter((r: Record<string, string>) => r.name?.endsWith('.rsc'))
    );
}
