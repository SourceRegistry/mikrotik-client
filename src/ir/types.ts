/**
 * Intermediate Representation (IR) types for RouterOS `/export` configurations.
 *
 * The IR is a typed TypeScript tree that is bidirectional with RouterOS script text.
 * It preserves comments, ordering, and supports both v6 and v7 export syntax.
 *
 * @example
 * ```ts
 * const config: RouterOSConfig = {
 *   identity: 'router1',
 *   items: [
 *     { kind: 'resource', path: '/interface ethernet', command: 'set', properties: [{ name: 'name', value: 'ether1' }] },
 *   ],
 * };
 * ```
 */

// ─── Resource Block Commands ──────────────────────────────────────────────────

/**
 * Valid command verbs in a RouterOS resource block.
 */
export type IRResourceCommand =
  | "add"
  | "set"
  | "remove"
  | "print"
  | "disable"
  | "enable"
  | "reset-counters"
  | "update"
  | "register"
  | "unregister";

/**
 * All resource command values for iteration.
 */
export const IR_RESOURCE_COMMANDS: readonly IRResourceCommand[] = [
  "add",
  "set",
  "remove",
  "print",
  "disable",
  "enable",
  "reset-counters",
  "update",
  "register",
  "unregister",
] as const;

// ─── IR Nodes ─────────────────────────────────────────────────────────────────

/**
 * A single property (key-value pair) on a resource.
 *
 * RouterOS stores all values as strings. The IR preserves this contract.
 */
export type IRProperty = {
  /** Property name (e.g., `"name"`, `"disabled"`, `"vlan-ids"`). */
  name: string;
  /** Property value (stored as string, matching RouterOS conventions). */
  value: string;
};

/**
 * A comment node preserved from the original export.
 */
export type IRComment = {
  kind: "comment";
  /** Comment text without the leading `#` or `//`. */
  text: string;
};

/**
 * A resource block from the `/export` output.
 *
 * Examples:
 * - `/interface ethernet set [find default-name=ether1] disabled=no`
 * - `/ip address add address=192.168.1.1/24 interface=bridge1`
 * - `/ip firewall filter remove [find comment="old rule"]`
 */
export type IRResourceBlock = {
  kind: "resource";
  /** Full resource path (e.g., `"/interface ethernet"`, `"/ip address"`). */
  path: string;
  /** Command verb (e.g., `"add"`, `"set"`, `"remove"`). */
  command: IRResourceCommand;
  /** Properties on this resource entry. */
  properties: IRProperty[];
  /** Query properties used in `set [find ...]` patterns. Only present when `command === 'set'` and a find query exists. */
  findQuery?: IRProperty[];
};

/**
 * An environment variable set command (`/env set ...`).
 */
export type IREnvSet = {
  kind: "env";
  /** Variable name. */
  name: string;
  /** Variable value. */
  value: string;
};

/**
 * A system command passthrough (e.g., `:delay`, `:put`, `:error`, `:global`).
 * These are preserved as-is for round-trip fidelity.
 */
export type IRSystemCommand = {
  kind: "system";
  /** The raw command text (e.g., `":delay 3s"`, `":put done"`). */
  command: string;
};

/**
 * Block grouping syntax `{ ... }` — used by some RouterOS commands.
 * Preserved as a sequence of child items.
 */
export type IRBlock = {
  kind: "block";
  /** Items inside the `{ }` block. */
  items: IRItem[];
};

// ─── Union Types ──────────────────────────────────────────────────────────────

/**
 * Any top-level item in the IR.
 * Use discriminated `kind` field to narrow.
 */
export type IRItem = IRComment | IRResourceBlock | IREnvSet | IRSystemCommand | IRBlock;

/**
 * The kind discriminator for {@link IRItem}.
 */
export type IRItemKind = IRItem["kind"];

/** All IR item kinds for iteration. */
export const IR_ITEM_KINDS: readonly IRItemKind[] = [
  "comment",
  "resource",
  "env",
  "system",
  "block",
] as const;

// ─── RouterOSConfig (Root IR) ─────────────────────────────────────────────────

/**
 * The top-level IR type representing a complete RouterOS configuration.
 *
 * @example
 * ```ts
 * const config: RouterOSConfig = {
 *   identity: 'office-router',
 *   items: [
 *     { kind: 'comment', text: '====以太网接口====' },
 *     { kind: 'resource', path: '/interface ethernet', command: 'set', properties: [...] },
 *   ],
 * };
 * ```
 */
export type RouterOSConfig = {
  /** Device identity (from `/system identity`). */
  identity?: string;
  /** Top-level items in configuration order. */
  items: IRItem[];
  /**
   * Optional ordering hints for rendering.
   * Maps resource path prefix → sort priority (lower = earlier).
   * Defaults are applied in `renderScript()` if omitted.
   */
  orderHints?: Record<string, number>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create an empty {@link RouterOSConfig}.
 *
 * @example
 * ```ts
 * const config = createEmptyConfig();
 * ```
 */
export function createEmptyConfig(): RouterOSConfig {
  return { items: [] };
}

/**
 * Narrow an {@link IRItem} to {@link IRResourceBlock}.
 * Returns `true` if the item is a resource block.
 */
export function isResourceBlock(item: IRItem): item is IRResourceBlock {
  return item.kind === "resource";
}

/**
 * Narrow an {@link IRItem} to {@link IRComment}.
 */
export function isComment(item: IRItem): item is IRComment {
  return item.kind === "comment";
}

/**
 * Narrow an {@link IRItem} to {@link IREnvSet}.
 */
export function isEnvSet(item: IRItem): item is IREnvSet {
  return item.kind === "env";
}

/**
 * Narrow an {@link IRItem} to {@link IRSystemCommand}.
 */
export function isSystemCommand(item: IRItem): item is IRSystemCommand {
  return item.kind === "system";
}

/**
 * Narrow an {@link IRItem} to {@link IRBlock}.
 */
export function isBlock(item: IRItem): item is IRBlock {
  return item.kind === "block";
}
