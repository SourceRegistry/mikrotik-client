import net from "node:net";
import tls from "node:tls";
import { EventEmitter } from "node:events";
import { SentenceDecoder, createDeferred, encodeSentence, withTimeout } from "../shared";
import { createRouterOSHelpers, type RouterOSHelpers } from "./helpers";
import type { DeviceTransport } from "./transport";

export type RouterOSPrimitive =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean | null | undefined)[];

export type RouterOSAttributes = Record<string, RouterOSPrimitive>;
export type RouterOSRecord = Record<string, string>;
export type RouterOSQueryWord = string;
export type RouterOSReplyType = "re" | "done" | "trap" | "empty" | "fatal";

export type RouterOSReply = {
  type: RouterOSReplyType;
  tag?: string;
  attributes: RouterOSRecord;
  apiAttributes: RouterOSRecord;
  raw: string[];
};

export type RouterOSCommandOptions = {
  attributes?: RouterOSAttributes;
  apiAttributes?: RouterOSAttributes;
  queries?: readonly RouterOSQueryWord[];
  tag?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type RouterOSCommandResult = {
  tag: string;
  records: RouterOSRecord[];
  done?: RouterOSReply;
  empty?: RouterOSReply;
  traps: RouterOSReply[];
};

export type RouterOSListenOptions = RouterOSCommandOptions & {
  onReply?: (reply: RouterOSReply) => void | Promise<void>;
};

export type RouterOSSocketFactory = (
  options: RouterOSClientOptions
) => Promise<net.Socket | tls.TLSSocket> | net.Socket | tls.TLSSocket;

export type RouterOSClientOptions = {
  host: string;
  username?: string;
  password?: string;
  port?: number | undefined;
  tls?: boolean;
  timeoutMs?: number;
  keepAlive?: boolean;
  socketFactory?: RouterOSSocketFactory;
  tlsOptions?: tls.ConnectionOptions;
};

export type RouterOSApiBranch = {
  [segment: string]: RouterOSApiBranch;
} & {
  path: (segment: string) => RouterOSApiBranch;
  call: (options?: RouterOSCommandOptions) => Promise<RouterOSCommandResult>;
  print: (options?: RouterOSCommandOptions) => Promise<RouterOSRecord[]>;
  getall: (options?: RouterOSCommandOptions) => Promise<RouterOSRecord[]>;
  add: (options?: RouterOSCommandOptions) => Promise<RouterOSCommandResult>;
  set: (options?: RouterOSCommandOptions) => Promise<RouterOSCommandResult>;
  remove: (options?: RouterOSCommandOptions) => Promise<RouterOSCommandResult>;
  listen: (options?: RouterOSListenOptions) => Promise<RouterOSStream>;
  command: (command: string, options?: RouterOSCommandOptions) => Promise<RouterOSCommandResult>;
};

export class RouterOSTrapError extends Error {
  public readonly replies: RouterOSReply[];

  public constructor(replies: RouterOSReply[]) {
    const message =
      replies[0]?.attributes.message ??
      replies.map((reply) => reply.raw.join(" ")).join("; ") ??
      "RouterOS command failed";
    super(message);
    this.name = "RouterOSTrapError";
    this.replies = replies;
  }
}

type PendingExecute = {
  kind: "execute";
  tag: string;
  records: RouterOSRecord[];
  traps: RouterOSReply[];
  deferred: ReturnType<typeof createDeferred<RouterOSCommandResult>>;
};

type PendingListen = {
  kind: "listen";
  stream: RouterOSStream;
  onReply?: (reply: RouterOSReply) => void | Promise<void>;
};

type PendingRequest = PendingExecute | PendingListen;

function normalizeCommand(command: string): string {
  return command.startsWith("/") ? command : `/${command}`;
}

function normalizeValue(value: RouterOSPrimitive): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item) ?? "").join(",");
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function encodeAttributeWords(
  prefix: "=" | ".",
  attributes: RouterOSAttributes | undefined
): string[] {
  if (!attributes) return [];
  const words: string[] = [];

  for (const [key, value] of Object.entries(attributes)) {
    const normalized = normalizeValue(value);
    if (normalized === undefined) continue;
    words.push(`${prefix}${key}=${normalized}`);
  }

  return words;
}

