import { createHash, randomBytes } from "node:crypto";

export type SwitchOSWireScalar = string | number | boolean | null;
export type SwitchOSWireValue =
  | SwitchOSWireScalar
  | SwitchOSWireValue[]
  | { [key: string]: SwitchOSWireValue };
export type SwitchOSActionBody = "*";
export type SwitchOSRequestBody =
  | SwitchOSWireValue
  | SwitchOSActionBody
  | FormData
  | URLSearchParams
  | ArrayBuffer
  | ArrayBufferView
  | Blob;

export type SwitchOSEncodingSchema = {
  kind: string;
  response: string;
  request: string;
};

export type SwitchOSControlSchema = {
  label: string | null;
  id: string | null;
  ui_type: string;
  read_only: boolean;
  repeat_count: number | string[] | null;
  encoding: SwitchOSEncodingSchema;
  options: string[] | null;
  scale: number | null;
  min: number | null;
  max: number | null;
  base: number;
  delimiter: string | null;
  defaults: Record<string, unknown>;
  children: SwitchOSControlSchema[];
  wire_keys: string[];
};

export type SwitchOSSectionSchema = {
  tab_id: string;
  tab_title: string;
  title: string;
  url: string;
  shape: "object" | "array";
  list: boolean;
  read_only: boolean;
  refresh_ms: number | null;
  controls: SwitchOSControlSchema[];
};

export type SwitchOSEndpointSchema = {
  url: string;
  shape: "object" | "array";
  sections: SwitchOSSectionSchema[];
};

export type SwitchOSApiSchema = {
  source: string;
  model_context?: Record<string, unknown>;
  protocol?: Record<string, unknown>;
  endpoints: Record<string, SwitchOSEndpointSchema>;
};

export type SwitchOSFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type SwitchOSRequestOptions = {
  method?: "GET" | "POST";
  body?: SwitchOSRequestBody;
  headers?: HeadersInit;
  signal?: AbortSignal;
  parse?: boolean;
};

export type SwitchOSClientOptions = {
  baseUrl: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  fetch?: SwitchOSFetch;
  schema?: SwitchOSApiSchema;
};

type DigestChallenge = {
  realm: string;
  nonce: string;
  opaque?: string;
  algorithm: string;
  qop?: string;
  stale?: boolean;
};

type NormalizedRequest = {
  url: URL;
  path: string;
  init: RequestInit;
  headers: Headers;
};

class SwitchOSLiteralParser {
  private index = 0;

  public constructor(private readonly source: string) {}

