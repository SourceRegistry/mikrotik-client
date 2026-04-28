import { EventEmitter } from "node:events";
import { createDeferred, withTimeout } from "../shared";
import type { RouterOSListenOptions, RouterOSRecord, RouterOSReply } from "./index";
import { RouterOSStream } from "./index";
import type { DeviceTransport } from "./transport";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Discriminated union of strongly-typed event payloads.
 *
 * Each event carries the original raw `RouterOSRecord` for debugging or
 * forwarding, plus the parsed typed shape (`T`).
 *
 * @example
 * ```ts
 * watch.on("event", (ev) => {
 *   switch (ev.kind) {
 *     case "added":
 *       console.log("new", ev.after.name);
 *       break;
 *     case "updated":
 *       console.log("changed", ev.before.name, "→", ev.after);
 *       break;
 *     case "removed":
 *       console.log("gone", ev.before.name);
 *       break;
 *   }
 * });
 * ```
 */
export type TypedEvent<T> =
  | { kind: "added"; after: T; before?: never; raw: RouterOSRecord }
  | { kind: "updated"; after: T; before: T; raw: RouterOSRecord }
  | { kind: "removed"; before: T; after?: never; raw: RouterOSRecord };

/**
 * Options for creating a {@link TypedStream}.
 *
 * @example
 * ```ts
 * const stream = new TypedStream(routerStream, parseInterface, {
 *   signal: controller.signal,
 *   onRemovalKeys: [".id", "name"],
 * });
 * ```
 */
export type TypedStreamOptions = {
  /**
   * AbortSignal to cancel the stream early.
   * On abort, the underlying `RouterOSStream` is cancelled and
   * this stream finishes within 100 ms.
   */
  signal?: AbortSignal;
  /**
   * Field names (in priority order) used to look up existing
   * entries in the state map when identity resolution is needed.
   * @default [".id", "name"]
   */
  onRemovalKeys?: readonly string[];
};

/**
 * Options for `watch()` resource helpers.
 *
 * @example
 * ```ts
 * const watch = await client.interface.watch({
 *   signal: controller.signal,
 *   intervalMs: 3000, // for REST long-poll
 * });
 * ```
 */
export type RouterOSWatchOptions = {
  /** AbortSignal to cancel the watch early. */
  signal?: AbortSignal;
  /** Default timeout for the underlying stream. */
  timeoutMs?: number;
  /**
   * Poll interval for REST transport long-poll (ignored for binary API).
   * @default 5000
   */
  intervalMs?: number;
  /**
   * Field names used for identity lookups in the state map.
   * @default [".id", "name"]
   */
  onRemovalKeys?: readonly string[];
};

// ─── Key helpers ──────────────────────────────────────────────────────────────

const DEFAULT_KEYS: readonly string[] = [".id", "name"];

/**
 * Extract a stable key from a raw record.
 * Returns the first non-empty value for the given key names.
 * Falls back to a composite of all non-empty fields.
 */
function extractKey(raw: RouterOSRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (value != null && value !== "") return value;
  }
  // Fallback: composite key from all fields
  const parts = Object.entries(raw)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return parts.join("|");
}

/**
 * Check if a record looks like a removal signal.
 * RouterOS /listen may send a single-field record containing only `.id`
 * (and optionally `.removed=yes` or `disabled=yes`) when an entry disappears.
 *
 * We consider a record a "removal hint" when:
 * - `.removed` equals `yes`, OR
 * - only one meaningful field (the key) is present.
 */
function looksLikeRemoval(raw: RouterOSRecord, keys: readonly string[]): boolean {
  // If RouterOS explicitly signals removal via .removed=yes, that takes priority
  const removed = raw[".removed"];
  if (removed !== undefined && removed === "yes") return true;

  // The record is likely a removal if it only contains key fields
  // (e.g. { ".id": "*1" } with no other fields present)
  for (const fieldName of Object.keys(raw)) {
    // Skip .removed — it's a signal field, not resource data
    if (fieldName === ".removed") continue;
    // If a non-key field is present, this is likely an add/update, not a removal
    if (!keys.includes(fieldName)) {
      return false;
    }
  }
  // Only key fields are present → treat as removal
  return true;
}

/**
 * Check if a record has an EXPLICIT removal signal (.removed=yes).
 * This is different from looksLikeRemoval which also includes the key-only heuristic.
 */
