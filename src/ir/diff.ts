import {
    type IRResourceBlock,
    type RouterOSConfig,
    isResourceBlock,
} from './types';

// ─── Diff Types ──────────────────────────────────────────────────────────────

/**
 * A property-level change within an update operation.
 */
export type PropertyChange = {
    /** Property name. */
    name: string;
    /** Previous value (empty string if newly added). */
    oldValue: string;
    /** New value (empty string if removed). */
    newValue: string;
};

/**
 * A single resource-level mutation in the patch.
 */
export type PatchOperation = {
    /** The resource block (for create/update) or the original block (for delete). */
    block: IRResourceBlock;
};

/**
 * An update operation with field-level property changes.
 */
export type PatchUpdate = PatchOperation & {
    /** Same as {@link PatchOperation.op}. */
    op: 'update';
    /** Per-property old→new changes. */
    changes: PropertyChange[];
};

/**
 * The kind of patch operation.
 */
export type PatchOp = 'create' | 'update' | 'delete';

/**
 * All patch operation types.
 */
export type PatchItem =
    | (PatchOperation & { op: 'create' })
    | PatchUpdate
    | (PatchOperation & { op: 'delete' });

/**
 * Structured patch produced by {@link diff}.
 *
 * Describes the minimum set of changes to transform `current`
 * into `desired`. Ready for consumption by `applyPatch()`.
 */
export type Patch = {
    /** New resources to create. */
    create: Array<PatchOperation & { op: 'create' }>;
    /** Existing resources to update with field-level changes. */
    update: Array<PatchUpdate>;
    /** Existing resources to delete. */
    delete: Array<PatchOperation & { op: 'delete' }>;
};

/**
 * Result of applying a patch (returned by `applyPatch`).
 */
export type ApplyResult = {
    /** Successfully applied operations. */
    applied: number;
    /** Operations that were skipped (no-op). */
    skipped: number;
    /** Operations that failed. */
    failed: Array<{ op: PatchItem; error: string }>;
};

// ─── Matching ────────────────────────────────────────────────────────────────

/**
 * Stable identifier property names that RouterOS resources use
 * for lookup in `set [find ...]` patterns.
 */
const STABLE_ID_PROPERTIES = ['default-name', 'name', 'comment'] as const;

/**
 * Get a canonical key for matching resource blocks.
 * Uses stable identifiers (name, comment, default-name) when available.
 */
function getResourceKey(block: IRResourceBlock): string {
    const path = block.path;

    // For 'set' commands with findQuery, build key from find properties
    if (block.command === 'set' && block.findQuery && block.findQuery.length > 0) {
        const queryKey = block.findQuery
            .map((p) => `${p.name}=${p.value}`)
            .sort()
            .join('&');
        return `${path}:find:${queryKey}`;
    }

    // Build key from stable identifier properties
    // Lookup order for different resource types
    const idNames = getResourceIdPropertyNames(block.path);
    for (const idName of idNames) {
        const prop = block.properties.find((p) => p.name === idName);
        if (prop && prop.value) {
            return `${path}:${idName}=${prop.value}`;
        }
    }

    // Fall back to path
    return path;
}

/**
 * Get the primary identifier property name for a resource path.
 */
function getResourceIdPropertyNames(path: string): readonly string[] {
    if (path.includes('bridge port')) {
        return ['interface', 'bridge'] as const;
    }
    if (path.includes('bridge vlan')) {
        return ['vlan-ids', 'bridge'] as const;
    }
    if (path.includes('address')) {
        return ['address', 'interface'] as const;
    }
    if (path.includes('route')) {
        return ['dst-address', 'gateway'] as const;
    }
    if (path.includes('firewall filter') || path.includes('firewall nat') || path.includes('firewall mangle')) {
        return ['chain', 'action', 'comment'] as const;
    }
    if (path.includes('dhcp')) {
        return ['address', 'mac-address'] as const;
    }
    if (path.includes('bgp')) {
        return ['name'] as const;
    }
    // Default: name-based
    return STABLE_ID_PROPERTIES;
}

// ─── Build Resource Index ─────────────────────────────────────────────────────

type ResourceIndex = Map<string, IRResourceBlock[]>;

