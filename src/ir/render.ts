import {
  type IRItem,
  type IRResourceBlock,
  type RouterOSConfig,
  isComment,
  isResourceBlock,
  isEnvSet,
  isSystemCommand,
  isBlock,
} from "./types";

// ─── Render Options ───────────────────────────────────────────────────────────

/**
 * Options for {@link renderScript}.
 */
export type RenderScriptOptions = {
  /**
   * Use compact output (no comments, minimal whitespace).
   * @default false
   */
  compact?: boolean;

  /**
   * Include sensitive data (passwords, keys).
   * @default false
   */
  showSensitive?: boolean;

  /**
   * Use terse property names (RouterOS shorthand).
   * @default false
   */
  terse?: boolean;

  /**
   * Sort items by dependency order (bridges before ports, interfaces before IPs, etc.).
   * @default true
   */
  sortByDependency?: boolean;
};

// ─── Dependency Order ─────────────────────────────────────────────────────────

/**
 * Dependency ordering priorities for resource paths.
 * Lower number = rendered earlier.
 */
const DEFAULT_ORDER_HINTS: Record<string, number> = {
  "/system identity": 0,
  "/system clock": 1,
  "/system timezone": 2,
  "/env": 10,
  "/user": 20,
  "/interface bridge": 30,
  "/interface bonding": 35,
  "/interface vlan": 38,
  "/interface ethernet": 40,
  "/interface wireless": 40,
  "/interface wifi": 40,
  "/interface vrrp": 40,
  "/interface ovpn": 40,
  "/interface wireguard": 40,
  "/interface pptp": 40,
  "/interface pptp-client": 40,
  "/interface/ppp": 40,
  "/interface lte": 40,
  "/interface simple": 40,
  "/interface sip": 40,
  "/interface socket": 40,
  "/interface ssh": 40,
  "/interface watchdog": 40,
  "/interface slave": 40,
  "/interface6 wireguard": 40,
  "/interface bridge port": 50,
  "/interface bridge vlan": 55,
  "/interface bridge port-isolation": 55,
  "/interface bridge fasttalk": 55,
  "/interface bridge pvid-autoconfig": 55,
  "/queue": 60,
  "/routing": 60,
  "/caps-man": 65,
  "/ip dhcp-client": 70,
  "/ip dhcp-server": 72,
  "/ip pool": 72,
  "/ip address": 80,
  "/ip dns": 82,
  "/ip dns static": 82,
  "/ip firewall": 85,
  "/ip firewall address-list": 85,
  "/ip firewall banner": 85,
  "/ip firewall connection": 85,
  "/ip firewall mangle": 86,
  "/ip firewall nat": 86,
  "/ip firewall raw": 87,
  "/ip firewall proxy-arp": 85,
  "/ip firewall settings": 85,
  "/ip route": 90,
  "/ipsec": 92,
  "/ipv6": 100,
  "/wireless": 110,
  "/certificate": 200,
  "/tool": 250,
  "/snmp": 300,
  "/rmon": 300,
  "/aaa": 300,
  "/alarm": 300,
  "/system scheduler": 900,
  "/system footprint-exclude": 950,
  "/system backup": 950,
  "/system logging": 950,
};

/**
 * Get the sort priority for a resource path.
 * Uses default hints or custom hints from the config.
 */
function getOrderHint(path: string, orderHints: Record<string, number> | undefined): number {
  // Check custom hints first
  if (orderHints) {
    for (const [key, priority] of Object.entries(orderHints)) {
      if (path.startsWith(key)) {
        return priority;
      }
    }
  }

  // Fall back to default hints
  for (const [key, priority] of Object.entries(DEFAULT_ORDER_HINTS)) {
    if (path.startsWith(key)) {
      return priority;
    }
  }

  return 500; // Default middle priority
}

// ─── Value Quoting ────────────────────────────────────────────────────────────

/**
 * Determine if a value needs quoting in RouterOS script output.
 * Values need quotes if they contain spaces, special chars, or are empty.
 */