function hasExplicitRemoval(raw: RouterOSRecord): boolean {
  return raw[".removed"] === "yes";
}

// ─── TypedStream class ────────────────────────────────────────────────────────

/**
 * A strongly-typed event stream that wraps a raw {@link RouterOSStream}.
 *
 * Maintains an in-memory state map keyed by `.id` (or `name`) so that
 * incoming raw replies are classified as `"added"`, `"updated"`, or
 * `"removed"` events with full typed payloads.
 *
 * Backpressure-aware via internal queue + deferred pattern.
 * Supports both `EventEmitter.on("event", ...)` and `for await` iteration.
 *
 * @example
 * ```ts
 * // Via for-await (backpressure-aware):
 * for await (const event of stream) {
 *   switch (event.kind) {
 *     case "added":
 *       console.log("new interface:", event.after.name);
 *       break;
 *     case "updated":
 *       console.log("changed:", event.before.name, "->", event.after.name);
 *       break;
 *     case "removed":
 *       console.log("gone:", event.before.name);
 *       break;
 *   }
 * }
 *
 * // Via event listener:
 * stream.on("event", (event) => {
 *   console.log(event.kind, event.raw);
 * });
 * ```
 */
export class TypedStream<T> extends EventEmitter implements AsyncIterable<TypedEvent<T>> {
  /** The current state of all tracked resources. */
  public readonly state: Map<string, T> = new Map();
  private readonly queue: TypedEvent<T>[] = [];
  private readonly waiters: Array<
    ReturnType<typeof createDeferred<IteratorResult<TypedEvent<T>>>>
  > = [];
  private finished = false;
  private finishing = false;
  private finishError?: unknown;
  private readonly cancelFn: () => Promise<void>;
  private readonly parseFn: (raw: RouterOSRecord) => T;
  private readonly keys: readonly string[];
  private abortCleanup: (() => void) | undefined;

  /**
   * Create a new typed event stream.
   *
   * @param stream - The underlying raw RouterOSStream (from `/listen`).
   * @param parseFn - Parser function that converts a raw RouterOSRecord to T.
   * @param options - Optional configuration (signal, key fields).
   */
  public constructor(
    stream: RouterOSStream,
    parseFn: (raw: RouterOSRecord) => T,
    options?: TypedStreamOptions
  ) {
    super();

    this.parseFn = parseFn;
    this.keys = options?.onRemovalKeys ?? DEFAULT_KEYS;
    this.cancelFn = async () => {
      await stream.cancel();
    };

    // Wire up the underlying stream
    stream.on("reply", (reply: RouterOSReply) => {
      void this.handleReply(reply);
    });

    stream.on("close", (error?: unknown) => {
      this.finish(error);
      this.cleanupAbort();
    });

    // Handle AbortSignal
    if (options?.signal) {
      this.bindAbort(options.signal);
    }
  }

  /**
   * Bind an AbortSignal to cancel this stream on abort.
   * Cleanup is guaranteed within 100 ms of signal abort.
   */
  private bindAbort(signal: AbortSignal): void {
    const abortHandler = async () => {
      try {
        await this.cancel();
      } catch {
        // cancel may already be in progress
      }
    };

    signal.addEventListener("abort", abortHandler, { once: true });
    this.abortCleanup = () => {
      signal.removeEventListener("abort", abortHandler);
    };

    if (signal.aborted) {
      void abortHandler();
    }
  }

  private cleanupAbort(): void {
    this.abortCleanup?.();
    this.abortCleanup = undefined;
  }