function parseReply(words: string[]): RouterOSReply {
  if (words.length === 0) {
    throw new Error("Received empty RouterOS sentence.");
  }

  // safe: words.length > 0 verified by the guard above
  const head = words[0]!;
  const tail = words.slice(1);
  const type = head.startsWith("!") ? head.slice(1) : head;
  if (type !== "re" && type !== "done" && type !== "trap" && type !== "empty" && type !== "fatal") {
    throw new Error(`Unsupported RouterOS reply word: ${head}`);
  }

  const attributes: RouterOSRecord = {};
  const apiAttributes: RouterOSRecord = {};

  for (const word of tail) {
    if (word.startsWith("=")) {
      const index = word.indexOf("=", 1);
      const key = index === -1 ? word.slice(1) : word.slice(1, index);
      const value = index === -1 ? "" : word.slice(index + 1);
      attributes[key] = value;
      continue;
    }

    if (word.startsWith(".")) {
      const index = word.indexOf("=", 1);
      const key = index === -1 ? word.slice(1) : word.slice(1, index);
      const value = index === -1 ? "" : word.slice(index + 1);
      apiAttributes[key] = value;
    }
  }

  return {
    type,
    ...(apiAttributes.tag !== undefined && { tag: apiAttributes.tag }),
    attributes,
    apiAttributes,
    raw: words,
  };
}

function createApiBranch(client: RouterOSClient, segments: string[] = []): RouterOSApiBranch {
  const branch = {
    path(segment: string) {
      return createApiBranch(client, [...segments, segment]);
    },
    call(options?: RouterOSCommandOptions) {
      return client.execute(`/${segments.join("/")}`, options);
    },
    print(options?: RouterOSCommandOptions) {
      return client
        .execute(`/${segments.join("/")}/print`, options)
        .then((result) => result.records);
    },
    getall(options?: RouterOSCommandOptions) {
      return client
        .execute(`/${segments.join("/")}/getall`, options)
        .then((result) => result.records);
    },
    add(options?: RouterOSCommandOptions) {
      return client.execute(`/${segments.join("/")}/add`, options);
    },
    set(options?: RouterOSCommandOptions) {
      return client.execute(`/${segments.join("/")}/set`, options);
    },
    remove(options?: RouterOSCommandOptions) {
      return client.execute(`/${segments.join("/")}/remove`, options);
    },
    listen(options?: RouterOSListenOptions) {
      return client.listen(`/${segments.join("/")}/listen`, options);
    },
    command(command: string, options?: RouterOSCommandOptions) {
      return client.execute(`/${segments.join("/")}/${command}`, options);
    },
  };

  return new Proxy(branch as RouterOSApiBranch, {
    get(target, property, receiver) {
      if (typeof property !== "string" || property in target) {
        return Reflect.get(target, property, receiver);
      }

      return createApiBranch(client, [...segments, property]);
    },
  });
}

export class RouterOSStream extends EventEmitter implements AsyncIterable<RouterOSReply> {
  public readonly tag: string;
  private readonly queue: RouterOSReply[] = [];
  private readonly waiters: Array<
    ReturnType<typeof createDeferred<IteratorResult<RouterOSReply>>>
  > = [];
  private finished = false;
  private finishError?: unknown;
  private readonly cancelFn: () => Promise<void>;

  public constructor(tag: string, cancelFn: () => Promise<void>) {
    super();
    this.tag = tag;
    this.cancelFn = cancelFn;
  }

  push(reply: RouterOSReply): void {
    this.emit("reply", reply);

    if (reply.type === "done") {
      this.finish();
      return;
    }

    if (reply.type === "trap" || reply.type === "fatal") {
      const error = new RouterOSTrapError([reply]);
      this.finish(error);
      return;
    }

    if (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value: reply, done: false });
      return;
    }

    this.queue.push(reply);
  }

  async nextReply(timeoutMs?: number): Promise<RouterOSReply | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }

    if (this.finished) {
      if (this.finishError) {
        throw this.finishError;
      }
      return undefined;
    }

    const deferred = createDeferred<IteratorResult<RouterOSReply>>();
    this.waiters.push(deferred);
    const result = await withTimeout(
      deferred.promise,
      timeoutMs,
      `Timed out waiting for RouterOS stream reply for tag ${this.tag}`
    );
    return result.done ? undefined : result.value;
  }

  async cancel(): Promise<void> {
    if (this.finished) return;
    await this.cancelFn();
  }

  finish(error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.finishError = error;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve({ value: undefined, done: true });
      }
    }
    this.emit("close", error);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RouterOSReply> {
    while (true) {
      const reply = await this.nextReply();
      if (!reply) return;
      yield reply;
    }
  }
}

export class RouterOSClient implements DeviceTransport {
  private socket: net.Socket | tls.TLSSocket | undefined;
  private readonly decoder = new SentenceDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private connectPromise: Promise<this> | undefined;
  private nextTagId = 1;