function needsQuoting(value: string): boolean {
  if (value === "") return true;
  // Need quoting if contains spaces, quotes, or special characters
  return /[\s"'#${}[\]]/.test(value);
}

/**
 * Quote a value for RouterOS script output.
 */
function quoteValue(value: string): string {
  if (!needsQuoting(value)) return value;
  // Escape internal quotes
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ─── Render Resource Block ────────────────────────────────────────────────────

/**
 * Render a single resource block to script text.
 */
function renderResourceBlock(block: IRResourceBlock, _opts: RenderScriptOptions): string {
  const parts: string[] = [block.path, block.command];

  // Render find query if present
  if (block.findQuery && block.findQuery.length > 0) {
    const findProps = block.findQuery.map((p) => `${p.name}=${quoteValue(p.value)}`).join(" ");
    parts.push(`[find ${findProps}]`);
  }

  // Render properties
  for (const prop of block.properties) {
    const value = needsQuoting(prop.value) ? quoteValue(prop.value) : prop.value;
    parts.push(`${prop.name}=${value}`);
  }

  return parts.join(" ");
}

// ─── Render Items ─────────────────────────────────────────────────────────────

function renderItem(item: IRItem, opts: RenderScriptOptions): string {
  if (isComment(item)) {
    if (opts.compact && item.text === "") return "";
    if (item.text === "") return "";
    return `# ${item.text}`;
  }

  if (isResourceBlock(item)) {
    return renderResourceBlock(item, opts);
  }

  if (isEnvSet(item)) {
    const value = needsQuoting(item.value) ? quoteValue(item.value) : item.value;
    return `/env set ${item.name}=${value}`;
  }

  if (isSystemCommand(item)) {
    return item.command;
  }

  if (isBlock(item)) {
    const rendered = item.items
      .map((child) => renderItem(child, opts))
      .filter((line) => line !== "")
      .join("\n");
    return `{ ${rendered} }`;
  }

  return "";
}

// ─── Filter Items ─────────────────────────────────────────────────────────────

function filterItems(items: IRItem[], opts: RenderScriptOptions): IRItem[] {
  if (opts.compact) {
    return items.filter((item) => !isComment(item));
  }
  return items;
}

// ─── Sort Items ───────────────────────────────────────────────────────────────

function sortItems(items: IRItem[], config: RouterOSConfig): IRItem[] {
  // Separate comments (keep in place) from resource blocks (sort by dependency)
  const result: IRItem[] = [];

  // Collect sortable items (resource blocks, env sets)
  const sortable: Array<{ index: number; item: IRItem }> = [];
  let commentIndex = 0;

  for (const item of items) {
    if (isComment(item)) {
      result.push(item);
      commentIndex++;
    } else {
      sortable.push({ index: commentIndex, item });
    }
  }

  // Sort by dependency order
  sortable.sort((a, b) => {
    let aPath = "";
    let bPath = "";

    if (isResourceBlock(a.item)) {
      aPath = a.item.path;
    } else if (isEnvSet(a.item)) {
      aPath = "/env";
    }

    if (isResourceBlock(b.item)) {
      bPath = b.item.path;
    } else if (isEnvSet(b.item)) {
      bPath = "/env";
    }

    return getOrderHint(aPath, config.orderHints) - getOrderHint(bPath, config.orderHints);
  });

  // Interleave sorted items with comments
  for (const { item } of sortable) {
    result.push(item);
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a {@link RouterOSConfig} IR back to a RouterOS script.
 *
 * The output is deterministic and uses dependency-aware ordering so that
 * bridges are rendered before bridge ports, interfaces before IP addresses,
 * etc. Uses `set [find ...]` for updates when a stable identifier exists.
 *
 * @param config - The IR configuration to render.
 * @param options - Rendering options.
 * @returns A RouterOS script string.
 *
 * @example
 * ```ts
 * import { renderScript } from '@sourceregistry/mikrotik-client/ir';
 *
 * const script = renderScript(config, { compact: true });
 * console.log(script);
 * ```
 */
export function renderScript(config: RouterOSConfig, options?: RenderScriptOptions): string {
  const opts = options ?? {};
  const { sortByDependency = true } = opts;

  let items = filterItems(config.items, opts);

  if (sortByDependency) {
    items = sortItems(items, config);
  }

  const lines = items.map((item) => renderItem(item, opts)).filter((line) => line !== "");

  if (lines.length === 0) return "";
  return lines.join("\n") + "\n";
}

/**
 * Render a minimal script with only the identity (if set).
 *
 * @param identity - The device identity name.
 * @returns A script line like `/system identity set name=router1`.
 */
export function renderIdentity(identity: string): string {
  const value = needsQuoting(identity) ? quoteValue(identity) : identity;
  return `/system identity set name=${value}`;
}