  public parse(): SwitchOSWireValue {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error(`Unexpected trailing content at index ${this.index}`);
    }
    return value;
  }

  private parseValue(): SwitchOSWireValue {
    this.skipWhitespace();
    const char = this.peek();

    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    if (char === "'") return this.parseString();
    if (char === "-" || this.isDigit(char)) return this.parseNumber();

    const identifier = this.parseIdentifier();
    if (identifier === "true") return true;
    if (identifier === "false") return false;
    if (identifier === "null") return null;
    throw new Error(`Unsupported token '${identifier}' at index ${this.index}`);
  }

  private parseObject(): { [key: string]: SwitchOSWireValue } {
    this.expect("{");
    const result: { [key: string]: SwitchOSWireValue } = {};
    this.skipWhitespace();
    if (this.peek() === "}") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      const key = this.parseKey();
      this.skipWhitespace();
      this.expect(":");
      result[key] = this.parseValue();
      this.skipWhitespace();

      const char = this.peek();
      if (char === "}") {
        this.index += 1;
        return result;
      }
      this.expect(",");
    }

    throw new Error("Unterminated object literal");
  }

  private parseArray(): SwitchOSWireValue[] {
    this.expect("[");
    const result: SwitchOSWireValue[] = [];
    this.skipWhitespace();
    if (this.peek() === "]") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      result.push(this.parseValue());
      this.skipWhitespace();

      const char = this.peek();
      if (char === "]") {
        this.index += 1;
        return result;
      }
      this.expect(",");
    }

    throw new Error("Unterminated array literal");
  }

  private parseKey(): string {
    this.skipWhitespace();
    if (this.peek() === "'") {
      const value = this.parseString();
      if (typeof value !== "string") {
        throw new Error("Invalid string key");
      }
      return value;
    }
    return this.parseIdentifier();
  }

  private parseString(): string {
    this.expect("'");
    let output = "";

    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === "'") {
        return output;
      }
      if (char === "\\") {
        const escaped = this.source[this.index++];
        if (escaped === undefined) {
          throw new Error("Unterminated string escape");
        }
        switch (escaped) {
          case "\\":
          case "'":
          case "\"":
            output += escaped;
            break;
          case "n":
            output += "\n";
            break;
          case "r":
            output += "\r";
            break;
          case "t":
            output += "\t";
            break;
          case "x": {
            const hex = this.source.slice(this.index, this.index + 2);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
              throw new Error(`Invalid hex escape at index ${this.index}`);
            }
            output += String.fromCharCode(parseInt(hex, 16));
            this.index += 2;
            break;
          }
          case "u": {
            const hex = this.source.slice(this.index, this.index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new Error(`Invalid unicode escape at index ${this.index}`);
            }
            output += String.fromCharCode(parseInt(hex, 16));
            this.index += 4;
            break;
          }
          default:
            output += escaped;
            break;
        }
        continue;
      }
      output += char;
    }

    throw new Error("Unterminated string literal");
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.peek() === "-") {
      this.index += 1;
    }

    if (this.source.slice(this.index, this.index + 2).toLowerCase() === "0x") {
      this.index += 2;
      while (/[0-9a-fA-F]/.test(this.peek())) {
        this.index += 1;
      }
      const raw = this.source.slice(start, this.index);
      return Number(raw);
    }

    while (this.isDigit(this.peek())) {
      this.index += 1;
    }

    if (this.peek() === ".") {
      this.index += 1;
      while (this.isDigit(this.peek())) {
        this.index += 1;
      }
    }

    const exponent = this.peek().toLowerCase();
    if (exponent === "e") {
      this.index += 1;
      if (this.peek() === "+" || this.peek() === "-") {
        this.index += 1;
      }
      while (this.isDigit(this.peek())) {
        this.index += 1;
      }
    }

    const raw = this.source.slice(start, this.index);
    return Number(raw);
  }

  private parseIdentifier(): string {
    this.skipWhitespace();
    const start = this.index;
    const first = this.peek();
    if (!/[A-Za-z_$]/.test(first)) {
      throw new Error(`Expected identifier at index ${this.index}`);
    }
    this.index += 1;
    while (/[A-Za-z0-9_$]/.test(this.peek())) {
      this.index += 1;
    }
    return this.source.slice(start, this.index);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.peek())) {
      this.index += 1;
    }
  }

  private expect(expected: string): void {
    if (this.source[this.index] !== expected) {
      throw new Error(`Expected '${expected}' at index ${this.index}`);
    }
    this.index += 1;
  }

  private peek(): string {
    return this.source[this.index] ?? "";
  }

  private isDigit(value: string): boolean {
    return /^[0-9]$/.test(value);
  }
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === null || proto === Object.prototype;
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  return value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function escapeString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function serializeLiteral(value: SwitchOSWireValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return `'${escapeString(value)}'`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("SwitchOS literal serializer does not support non-finite numbers.");
    }
    return Number.isInteger(value) && value >= 0 ? `0x${value.toString(16)}` : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeLiteral(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .map(([key, entry]) => `${key}:${serializeLiteral(entry)}`)
    .join(",")}}`;
}

function parseLiteral(value: string): SwitchOSWireValue {
  return new SwitchOSLiteralParser(value).parse();
}

function parseDigestChallenge(header: string | null): DigestChallenge | undefined {
  if (!header || !header.startsWith("Digest ")) return undefined;
  const params = header.slice(7);
  const matches = params.match(/([a-z0-9_-]+)=("([^"\\]|\\.)*"|[^,]+)/gi) ?? [];
  const values = new Map<string, string>();

  for (const match of matches) {
    const index = match.indexOf("=");
    const key = match.slice(0, index).trim().toLowerCase();
    let raw = match.slice(index + 1).trim();
    if (raw.startsWith("\"") && raw.endsWith("\"")) {
      raw = raw.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    values.set(key, raw);
  }

  const realm = values.get("realm");
  const nonce = values.get("nonce");
  if (!realm || !nonce) return undefined;

  const opaque = values.get("opaque");
  const qop = values.get("qop");

  return {
    realm,
    nonce,
    ...(opaque !== undefined && { opaque }),
    algorithm: values.get("algorithm") ?? "MD5",
    ...(qop !== undefined && { qop }),
    stale: values.get("stale") === "true",
  };
}

function buildDigestAuthorization(
  challenge: DigestChallenge,
  method: string,
  uri: string,
  username: string,
  password: string,
  nonceCount: number
): string {
  const algorithm = challenge.algorithm.toUpperCase();
  if (algorithm !== "MD5") {
    throw new Error(`Unsupported SwOS digest algorithm: ${challenge.algorithm}`);
  }

  const nc = nonceCount.toString(16).padStart(8, "0");
  const cnonce = randomBytes(8).toString("hex");
  const qop = challenge.qop?.split(",").map((item) => item.trim()).find((item) => item === "auth");
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);

  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${challenge.algorithm}`,
  ];

  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`);
  }
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }

  return `Digest ${parts.join(", ")}`;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  if (!timeoutMs || timeoutMs <= 0) {
    return signal;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`SwitchOS request timed out after ${timeoutMs}ms`)), timeoutMs);

  signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      controller.abort(signal.reason);
    },
    { once: true }
  );

  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
    },
    { once: true }
  );

  return controller.signal;
}

export class SwitchOSHttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly body: string;

  public constructor(response: Response, body: string) {
    super(`SwitchOS request failed: ${response.status} ${response.statusText}`);
    this.name = "SwitchOSHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
  }
}

export function decodeSwitchOSLiteral(payload: string): SwitchOSWireValue {
  return parseLiteral(payload);
}

export function encodeSwitchOSLiteral(payload: SwitchOSWireValue): string {
  return serializeLiteral(payload);
}

export function encodeSwitchOSHexString(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

export function decodeSwitchOSHexString(value: string): string {
  return Buffer.from(value, "hex").toString("utf8");
}

export function encodeSwitchOSIpv4(value: string): number {
  const octets = value.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new TypeError(`Invalid IPv4 address: ${value}`);
  }

  // safe: length === 4 and all values are integers 0–255 verified above
  return (
    octets[0]! |
    (octets[1]! << 8) |
    (octets[2]! << 16) |
    (octets[3]! << 24)
  ) >>> 0;
}

export function decodeSwitchOSIpv4(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError(`Invalid SwOS IPv4 integer: ${value}`);
  }

  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ].join(".");
}

export function encodeSwitchOSMac(value: string): string {
  const normalized = value.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(normalized)) {
    throw new TypeError(`Invalid MAC address: ${value}`);
  }
  return normalized;
}

export function decodeSwitchOSMac(value: string, separator = ":"): string {
  const normalized = encodeSwitchOSMac(value);
  return normalized.match(/.{2}/g)?.join(separator) ?? normalized;
}

export function encodeSwitchOSBitmask(indices: readonly number[]): number {
  let mask = 0;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index > 31) {
      throw new RangeError(`Bitmask index out of range: ${index}`);
    }
    mask |= 1 << index;
  }
  return mask >>> 0;
}

export function decodeSwitchOSBitmask(mask: number): number[] {
  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff) {
    throw new TypeError(`Invalid SwOS bitmask: ${mask}`);
  }
  const indices: number[] = [];
  for (let index = 0; index < 32; index += 1) {
    if ((mask >>> index) & 1) {
      indices.push(index);
    }
  }
  return indices;
}

export class SwitchOSClient {
  public readonly docsUrl = "https://help.mikrotik.com/docs/display/SWOS/SwOS";
  private readonly fetchImpl: SwitchOSFetch;
  private digestChallenge: DigestChallenge | undefined;
  private nonceCount = 0;
  private _schema: SwitchOSApiSchema | undefined;

  public constructor(public readonly options: SwitchOSClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this._schema = options.schema;
  }

  public get schema(): SwitchOSApiSchema | undefined {
    return this._schema;
  }

  public set schema(schema: SwitchOSApiSchema | undefined) {
    this._schema = schema;
  }

  public listEndpoints(): string[] {
    return Object.keys(this._schema?.endpoints ?? {});
  }

  public getEndpointSchema(path: string): SwitchOSEndpointSchema | undefined {
    return this._schema?.endpoints[normalizePath(path)];
  }

  public async login(signal?: AbortSignal): Promise<void> {
    await this.request("/sys.b", {
      ...(signal !== undefined && { signal }),
      parse: false,
    });
  }

  public async read<T extends SwitchOSWireValue = SwitchOSWireValue>(
    path: string,
    options: Omit<SwitchOSRequestOptions, "method" | "body"> = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  public async write<T extends SwitchOSWireValue = SwitchOSWireValue>(
    path: string,
    body: Exclude<SwitchOSRequestBody, FormData | URLSearchParams | ArrayBuffer | ArrayBufferView | Blob>,
    options: Omit<SwitchOSRequestOptions, "method" | "body"> = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  public async action(path: string, options: Omit<SwitchOSRequestOptions, "method" | "body"> = {}): Promise<void> {
    await this.request(path, { ...options, method: "POST", body: "*", parse: false });
  }

  public async download(path: string, options: Omit<SwitchOSRequestOptions, "method" | "body" | "parse"> = {}): Promise<Uint8Array> {
    const request = this.buildRequest(path, {
      method: "GET",
      ...(options.headers !== undefined && { headers: options.headers }),
      ...(options.signal !== undefined && { signal: options.signal }),
      parse: false,
    });
    const response = await this.fetchWithDigest(request);

    if (!response.ok) {
      const body = await response.text();
      throw new SwitchOSHttpError(response, body);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  public async request<T extends SwitchOSWireValue = SwitchOSWireValue>(
    path: string,
    options: SwitchOSRequestOptions = {}
  ): Promise<T> {
    const normalized = this.buildRequest(path, options);
    const response = await this.fetchWithDigest(normalized);
    const body = await response.text();

    if (!response.ok) {
      throw new SwitchOSHttpError(response, body);
    }

    if (options.parse === false || body.trim() === "") {
      return undefined as unknown as T;
    }

    return parseLiteral(body) as T;
  }

  private buildRequest(path: string, options: SwitchOSRequestOptions): NormalizedRequest {
    const normalizedPath = normalizePath(path);
    const url = new URL(`${normalizeBaseUrl(this.options.baseUrl)}${normalizedPath}`);
    const headers = new Headers(options.headers);
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const signal = withTimeout(options.signal, this.options.timeoutMs);

    const init: RequestInit = {
      method,
      headers,
      ...(signal !== undefined && { signal }),
    };

    if (options.body !== undefined) {
      if (options.body === "*") {
        init.body = "*";
        if (!headers.has("content-type")) {
          headers.set("content-type", "text/plain");
        }
      } else if (
        typeof options.body === "string" ||
        typeof options.body === "number" ||
        typeof options.body === "boolean" ||
        options.body === null ||
        Array.isArray(options.body) ||
        isPlainObject(options.body)
      ) {
        init.body = serializeLiteral(options.body as SwitchOSWireValue);
        if (!headers.has("content-type")) {
          headers.set("content-type", "text/plain");
        }
      } else if (options.body instanceof URLSearchParams || options.body instanceof FormData || options.body instanceof Blob) {
        init.body = options.body;
      } else {
        init.body = Buffer.from(toUint8Array(options.body));
      }
    }

    return { url, path: normalizedPath, init, headers };
  }

  private async fetchWithDigest(request: NormalizedRequest): Promise<Response> {
    if (this.digestChallenge && this.options.username && this.options.password) {
      request.headers.set(
        "authorization",
        buildDigestAuthorization(
          this.digestChallenge,
          request.init.method ?? "GET",
          request.path,
          this.options.username,
          this.options.password,
          ++this.nonceCount
        )
      );
    }

    let response = await this.fetchImpl(request.url, request.init);

    if (response.status !== 401) {
      return response;
    }

    if (!this.options.username || !this.options.password) {
      return response;
    }

    const challenge = parseDigestChallenge(response.headers.get("www-authenticate"));
    if (!challenge) {
      return response;
    }

    this.digestChallenge = challenge;
    this.nonceCount = 0;
    request.headers.set(
      "authorization",
      buildDigestAuthorization(
        challenge,
        request.init.method ?? "GET",
        request.path,
        this.options.username,
        this.options.password,
        ++this.nonceCount
      )
    );

    response = await this.fetchImpl(request.url, request.init);

    if (response.status === 401) {
      const nextChallenge = parseDigestChallenge(response.headers.get("www-authenticate"));
      if (nextChallenge && nextChallenge.nonce !== challenge.nonce) {
        this.digestChallenge = nextChallenge;
        this.nonceCount = 0;
        request.headers.set(
          "authorization",
          buildDigestAuthorization(
            nextChallenge,
            request.init.method ?? "GET",
            request.path,
            this.options.username,
            this.options.password,
            ++this.nonceCount
          )
        );
        response = await this.fetchImpl(request.url, request.init);
      }
    }

    return response;
  }
}