  /**
   * Handle incoming replies from the underlying stream.
   * Classifies each `!re` as added, updated, or removed based on state map.
   */
  private async handleReply(reply: RouterOSReply): Promise<void> {
    if (reply.type === "done") {
      // Stream ended normally — let the close handler deal with it
      return;
    }

    if (reply.type === "trap" || reply.type === "fatal") {
      // Let the underlying stream handle error propagation
      return;
    }

    // Only process `!re` (reply data) sentences
    if (reply.type !== "re") return;

    const raw = reply.attributes;
    const key = extractKey(raw, this.keys);
    const parsed = this.parseFn(raw);

    if (this.state.has(key)) {
      // Key is already tracked — check if this is a removal or update
      if (looksLikeRemoval(raw, this.keys)) {
        // Removal: keep the before state from our map
        const before = this.state.get(key);
        if (before) {
          this.state.delete(key);
          this.emitEvent({
            kind: "removed",
            before,
            raw,
          } as TypedEvent<T>);
        }
      } else {
        // Update: key exists and has non-key data
        const before = this.state.get(key)!;
        this.state.set(key, parsed);
        this.emitEvent({
          kind: "updated",
          before,
          after: parsed,
          raw,
        });
      }
    } else {
      // Key is new — check if it's an explicit removal signal
      if (hasExplicitRemoval(raw)) {
        // Explicit .removed=yes for untracked key — ignore
        return;
      }
      // Otherwise treat as add (first-time, post-reboot reappear, or key-only heuristic)
      this.state.set(key, parsed);
      this.emitEvent({
        kind: "added",
        after: parsed,
        raw,
      } as TypedEvent<T>);
    }
  }

  /** Dispatch an event to listeners + waiters. */
  private emitEvent(event: TypedEvent<T>): void {
    this.emit("event", event);

    if (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value: event, done: false });
      return;
    }

    this.queue.push(event);
  }

  /**
   * Get the next typed event, waiting if necessary.
   * Returns `undefined` when the stream is finished.
   *
   * @param timeoutMs - Optional timeout in milliseconds.
   */
  async nextEvent(timeoutMs?: number): Promise<TypedEvent<T> | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }

    if (this.finished) {
      if (this.finishError) {
        throw this.finishError;
      }
      return undefined;
    }

    const deferred = createDeferred<IteratorResult<TypedEvent<T>>>();
    this.waiters.push(deferred);
    const result = await withTimeout(
      deferred.promise,
      timeoutMs,
      `Timed out waiting for typed stream event`
    );
    return result.done ? undefined : result.value;
  }

  /**
   * Cancel the underlying stream and finish this typed stream.
   * Idempotent: safe to call multiple times.
   */
  async cancel(): Promise<void> {
    if (this.finished || this.finishing) return;
    this.finishing = true;
    this.cleanupAbort();
    await this.cancelFn();
  }

  /**
   * Finish the stream, resolving all pending waiters.
   */
  finish(error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.finishing = false;
    this.finishError = error;
    this.cleanupAbort();

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

  /** Async iterator: backpressure-aware. */
  async *[Symbol.asyncIterator](): AsyncIterator<TypedEvent<T>> {
    while (true) {
      const event = await this.nextEvent();
      if (event === undefined) return;
      yield event;
    }
  }
}

// ─── watch() helper factory ──────────────────────────────────────────────────

/**
 * Create a `watch` function for a resource.
 *
 * For binary API transport: uses `/listen` → real-time events.
 * For REST transport: uses periodic `/print` polling → near-real-time diffs.
 *
 * @example
 * ```ts
 * const { watch, cancel } = createWatch({
 *   transport: client,
 *   printPath: "/interface",
 *   listenPath: "/interface/listen",
 *   parseFn: parseInterface,
 * });
 *
 * const stream = await watch({ signal });
 * for await (const event of stream) {
 *   console.log(event.kind, event.kind === "added" ? event.after.name : "change");
 * }
 * ```
 */
export type WatchFactory<T = RouterOSRecord> = {
  /** Start watching the resource. Returns a typed stream. */
  watch: (options?: RouterOSWatchOptions) => Promise<TypedStream<T>>;
  /** Cancel all active watch streams. */
  cancel: () => Promise<void>;
};

/**
 * Creates a watch factory for a given resource.
 *
 * @param transport - DeviceTransport (API or REST).
 * @param printPath - Resource path for `/print` (e.g. `/interface`).
 * @param listenPath - Resource path for `/listen` (e.g. `/interface/listen`). Only used by API transport.
 * @param parseFn - Parser from raw record to typed DTO.
 */
export function createWatch<T>({
  transport,
  printPath,
  listenPath,
  parseFn,
}: {
  transport: DeviceTransport;
  printPath: string;
  listenPath: string;
  parseFn: (raw: RouterOSRecord) => T;
}): WatchFactory<T> {
  let streamRef: TypedStream<T> | undefined;

  // Check if this is a REST transport (no streaming support)
  const isRestTransport = hasExecuteLimitation(transport);

  return {
    async watch(options: RouterOSWatchOptions = {}): Promise<TypedStream<T>> {
      if (isRestTransport) {
        return createPollingStream({
          transport,
          printPath,
          parseFn,
          options,
        });
      }

      return createListenStream({
        transport,
        listenPath,
        parseFn,
        options,
      });
    },

    async cancel(): Promise<void> {
      if (streamRef) {
        await streamRef.cancel();
        streamRef = undefined;
      }
    },
  };
}

