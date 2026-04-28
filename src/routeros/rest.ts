import type { MikrotikErrorContext } from "../errors/index";
import { MikrotikError } from "../errors/index";
import type {
  RouterOSAttributes,
  RouterOSCommandOptions,
  RouterOSCommandResult,
  RouterOSListenOptions,
  RouterOSPrimitive,
  RouterOSRecord,
  RouterOSReply,
  RouterOSStream,
} from "./index";
import type { DeviceTransport } from "./transport";

// ─── Error types ─────────────────────────────────────────────────────────────

/**
 * RouterOS REST API returned a 4xx trap response.
 *
 * @example
 * ```ts
 * try {
 *   await client.execute("/ip/address/add", { attributes: { address: "bad" } });
 * } catch (err) {
 *   if (err instanceof RouterOSRestTrapError) {
 *     console.error(err.detail, err.httpStatus);
 *   }
 * }
 * ```
 */
export class RouterOSRestTrapError extends MikrotikError {
  public readonly code = "trap" as const;
  public readonly retriable = false;
  /** Human-readable detail from the RouterOS error response. */
  public readonly detail: string;
  /** HTTP status code. */
  public readonly httpStatus: number;

  public constructor(
    detail: string,
    httpStatus: number,
    options?: { context?: MikrotikErrorContext }
  ) {
    super(detail, options);
    this.name = "RouterOSRestTrapError";
    this.detail = detail;
    this.httpStatus = httpStatus;
  }
}

/**
 * RouterOS REST API returned a 401 Unauthorized response.
 *
 * @example
 * ```ts
 * try {
 *   await client.print("/ip/address");
 * } catch (err) {
 *   if (err instanceof RouterOSRestAuthError) {
 *     // Check credentials
 *   }
 * }
 * ```
 */
export class RouterOSRestAuthError extends MikrotikError {
  public readonly code = "auth_failed" as const;
  public readonly retriable = false;

  public constructor(options?: { context?: MikrotikErrorContext }) {
    super("RouterOS REST authentication failed: invalid credentials.", options);
    this.name = "RouterOSRestAuthError";
  }
}

/**
 * RouterOS REST API returned a 403 Forbidden response.
 */
export class RouterOSRestPermissionError extends MikrotikError {
  public readonly code = "permission_denied" as const;
  public readonly retriable = false;

  public constructor(detail: string, options?: { context?: MikrotikErrorContext }) {
    super(detail, options);
    this.name = "RouterOSRestPermissionError";
  }
}

/**
 * RouterOS REST API returned a 5xx error or a protocol-level error occurred.
 */
export class RouterOSRestProtocolError extends MikrotikError {
  public readonly code = "protocol_violation" as const;
  public readonly retriable = true;
  /** HTTP status code (0 if the error is not HTTP-level). */
  public readonly httpStatus: number;

  public constructor(
    message: string,
    httpStatus: number,
    options?: { context?: MikrotikErrorContext }
  ) {
    super(message, options);
    this.name = "RouterOSRestProtocolError";
    this.httpStatus = httpStatus;
  }
}

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Options for {@link RouterOSRestClient}.
 *
 * @example
 * ```ts
 * const client = new RouterOSRestClient({
 *   baseUrl: "https://192.168.1.1",
 *   username: "admin",
 *   password: "secret",
 *   timeoutMs: 10_000,
 * });
 * ```
 */
