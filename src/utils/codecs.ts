/**
 * Value codecs for RouterOS string fields.
 *
 * RouterOS represents all values as strings over both the binary API and REST.
 * These codecs parse raw string values to typed primitives and serialize them back.
 *
 * Both API transports normalise booleans differently:
 * - Binary API: `"yes"` / `"no"`
 * - REST API:   `"true"` / `"false"`
 *
 * All parse functions accept both forms.
 */

// ─── Boolean ─────────────────────────────────────────────────────────────────

/**
 * Parse a RouterOS boolean string to `boolean`.
 * Accepts `"true"`, `"yes"` (→ `true`) and `"false"`, `"no"` (→ `false`).
 * Any other value is treated as `false`.
 */
export function parseBool(s: string): boolean {
  return s === "true" || s === "yes";
}

/** Serialize `boolean` to a RouterOS string (`"true"` / `"false"`). */
export function serializeBool(v: boolean): string {
  return v ? "true" : "false";
}

// ─── Integer ─────────────────────────────────────────────────────────────────

/**
 * Parse a RouterOS decimal integer string to `number`.
 * Returns `NaN` for non-integer input.
 */
export function parseInteger(s: string): number {
  return Number.parseInt(s, 10);
}

/** Serialize a `number` to a RouterOS integer string (truncates decimals). */
export function serializeInteger(v: number): string {
  return String(Math.trunc(v));
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Parse a RouterOS comma-separated list string to `string[]`.
 * Returns an empty array for an empty string.
 */
export function parseList(s: string): string[] {
  return s.length === 0 ? [] : s.split(",");
}

/** Serialize `string[]` to a RouterOS comma-separated list string. */
export function serializeList(v: readonly string[]): string {
  return v.join(",");
}

// ─── Duration ────────────────────────────────────────────────────────────────

/**
 * Parse a RouterOS duration string (e.g. `"1w2d3h4m5s"`) to seconds.
 *
 * Supported units: `w` (weeks), `d` (days), `h` (hours), `m` (minutes), `s` (seconds).
 * Returns `NaN` if the string cannot be fully parsed.
 */
export function parseDuration(s: string): number {
  let total = 0;
  const re = /(\d+)([wdhms])/g;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = re.exec(s)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2];
    consumed += match[0].length;
    switch (unit) {
      case "w":
        total += amount * 604800;
        break;
      case "d":
        total += amount * 86400;
        break;
      case "h":
        total += amount * 3600;
        break;
      case "m":
        total += amount * 60;
        break;
      case "s":
        total += amount;
        break;
    }
  }

  return consumed === s.length ? total : NaN;
}

/**
 * Serialize seconds to a RouterOS duration string (e.g. `3661` → `"1h1m1s"`).
 * Emits `"0s"` for zero.
 */
export function serializeDuration(seconds: number): string {
  const w = Math.floor(seconds / 604800);
  const d = Math.floor((seconds % 604800) / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  let result = "";
  if (w > 0) result += `${w}w`;
  if (d > 0) result += `${d}d`;
  if (h > 0) result += `${h}h`;
  if (m > 0) result += `${m}m`;
  if (s > 0 || result === "") result += `${s}s`;
  return result;
}