/**
 * Check if the transport supports listen (binary API) or must fall back to polling (REST).
 * RouterOSRestClient listen() always throws, so we probe by checking the constructor name.
 */
function hasExecuteLimitation(transport: DeviceTransport): boolean {
  // Check if this is a REST transport by looking at the constructor name
  const ctorName = transport.constructor?.name ?? "";
  return ctorName.includes("Rest");
}

// ─── Listen-based streaming (binary API) ─────────────────────────────────────

async function createListenStream<T>({
  transport,
  listenPath,
  parseFn,
  options,
}: {
  transport: DeviceTransport;
  listenPath: string;
  parseFn: (raw: RouterOSRecord) => T;
  options: RouterOSWatchOptions;
}): Promise<TypedStream<T>> {
  const listenOpts: RouterOSListenOptions = {
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options.signal !== undefined && { signal: options.signal }),
  };

  const stream = await transport.listen(listenPath, listenOpts);
  const typed = new TypedStream<T>(stream, parseFn, {
    ...(options.signal !== undefined && { signal: options.signal }),
    ...(options.onRemovalKeys !== undefined && { onRemovalKeys: options.onRemovalKeys }),
  });

  return typed;
}

// ─── Polling-based streaming (REST fallback) ─────────────────────────────────

async function createPollingStream<T>({
  transport,
  printPath,
  parseFn,
  options,
}: {
  transport: DeviceTransport;
  printPath: string;
  parseFn: (raw: RouterOSRecord) => T;
  options: RouterOSWatchOptions;
}): Promise<TypedStream<T>> {
  const intervalMs = options.intervalMs ?? 5000;
  const keys = options.onRemovalKeys ?? DEFAULT_KEYS;

  // Create a synthetic stream-like object that we can wrap
  const stopRef = { running: true };

  const syntheticStream = new RouterOSStream(`poll-${printPath}`, async () => {});

  const typed = new TypedStream<T>(syntheticStream, parseFn, {
    ...(options.signal !== undefined && { signal: options.signal }),
    onRemovalKeys: keys,
  });

  // Seed initial state
  async function poll(): Promise<void> {
    if (!stopRef.running || options.signal?.aborted) return;

    try {
      const records = await transport.print(printPath, {
        ...(options.signal !== undefined && { signal: options.signal }),
        ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      });

      const currentIds = new Map<string, RouterOSRecord>();
      for (const raw of records) {
        const key = extractKey(raw, keys);
        currentIds.set(key, raw);
      }

      // Find removed entries (in state but not in current)
      for (const [key] of typed.state) {
        if (!currentIds.has(key)) {
          // Emit synthetic removal reply
          const removalRaw: RouterOSRecord = { [keys[0] ?? ".id"]: key };
          syntheticStream.emit("reply", {
            type: "re" as const,
            attributes: removalRaw,
            apiAttributes: {},
            raw: [],
          });
        }
      }

      // Emit current state as replies (TypedStream will classify as added/updated)
      for (const raw of records) {
        syntheticStream.emit("reply", {
          type: "re" as const,
          attributes: raw,
          apiAttributes: {},
          raw: [],
        });
      }
    } catch (err) {
      // On abort error, silently stop
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Finish the stream with the error (routes via TypedStream's close handler)
      syntheticStream.finish(err);
    }

    if (stopRef.running && !options.signal?.aborted) {
      setTimeout(() => void poll(), intervalMs);
    }
  }

  // Start polling
  void poll();

  // Wire up abort signal
  if (options.signal) {
    options.signal.addEventListener(
      "abort",
      () => {
        stopRef.running = false;
      },
      { once: true }
    );
  }

  // Override cancel to also stop polling
  const originalCancel = typed.cancel.bind(typed);
  typed.cancel = async () => {
    stopRef.running = false;
    await originalCancel();
    syntheticStream.emit("close");
  };

  return typed;
}