export type RouterOSRestClientOptions = {
  /**
   * Base URL of the RouterOS device.
   * Must include the scheme (`https://` or `http://`). Port is optional.
   * @example "https://192.168.1.1"
   * @example "http://192.168.1.1:80"
   */
  baseUrl: string;
  /** RouterOS username. */
  username?: string;
  /** RouterOS password. */
  password?: string;
  /**
   * Default request timeout in milliseconds.
   * Can be overridden per-call via `RouterOSCommandOptions.timeoutMs`.
   * @default undefined (no timeout)
   */
  timeoutMs?: number;
  /**
   * Default AbortSignal for all requests.
   * Can be combined with per-call signals.
   */
  signal?: AbortSignal;
  /**
   * Custom `fetch` implementation.
   *
   * Use this to inject a fetch with custom TLS options (e.g. self-signed certs):
   * ```ts
   * import { Agent, fetch as undiciFetch } from "undici";
   * const client = new RouterOSRestClient({
   *   baseUrl: "https://192.168.1.1",
   *   fetch: (url, init) =>
   *     undiciFetch(url, {
   *       ...init,
   *       dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
   *     }),
   * });
   * ```
   * @default globalThis.fetch
   */
  fetch?: typeof globalThis.fetch;
};

// ─── Internal types ───────────────────────────────────────────────────────────

type RouterOSRestErrorBody = {
  detail?: string;
  message?: string;
  error?: number;
};

const CRUD_VERBS = new Set(["add", "set", "remove", "print", "getall"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

function normalizePrimitive(value: RouterOSPrimitive): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (v === null || v === undefined ? "" : String(v))).join(",");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function attributesToBody(attributes?: RouterOSAttributes): Record<string, string> {
  if (!attributes) return {};
  const body: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const normalized = normalizePrimitive(value);
    if (normalized !== undefined) {
      body[key] = normalized;
    }
  }
  return body;
}

function normalizeResponseValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function normalizeRecord(raw: Record<string, unknown>): RouterOSRecord {
  const record: RouterOSRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    record[key] = normalizeResponseValue(value);
  }
  return record;
}

function parseRestBody(body: string): RouterOSRecord[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item) =>
      typeof item === "object" && item !== null
        ? normalizeRecord(item as Record<string, unknown>)
        : {}
    );
  }

  if (typeof parsed === "object" && parsed !== null) {
    return [normalizeRecord(parsed as Record<string, unknown>)];
  }

  return [];
}

/**
 * Convert RouterOS binary API query words to REST URL query parameters.
 *
 * Supports:
 * - `?=key=value` (exact match)
 * - `?key=value` (alternate exact match)
 * - `?~key=pattern` (regex — passed through as `~key=pattern`)
 *
 * Complex query operators (`#&`, `#|`, `#!`) are not supported and are ignored.
 */
function queriesToParams(queries?: readonly string[]): URLSearchParams {
  const params = new URLSearchParams();
  if (!queries) return params;

  for (const query of queries) {
    if (!query.startsWith("?")) continue;

    // Skip logical operators
    if (query.startsWith("?#")) continue;

    const rest = query.slice(1);
    const inner = rest.startsWith("=") ? rest.slice(1) : rest;
    const eqIdx = inner.indexOf("=");
    if (eqIdx === -1) continue;

    const key = inner.slice(0, eqIdx);
    const value = inner.slice(eqIdx + 1);
    params.set(key, value);
  }

  return params;
}