function buildResourceIndex(config: RouterOSConfig): ResourceIndex {
    const index = new Map<string, IRResourceBlock[]>();

    for (const item of config.items) {
        if (isResourceBlock(item)) {
            const key = getResourceKey(item);
            const existing = index.get(key) ?? [];
            existing.push(item);
            index.set(key, existing);
        }
    }

    return index;
}

// ─── Property Diff ────────────────────────────────────────────────────────────

/**
 * Compute property-level changes between two resource blocks.
 */
function diffProperties(oldBlock: IRResourceBlock, newBlock: IRResourceBlock): PropertyChange[] {
    const changes: PropertyChange[] = [];

    // Index properties by name for easy lookup
    const oldProps = new Map(oldBlock.properties.map((p) => [p.name, p.value]));
    const newProps = new Map(newBlock.properties.map((p) => [p.name, p.value]));

    // Check for added or changed properties
    for (const [name, newValue] of newProps) {
        const oldValue = oldProps.get(name);
        if (oldValue === undefined) {
            changes.push({ name, oldValue: '', newValue });
        } else if (oldValue !== newValue) {
            changes.push({ name, oldValue, newValue });
        }
    }

    // Check for removed properties
    for (const [name, oldValue] of oldProps) {
        if (!newProps.has(name)) {
            changes.push({ name, oldValue, newValue: '' });
        }
    }

    return changes;
}

// ─── Patch Apply (transport-agnostic) ─────────────────────────────────────────

import type { DeviceTransport } from '../routeros/index';

/**
 * Options for {@link applyPatch}.
 */
export type ApplyPatchOptions = {
    /**
     * Skip commit-confirm wrapper and apply changes directly.
     * @default false
     */
    unsafeDirectApply?: boolean;

    /** Abort signal for cancellation. */
    signal?: AbortSignal;

    /** Default timeout for each command (ms). */
    timeoutMs?: number;
};

// ─── Convert Block For Operation ──────────────────────────────────────────────

/**
 * Convert an IRResourceBlock to attributes suitable for a RouterOS 'set' command.
 */
function convertToSetAttributes(block: IRResourceBlock): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const prop of block.properties) {
        attrs[prop.name] = prop.value;
    }
    return attrs;
}

/**
 * Convert an IRResourceBlock to RouterOS query strings (for `find`).
 */