  public readonly api: RouterOSApiBranch;
  public readonly system: RouterOSHelpers["system"];
  public readonly interface: RouterOSHelpers["interface"];
  public readonly bridge: RouterOSHelpers["bridge"];
  public readonly ip: RouterOSHelpers["ip"];
  public readonly ipv6: RouterOSHelpers["ipv6"];
  public readonly wireguard: RouterOSHelpers["wireguard"];
  public readonly ppp: RouterOSHelpers["ppp"];
  public readonly routing: RouterOSHelpers["routing"];

  public constructor(public readonly options: RouterOSClientOptions) {
    this.api = createApiBranch(this);
    const helpers = createRouterOSHelpers(this);
    this.system = helpers.system;
    this.interface = helpers.interface;
    this.bridge = helpers.bridge;
    this.ip = helpers.ip;
    this.ipv6 = helpers.ipv6;
    this.wireguard = helpers.wireguard;
    this.ppp = helpers.ppp;
    this.routing = helpers.routing;
    if (!this.options.port) this.options.port = this.options.tls ? 8729 : 8728;
  }

  async connect(): Promise<this> {
    if (this.socket && !this.socket.destroyed) {
      return this;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<this>((resolve, reject) => {
      const onConnected = async (socket: net.Socket | tls.TLSSocket) => {
        this.socket = socket;
        socket.setKeepAlive(this.options.keepAlive ?? true);
        socket.on("data", (chunk: Buffer) => {
          for (const sentence of this.decoder.push(chunk)) {
            this.handleSentence(sentence).catch((error: unknown) => {
              this.rejectAll(error);
              socket.destroy();
            });
          }
        });
        socket.on("error", (error) => {
          this.rejectAll(error);
        });
        socket.on("close", () => {
          this.rejectAll(new Error("RouterOS connection closed."));
          this.socket = undefined;
          this.connectPromise = undefined;
        });

        try {
          if (this.options.username !== undefined) {
            await this.login();
          }
          resolve(this);
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      };

      const finalizeSocket = (
        socket: net.Socket | tls.TLSSocket,
        connectEvent: "connect" | "secureConnect"
      ) => {
        let settled = false;
        const cleanup = () => {
          if (timer) {
            clearTimeout(timer);
          }
          socket.off(connectEvent, onReady);
          socket.off("error", onError);
          socket.off("close", onClose);
        };
        const onReady = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          void onConnected(socket);
        };
        const onError = (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(error);
        };
        const onClose = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(new Error("RouterOS connection closed before it was established."));
        };
        const timer =
          this.options.timeoutMs && this.options.timeoutMs > 0
            ? setTimeout(() => {
                if (settled) {
                  return;
                }
                settled = true;
                cleanup();
                socket.destroy();
                reject(
                  new Error(
                    `RouterOS connection timed out to ${this.options.host}:${this.options.port ?? (this.options.tls ? 8729 : 8728)}`
                  )
                );
              }, this.options.timeoutMs)
            : undefined;

        socket.once(connectEvent, onReady);
        socket.once("error", onError);
        socket.once("close", onClose);
      };

      if (this.options.socketFactory) {
        Promise.resolve(this.options.socketFactory(this.options))
          .then((socket) => onConnected(socket))
          .catch(reject);
        return;
      }

      if (this.options.tls) {
        const socket = tls.connect({
          host: this.options.host,
          port: this.options.port ?? 8729,
          ...this.options.tlsOptions,
        });
        finalizeSocket(socket, "secureConnect");
        return;
      }

      const socket = net.connect({
        host: this.options.host,
        port: this.options.port ?? 8728,
      });
      finalizeSocket(socket, "connect");
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return this.connectPromise;
  }

  async login(): Promise<this> {
    if (this.options.username === undefined) {
      throw new Error("RouterOS login requires a username.");
    }

    await this.execute("/login", {
      attributes: {
        name: this.options.username,
        password: this.options.password ?? "",
      },
      ...(this.options.timeoutMs !== undefined && { timeoutMs: this.options.timeoutMs }),
    });

    return this;
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) {
      if (pending.kind === "listen") {
        pending.stream.finish();
      } else {
        pending.deferred.reject(new Error("RouterOS client closed."));
      }
    }
    this.pending.clear();
    if (!this.socket) return;

    const socket = this.socket;
    this.socket = undefined;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
      setTimeout(() => {
        if (!socket.destroyed) socket.destroy();
      }, 50);
    });
  }

  async execute(
    command: string,
    options: RouterOSCommandOptions = {}
  ): Promise<RouterOSCommandResult> {
    await this.connect();
    const tag = options.tag ?? this.createTag();
    const deferred = createDeferred<RouterOSCommandResult>();
    const pending: PendingExecute = {
      kind: "execute",
      tag,
      records: [],
      traps: [],
      deferred,
    };
    this.pending.set(tag, pending);

    const cleanupAbort = this.bindAbort(tag, options);

    try {
      await this.writeSentence(command, options, tag);
      const result = await withTimeout(
        deferred.promise,
        options.timeoutMs ?? this.options.timeoutMs,
        `RouterOS command timed out for ${normalizeCommand(command)}`,
        () => {
          void this.cancel(tag).catch(() => undefined);
        }
      );
      cleanupAbort();
      return result;
    } catch (error) {
      cleanupAbort();
      this.pending.delete(tag);
      throw error;
    }
  }

  async listen(command: string, options: RouterOSListenOptions = {}): Promise<RouterOSStream> {
    await this.connect();
    const tag = options.tag ?? this.createTag();
    const stream = new RouterOSStream(tag, () => this.cancel(tag));
    this.pending.set(tag, {
      kind: "listen",
      stream,
      ...(options.onReply !== undefined && { onReply: options.onReply }),
    });

    const cleanupAbort = this.bindAbort(tag, options, async () => {
      await stream.cancel();
    });

    stream.once("close", () => {
      cleanupAbort();
      this.pending.delete(tag);
    });

    await this.writeSentence(command, options, tag);
    return stream;
  }

  async print(command: string, options: RouterOSCommandOptions = {}): Promise<RouterOSRecord[]> {
    const result = await this.execute(`${normalizeCommand(command)}/print`, options);
    return result.records;
  }

  async cancel(tag: string): Promise<void> {
    if (!this.pending.has(tag)) return;

    try {
      await this.execute("/cancel", {
        attributes: { tag },
        ...(this.options.timeoutMs !== undefined && { timeoutMs: this.options.timeoutMs }),
      });
    } finally {
      const pending = this.pending.get(tag);
      if (pending?.kind === "listen") {
        pending.stream.finish();
      }
      this.pending.delete(tag);
    }
  }

  private bindAbort(
    tag: string,
    options: RouterOSCommandOptions,
    onAbort?: () => Promise<void> | void
  ): () => void {
    const signal = options.signal;
    if (!signal) return () => undefined;

    const abortHandler = () => {
      void onAbort?.();
      const pending = this.pending.get(tag);
      const error = new DOMException("Aborted", "AbortError");
      if (pending?.kind === "execute") {
        pending.deferred.reject(error);
      } else if (pending?.kind === "listen") {
        pending.stream.finish(error);
      }
      this.pending.delete(tag);
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) {
      abortHandler();
    }

    return () => {
      signal.removeEventListener("abort", abortHandler);
    };
  }

  private async writeSentence(
    command: string,
    options: RouterOSCommandOptions,
    tag: string
  ): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      throw new Error("RouterOS socket is not connected.");
    }

    const words = [
      normalizeCommand(command),
      ...encodeAttributeWords("=", options.attributes),
      ...(options.queries ?? []),
      ...encodeAttributeWords(".", {
        ...options.apiAttributes,
        tag,
      }),
    ];

    const payload = encodeSentence(words);
    await new Promise<void>((resolve, reject) => {
      socket.write(payload, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private createTag(): string {
    return String(this.nextTagId++);
  }

  private async handleSentence(words: string[]): Promise<void> {
    const reply = parseReply(words);
    const tag = reply.tag;
    if (!tag) {
      return;
    }

    const pending = this.pending.get(tag);
    if (!pending) {
      return;
    }

    if (pending.kind === "listen") {
      await pending.onReply?.(reply);
      pending.stream.push(reply);
      if (reply.type === "done" || reply.type === "trap" || reply.type === "fatal") {
        this.pending.delete(tag);
      }
      return;
    }

    if (reply.type === "re") {
      pending.records.push(reply.attributes);
      return;
    }

    if (reply.type === "trap" || reply.type === "fatal") {
      pending.traps.push(reply);
      return;
    }

    this.pending.delete(tag);
    if (pending.traps.length > 0) {
      pending.deferred.reject(new RouterOSTrapError(pending.traps));
      return;
    }

    pending.deferred.resolve({
      tag,
      records: pending.records,
      ...(reply.type === "done" && { done: reply }),
      ...(reply.type === "empty" && { empty: reply }),
      traps: pending.traps,
    });
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      if (pending.kind === "listen") {
        pending.stream.finish(error);
      } else {
        pending.deferred.reject(error);
      }
    }
    this.pending.clear();
  }
}

export * from "./helpers";
export * from "./ssh";
export * from "./rest";
export * from "./typed-stream";
export type { DeviceTransport } from "./transport";