function makeDoneReply(attributes: RouterOSRecord = {}): RouterOSReply {
  return { type: "done", attributes, apiAttributes: {}, raw: [] };
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * RouterOS REST API v7 client.
 *
 * Implements {@link DeviceTransport} so resource helpers work without changes
 * when swapping the transport.
 *
 * Requires RouterOS v7 with the REST API enabled (`/ip/service` → `www-ssl`
 * or `www` with the REST API package).
 *
 * **TLS note:** By default uses `globalThis.fetch`. For self-signed certificates,
 * provide a custom `fetch` with a permissive TLS agent (see `options.fetch`).
 *
 * @example
 * ```ts
 * import { RouterOSRestClient, createRouterOSHelpers } from "@sourceregistry/mikrotik-client/routeros";
 *
 * const client = new RouterOSRestClient({
 *   baseUrl: "https://192.168.1.1",
 *   username: "admin",
 *   password: "secret",
 * });
 *
 * // Use the same typed helpers as with the binary API:
 * const helpers = createRouterOSHelpers(client);
 * const interfaces = await helpers.interface.list();
 * ```
 */
export class RouterOSRestClient implements DeviceTransport {
  private tagCounter = 1;
  private readonly fetchImpl: typeof globalThis.fetch;

  public constructor(public readonly options: RouterOSRestClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  private createTag(): string {
    return `rest-${this.tagCounter++}`;
  }

  private authHeader(): string | undefined {
    const { username, password } = this.options;
    if (!username) return undefined;
    return `Basic ${Buffer.from(`${username}:${password ?? ""}`).toString("base64")}`;
  }

  private buildUrl(restPath: string, params?: URLSearchParams): string {
    const base = this.options.baseUrl.replace(/\/$/, "");
    const url = `${base}/rest/${restPath}`;
    const qs = params?.toString();
    return qs ? `${url}?${qs}` : url;
  }

  private buildSignal(options?: RouterOSCommandOptions): AbortSignal | undefined {
    const timeoutMs = options?.timeoutMs ?? this.options.timeoutMs;
    const signal = options?.signal ?? this.options.signal;

    if (timeoutMs && timeoutMs > 0) {
      // AbortSignal.timeout and AbortSignal.any are available in Node ≥ 20
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    }
    return signal;
  }

  private async doFetch(
    url: string,
    method: "GET" | "POST",
    body?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    const auth = this.authHeader();
    if (auth) headers["authorization"] = auth;

    return this.fetchImpl(url, {
      method,
      headers,
      ...(signal !== undefined && { signal }),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  private async throwOnError(response: Response, context: MikrotikErrorContext): Promise<never> {
    let detail = `HTTP ${response.status} ${response.statusText}`;
    try {
      const text = await response.text();
      if (text.trim()) {
        const parsed = JSON.parse(text) as RouterOSRestErrorBody;
        detail = parsed.detail ?? parsed.message ?? detail;
      }
    } catch {
      // ignore parse failure — use the default detail
    }

    if (response.status === 401) throw new RouterOSRestAuthError({ context });
    if (response.status === 403) throw new RouterOSRestPermissionError(detail, { context });
    if (response.status >= 400 && response.status < 500) {
      throw new RouterOSRestTrapError(detail, response.status, { context });
    }
    throw new RouterOSRestProtocolError(detail, response.status, { context });
  }

  // ─── DeviceTransport ────────────────────────────────────────────────────────

  /**
   * Execute a RouterOS command via the REST API.
   *
   * Command paths are mapped to REST endpoints:
   *
   * | RouterOS command         | REST endpoint                     | HTTP   |
   * |--------------------------|-----------------------------------|--------|
   * | `/ip/address/print`      | `/rest/ip/address/print`          | POST   |
   * | `/ip/address/getall`     | `/rest/ip/address/print`          | POST   |
   * | `/ip/address/add`        | `/rest/ip/address/add`            | POST   |
   * | `/ip/address/set`        | `/rest/ip/address/set`            | POST   |
   * | `/ip/address/remove`     | `/rest/ip/address/remove`        | POST   |
   * | `/system/reboot`         | `/rest/system/reboot`             | POST   |
   *
   * @example
   * ```ts
   * // Add an IP address
   * await client.execute("/ip/address/add", {
   *   attributes: { address: "192.168.1.10/24", interface: "ether1" },
   * });
   *
   * // Reboot the device
   * await client.execute("/system/reboot");
   * ```
   */
  async execute(
    command: string,
    options: RouterOSCommandOptions = {}
  ): Promise<RouterOSCommandResult> {
    const normalized = normalizePath(command);
    const segments = normalized.split("/");
    const lastSegment = segments[segments.length - 1] ?? "";
    const tag = options.tag ?? this.createTag();
    const context: MikrotikErrorContext = { command, tag, host: this.options.baseUrl };
    const signal = this.buildSignal(options);

    let restPath: string;
    let body: Record<string, string>;

    if (lastSegment === "print" || lastSegment === "getall") {
      // Map getall → print; both use POST /rest/<path>/print
      const base = segments.slice(0, -1).join("/");
      restPath = `${base}/print`;
      body = attributesToBody(options.attributes);
    } else if (CRUD_VERBS.has(lastSegment)) {
      // add / set / remove — POST to the same path
      restPath = normalized;
      body = attributesToBody(options.attributes);
    } else {
      // Generic command (e.g. /system/reboot) — POST to full path
      restPath = normalized;
      body = attributesToBody(options.attributes);
    }

    const url = this.buildUrl(restPath);
    const response = await this.doFetch(url, "POST", body, signal);

    if (!response.ok) {
      await this.throwOnError(response, context);
    }

    const responseText = await response.text();
    const records = parseRestBody(responseText);

    return {
      tag,
      records,
      done: makeDoneReply(records[0]),
      traps: [],
    };
  }

  /**
   * Execute a RouterOS print command and return records.
   *
   * Uses `GET /rest/<path>` for simple queries, falling back to
   * `POST /rest/<path>/print` when filters or a proplist are specified.
   *
   * @example
   * ```ts
   * // List all IP addresses
   * const addresses = await client.print("/ip/address");
   *
   * // Print with proplist
   * const names = await client.print("/interface", {
   *   attributes: { ".proplist": "name,type,disabled" },
   * });
   * ```
   */
  async print(command: string, options: RouterOSCommandOptions = {}): Promise<RouterOSRecord[]> {
    const normalized = normalizePath(command);
    // Strip /print suffix if already present (RouterOSClient.print appends it)
    const basePath = normalized.endsWith("/print")
      ? normalized.slice(0, -"/print".length)
      : normalized;

    const tag = options.tag ?? this.createTag();
    const context: MikrotikErrorContext = { command, tag, host: this.options.baseUrl };
    const signal = this.buildSignal(options);

    const queryParams = queriesToParams(options.queries);

    const proplistAttr = options.attributes?.[".proplist"];
    if (proplistAttr !== undefined) {
      const proplistValue = normalizePrimitive(proplistAttr);
      if (proplistValue) queryParams.set(".proplist", proplistValue);
    }

    // Non-.proplist attributes: use POST /print with body
    const nonProplistAttrs: RouterOSAttributes = {};
    for (const [key, value] of Object.entries(options.attributes ?? {})) {
      if (key !== ".proplist") nonProplistAttrs[key] = value;
    }
    const hasBodyFilters =
      Object.keys(nonProplistAttrs).length > 0 || (options.queries && options.queries.length > 0);

    let url: string;
    let method: "GET" | "POST";
    let body: Record<string, string> | undefined;

    if (hasBodyFilters) {
      url = this.buildUrl(`${basePath}/print`, queryParams.size > 0 ? queryParams : undefined);
      method = "POST";
      body = {
        ...attributesToBody(nonProplistAttrs),
        ...Object.fromEntries(queriesToParams(options.queries)),
      };
    } else {
      url = this.buildUrl(basePath, queryParams.size > 0 ? queryParams : undefined);
      method = "GET";
    }

    const response = await this.doFetch(url, method, body, signal);

    if (!response.ok) {
      await this.throwOnError(response, context);
    }

    return parseRestBody(await response.text());
  }

  /**
   * Streaming is not supported by the RouterOS REST API.
   *
   * This method always rejects with {@link RouterOSRestProtocolError}.
   * Use {@link RouterOSClient} (binary API) for listen/streaming commands.
   */
  async listen(_command: string, _options?: RouterOSListenOptions): Promise<RouterOSStream> {
    throw new RouterOSRestProtocolError(
      "RouterOS REST API does not support streaming. Use RouterOSClient (binary API) for listen commands.",
      0,
      { context: { host: this.options.baseUrl } }
    );
  }
}