function convertToFindStrings(block: IRResourceBlock): string[] {
    if (block.findQuery && block.findQuery.length > 0) {
        return block.findQuery.map((p) => `${p.name}=${p.value}`);
    }

    // Use stable properties
    const idNames = getResourceIdPropertyNames(block.path);
    const queries: string[] = [];
    for (const name of idNames) {
        const prop = block.properties.find((p) => p.name === name);
        if (prop && prop.value) {
            queries.push(`${name}=${prop.value}`);
        }
    }
    return queries;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a structured {@link Patch} between two RouterOS configurations.
 *
 * Produces `create[]`, `update[]` (with field-level old→new),
 * and `delete[]` arrays that describe the minimum changes to transform
 * `current` into `desired`.
 *
 * @param current - The current (live) configuration.
 * @param desired - The desired (target) configuration.
 * @returns A structured patch describing the changes.
 *
 * @example
 * ```ts
 * import { parseExport, diff } from '@sourceregistry/mikrotik-client/ir';
 *
 * const current = parseExport(currentExportText);
 * const desired = parseExport(desiredExportText);
 * const patch = diff(current, desired);
 * ```
 */
export function diff(current: RouterOSConfig, desired: RouterOSConfig): Patch {
    const currentIndex = buildResourceIndex(current);
    const desiredIndex = buildResourceIndex(desired);

    const result: Patch = { create: [], update: [], delete: [] };

    // Find creates and updates
    for (const [key, desiredBlocks] of desiredIndex) {
        const currentBlocks = currentIndex.get(key) ?? [];

        for (const db of desiredBlocks) {
            // Try to find a matching current block
            const matching = currentBlocks.find((cb) => getResourceKey(cb) === key);

            if (!matching) {
                result.create.push({ op: 'create', block: db });
            } else {
                // Check for property changes
                const changes = diffProperties(matching, db);
                if (changes.length > 0) {
                    result.update.push({ op: 'update', block: db, changes });
                }
                // Remove from currentBlocks so we can detect deletions
                // (simple approach: mark as matched)
                const idx = currentBlocks.indexOf(matching);
                if (idx >= 0) currentBlocks.splice(idx, 1);
            }
        }
    }

    // Find deletions (remaining unmatched current blocks)
    for (const [key, currentBlocks] of currentIndex) {
        // Only count as delete if this key is NOT in desired
        if (!desiredIndex.has(key)) {
            for (const cb of currentBlocks) {
                result.delete.push({ op: 'delete', block: cb });
            }
        }
    }

    return result;
}

/**
 * Check if a {@link Patch} has no changes (is empty).
 *
 * @param patch - The patch to check.
 * @returns `true` if the patch has no operations.
 */
export function isPatchEmpty(patch: Patch): boolean {
    return patch.create.length === 0 && patch.update.length === 0 && patch.delete.length === 0;
}

/**
 * Count total operations in a patch.
 */
export function patchSize(patch: Patch): number {
    return patch.create.length + patch.update.length + patch.delete.length;
}

/**
 * Apply a {@link Patch} to a RouterOS device via {@link DeviceTransport}.
 *
 * Converts patch operations to RouterOS commands and executes them.
 *
 * @param transport - The device transport (API or REST client).
 * @param patch - The patch to apply.
 * @param options - Apply options.
 * @returns The result of the apply operation.
 *
 * @example
 * ```ts
 * import { diff, applyPatch } from '@sourceregistry/mikrotik-client/ir';
 *
 * const patch = diff(current, desired);
 * const result = await applyPatch(transport, patch);
 * ```
 */
export async function applyPatch(
    transport: DeviceTransport,
    patch: Patch,
    options?: ApplyPatchOptions
): Promise<ApplyResult> {
    const { timeoutMs = 30000, signal } = options ?? {};
    const result: ApplyResult = { applied: 0, skipped: 0, failed: [] };

    // ─── Create ──────────────────────────────────────────────────────────────
    for (const op of patch.create) {
        if (signal?.aborted) {
            result.failed.push({
                op,
                error: 'Aborted',
            });
            continue;
        }

        try {
            const command = `${op.block.path}/add`;
            const attrs = convertToSetAttributes(op.block);
            const cmdOpts: Record<string, unknown> = { attributes: attrs, timeoutMs };
            if (signal !== undefined) cmdOpts.signal = signal;
            await transport.execute(command, cmdOpts as Parameters<typeof transport.execute>[1]);
            result.applied++;
        } catch (err) {
            result.failed.push({
                op,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // ─── Update ──────────────────────────────────────────────────────────────
    for (const op of patch.update) {
        if (signal?.aborted) {
            result.failed.push({
                op,
                error: 'Aborted',
            });
            continue;
        }

        try {
            const findQueries = convertToFindStrings(op.block);
            const attrs = convertToSetAttributes(op.block);

            // Build attributes excluding find properties (those are used for selection)
            const findPropNames = new Set(
                (op.block.findQuery ?? []).map((p) => p.name)
            );
            const setAttrs: Record<string, string> = {};
            for (const [name, value] of Object.entries(attrs)) {
                if (!findPropNames.has(name)) {
                    setAttrs[name] = value;
                }
            }

            const cmdOpts: Record<string, unknown> = { attributes: setAttrs, queries: findQueries, timeoutMs };
            if (signal !== undefined) cmdOpts.signal = signal;
            await transport.execute(`${op.block.path}/set`, cmdOpts as Parameters<typeof transport.execute>[1]);
            result.applied++;
        } catch (err) {
            result.failed.push({
                op,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // ─── Delete ──────────────────────────────────────────────────────────────
    for (const op of patch.delete) {
        if (signal?.aborted) {
            result.failed.push({
                op,
                error: 'Aborted',
            });
            continue;
        }

        try {
            const findQueries = convertToFindStrings(op.block);
            const cmdOpts: Record<string, unknown> = { queries: findQueries, timeoutMs };
            if (signal !== undefined) cmdOpts.signal = signal;
            await transport.execute(`${op.block.path}/remove`, cmdOpts as Parameters<typeof transport.execute>[1]);

            result.applied++;
        } catch (err) {
            result.failed.push({
                op,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return result;
}
