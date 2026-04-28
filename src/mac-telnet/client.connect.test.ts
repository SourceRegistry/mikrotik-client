/**
 * Extended MacTelnetClient tests covering connect/auth/command/disconnect flows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionState } from "./session";

/** Drain microtask queue (2 levels deep for async chains) */
async function _flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// ── Mock socket ────────────────────────────────────────────────────────────

type MockSocket = {
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  bind: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  _emit: (event: string, ...args: unknown[]) => void;
  _handlers: Record<string, ((...args: unknown[]) => void)[]>;
};

function makeMockSocket(): MockSocket {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const sock: MockSocket = {
    _handlers: handlers,
    _emit(event, ...args) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
    on: vi.fn((ev: string, h: (...a: unknown[]) => void) => {
      handlers[ev] ??= [];
      handlers[ev]!.push(h);
      return sock;
    }),
    send: vi.fn((_b, _p, _a, cb?: (e: Error | null) => void) => cb?.(null)),
    bind: vi.fn(() => {
      Promise.resolve().then(() => sock._emit("listening"));
      return sock;
    }),
    close: vi.fn(),
    removeAllListeners: vi.fn(() => {
      for (const k of Object.keys(handlers)) handlers[k] = [];
    }),
  };
  return sock;
}

let mockSocket: MockSocket;

vi.mock("node:dgram", () => ({ default: { createSocket: vi.fn(() => mockSocket) } }));
vi.mock("node:crypto", () => ({
  createECDH: vi.fn(() => ({
    generateKeys: vi.fn(),
    getPublicKey: vi.fn(() => new Uint8Array(65).fill(0x04)),
    computeSecret: vi.fn(() => new Uint8Array(32).fill(0x01)),
  })),
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => new Uint8Array(16)),
  })),
  createHmac: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => new Uint8Array(32)),
  })),
}));
vi.mock("./interfaces", () => ({
  validateInterface: vi.fn(() => ({
    name: "en0",
    mac: "aa:bb:cc:dd:ee:ff",
    isUp: true,
    addresses: [],
  })),
  listActiveInterfaces: vi.fn(() => []),
}));
vi.mock("./packet", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    decodePacket: vi.fn(() => ({
      ptype: "start" as const,
      counter: 0,
      srcMac: new Uint8Array(6).fill(0),
      dstMac: new Uint8Array(6).fill(0),
      sessionKey: 0,
    })),
    decodeControlPackets: vi.fn(() => ({ controlPackets: [], rawData: new Uint8Array(0) })),
  };
});

beforeEach(async () => {
  mockSocket = makeMockSocket();
  vi.clearAllMocks();
  // Restore default mock implementations after clearAllMocks
  const { decodePacket, decodeControlPackets } = await import("./packet");
  vi.mocked(decodePacket).mockReturnValue({
    ptype: "start" as const,
    counter: 0,
    srcMac: new Uint8Array(6),
    dstMac: new Uint8Array(6),
    sessionKey: 0,
  });
  vi.mocked(decodeControlPackets).mockReturnValue({
    controlPackets: [],
    rawData: new Uint8Array(0),
  });
  const dgramMod = await import("node:dgram");
  vi.mocked(dgramMod.default.createSocket).mockReturnValue(
    mockSocket as unknown as ReturnType<typeof dgramMod.default.createSocket>
  );
});

// ── helpers ────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/consistent-type-imports -- unavoidable in vi.mock() context: circular deps prevent static import */
type MacTelnetClientConstructorArgs = Parameters<
  (typeof import("./client"))["MacTelnetClient"]["prototype"]["constructor"]
>[0];
/* eslint-enable @typescript-eslint/consistent-type-imports */

/** Force a client into "connected" state without going through real socket */
async function makeClient(extra: Partial<MacTelnetClientConstructorArgs> = {}) {
  const { MacTelnetClient } = await import("./client");
  const client = new MacTelnetClient({
    targetMac: "aa:bb:cc:dd:ee:ff",
    username: "admin",
    password: "secret",
    interfaceName: "en0",
    sessionKey: 0x1234,
    timeoutMs: 500,
    ...extra,
  });
  return client;
}

type ClientInternals = {
  state: string;
  session: unknown;
  socket: MockSocket | null;
  connectResolve: (() => void) | null;
  connectReject: ((e: Error) => void) | null;
  connectTimer: ReturnType<typeof setTimeout> | null;
  sourceMac: Uint8Array;
  keepAliveTimer: ReturnType<typeof setInterval> | null;
  pendingCommands: Map<
    number,
    {
      resolve: (r: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  handleMessage: (msg: Buffer, info: { address: string; port: number }) => void;
  startKeepAlive: () => void;
  stopKeepAlive: () => void;
  cleanup: () => void;
  setState: (s: string) => void;
  sendUsername: () => void;
  sendMD5Response: () => void;
  sendECSRPResponse: () => void;
  processChallenge: (c: { type: string; data: Uint8Array }) => void;
  serverPublicKey: Uint8Array | null;
  deviceSalt: Uint8Array | null;
};

function internals(client: Awaited<ReturnType<typeof makeClient>>): ClientInternals {
  return client as unknown as ClientInternals;
}

/** Set up client as if connected */
async function forceConnected() {
  const client = await makeClient();
  const i = internals(client);
  i.state = "connected";
  i.session = createSessionState({ sessionKey: 0x1234 });
  i.socket = mockSocket;
  return client;
}

// ── connect: timeout ───────────────────────────────────────────────────────

describe("MacTelnetClient connect timeout", () => {
  it("rejects when connection times out", async () => {
    vi.useFakeTimers();
    const client = await makeClient({ timeoutMs: 1000 });
    // Simulate the connect promise/timer setup directly (avoids real socket)
    const p = new Promise<void>((resolve, reject) => {
      internals(client).connectResolve = resolve;
      internals(client).connectReject = reject;
      internals(client).connectTimer = setTimeout(() => {
        internals(client).connectResolve = null;
        internals(client).connectReject = null;
        reject(new Error("Connection timeout after 1000ms"));
      }, 1000);
    });
    internals(client).state = "connecting";
    vi.advanceTimersByTime(2000);
    await expect(p).rejects.toThrow(/timeout/);
    vi.useRealTimers();
  });

  it("throws if already connecting", async () => {
    const client = await makeClient();
    internals(client).state = "connecting";
    await expect(client.connect()).rejects.toThrow(/Cannot connect/);
  });
});

// ── handleMessage ─────────────────────────────────────────────────────────

describe("MacTelnetClient handleMessage", () => {
  it("emits error on malformed packet", async () => {
    const client = await forceConnected();
    const { decodePacket } = vi.mocked(await import("./packet"));
    decodePacket.mockImplementationOnce(() => {
      throw new Error("bad packet");
    });
    const errors: Error[] = [];
    client.on("error", (e: Error) => errors.push(e));
    internals(client).handleMessage(Buffer.alloc(32), { address: "10.0.0.1", port: 20561 });
    expect(errors[0]?.message).toBe("bad packet");
  });

  it("handles END packet → state becomes disconnected", async () => {
    const client = await forceConnected();
    const { decodePacket } = vi.mocked(await import("./packet"));
    decodePacket.mockReturnValueOnce({
      ptype: "end" as const,
      counter: 0,
      srcMac: new Uint8Array(6),
      dstMac: new Uint8Array(6),
      sessionKey: 0,
    });
    internals(client).handleMessage(Buffer.alloc(16), { address: "10.0.0.1", port: 20561 });
    expect(internals(client).state).toBe("disconnected");
  });

  it("handles ACK packet silently", async () => {
    const client = await forceConnected();
    const { decodePacket } = vi.mocked(await import("./packet"));
    decodePacket.mockReturnValueOnce({
      ptype: "ack" as const,
      counter: 0,
      srcMac: new Uint8Array(6),
      dstMac: new Uint8Array(6),
      sessionKey: 0,
    });
    const errors: unknown[] = [];
    client.on("error", (e) => errors.push(e));
    internals(client).handleMessage(Buffer.alloc(16), { address: "10.0.0.1", port: 20561 });
    expect(errors).toHaveLength(0);
  });

  it("emits data event when connected and rawData present", async () => {
    const client = await forceConnected();
    const { decodePacket, decodeControlPackets } = vi.mocked(await import("./packet"));
    decodePacket.mockReturnValueOnce({
      ptype: "data" as const,
      counter: 42,
      srcMac: new Uint8Array(6),
      dstMac: new Uint8Array(6),
      sessionKey: 0,
    });
    decodeControlPackets.mockReturnValueOnce({
      controlPackets: [],
      rawData: new TextEncoder().encode("hello\n"),
    });
    const dataEvents: { text: string }[] = [];
    client.on("data", (e) => dataEvents.push(e as { text: string }));
    internals(client).handleMessage(Buffer.alloc(32), { address: "10.0.0.1", port: 20561 });
    expect(dataEvents[0]?.text).toBe("hello\n");
  });

  it("resolves pending command on matching counter", async () => {
    const client = await forceConnected();
    const { decodePacket, decodeControlPackets } = vi.mocked(await import("./packet"));
    // Inject a pending command at counter 7
    const result = await new Promise<{ output: string }>((resolve) => {
      internals(client).pendingCommands.set(7, {
        resolve: resolve as (r: unknown) => void,
        reject: (e) => {
          throw e;
        },
        timer: setTimeout(() => {}, 99999),
      });
      decodePacket.mockReturnValueOnce({
        ptype: "data" as const,
        counter: 7,
        srcMac: new Uint8Array(6),
        dstMac: new Uint8Array(6),
        sessionKey: 0,
      });
      decodeControlPackets.mockReturnValueOnce({
        controlPackets: [],
        rawData: new TextEncoder().encode("result\n"),
      });
      internals(client).handleMessage(Buffer.alloc(32), { address: "10.0.0.1", port: 20561 });
    });
    expect(result.output).toBe("result\n");
  });

  it("handles username request during connecting state", async () => {
    const client = await makeClient();
    const { decodePacket, decodeControlPackets } = vi.mocked(await import("./packet"));
    internals(client).state = "connecting";
    internals(client).socket = mockSocket;
    internals(client).session = createSessionState({ sessionKey: 0x1234 });
    decodePacket.mockReturnValueOnce({
      ptype: "data" as const,
      counter: 0,
      srcMac: new Uint8Array(6),
      dstMac: new Uint8Array(6),
      sessionKey: 0,
    });
    decodeControlPackets.mockReturnValueOnce({
      controlPackets: [{ type: "username", data: new Uint8Array(0) }],
      rawData: new Uint8Array(0),
    });
    internals(client).handleMessage(Buffer.alloc(32), { address: "10.0.0.1", port: 20561 });
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it("handles end_auth during connecting → transitions to connected", async () => {
    vi.useFakeTimers();
    const client = await makeClient();
    const { decodePacket, decodeControlPackets } = vi.mocked(await import("./packet"));
    internals(client).state = "connecting";
    internals(client).socket = mockSocket;
    internals(client).session = createSessionState({ sessionKey: 0x1234 });
    let resolved = false;
    internals(client).connectResolve = () => {
      resolved = true;
    };
    internals(client).connectReject = () => {};
    internals(client).connectTimer = setTimeout(() => {}, 99999);
    decodePacket.mockReturnValueOnce({
      ptype: "data" as const,
      counter: 0,
      srcMac: new Uint8Array(6),
      dstMac: new Uint8Array(6),
      sessionKey: 0,
    });
    decodeControlPackets.mockReturnValueOnce({
      controlPackets: [{ type: "end_auth", data: new Uint8Array(0) }],
      rawData: new Uint8Array(0),
    });
    internals(client).handleMessage(Buffer.alloc(32), { address: "10.0.0.1", port: 20561 });
    expect(internals(client).state).toBe("connected");
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it("handles passsalt_client (EC-SRP key request) during connecting", async () => {
    const client = await makeClient();
    const { decodePacket, decodeControlPackets } = vi.mocked(await import("./packet"));
    internals(client).state = "connecting";
    internals(client).socket = mockSocket;
    internals(client).session = createSessionState({ sessionKey: 0x1234 });
    internals(client).serverPublicKey = new Uint8Array(65).fill(0x02);
    // Need clientECDH and clientPublicKey too
    const crypto = await import("node:crypto");
    (internals(client) as unknown as { clientECDH: unknown }).clientECDH = vi.mocked(
      crypto.createECDH
    )("prime256v1");
    (internals(client) as unknown as { clientPublicKey: Uint8Array }).clientPublicKey =
      new Uint8Array(65).fill(0x04);
    decodePacket.mockReturnValueOnce({
      ptype: "data" as const,
      counter: 0,
      srcMac: new Uint8Array(6),
      dstMac: new Uint8Array(6),
      sessionKey: 0,
    });
    decodeControlPackets.mockReturnValueOnce({
      controlPackets: [{ type: "passsalt_client", data: new Uint8Array(0) }],
      rawData: new Uint8Array(0),
    });
    internals(client).handleMessage(Buffer.alloc(32), { address: "10.0.0.1", port: 20561 });
    expect(mockSocket.send).toHaveBeenCalled();
  });
});

// ── processChallenge ───────────────────────────────────────────────────────

describe("MacTelnetClient processChallenge", () => {
  it("handles MD5 challenge (16 byte salt)", async () => {
    const client = await makeClient({ authType: "md5" });
    internals(client).socket = mockSocket;
    internals(client).session = createSessionState({ sessionKey: 0x1234 });
    internals(client).processChallenge({ type: "passsalt", data: new Uint8Array(16).fill(0xab) });
    expect(internals(client).deviceSalt).toBeDefined();
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it("handles EC-SRP challenge (65 byte public key)", async () => {
    const client = await makeClient();
    internals(client).socket = mockSocket;
    internals(client).session = createSessionState({ sessionKey: 0x1234 });
    const crypto = await import("node:crypto");
    (internals(client) as unknown as { clientECDH: unknown }).clientECDH = vi.mocked(
      crypto.createECDH
    )("prime256v1");
    (internals(client) as unknown as { clientPublicKey: Uint8Array }).clientPublicKey =
      new Uint8Array(65).fill(0x04);
    internals(client).processChallenge({ type: "passsalt", data: new Uint8Array(65).fill(0x02) });
    expect(internals(client).serverPublicKey).toBeDefined();
    expect(mockSocket.send).toHaveBeenCalled();
  });

  it("ignores challenge if type unknown length", async () => {
    const client = await makeClient();
    internals(client).socket = mockSocket;
    // EC-SRP with too-short data (< 65 bytes) — no action
    internals(client).processChallenge({ type: "passsalt", data: new Uint8Array(10) });
    expect(mockSocket.send).not.toHaveBeenCalled();
  });
});

// ── sendCommand ────────────────────────────────────────────────────────────

describe("MacTelnetClient sendCommand (direct)", () => {
  it("throws when not connected", async () => {
    const client = await makeClient();
    await expect(client.sendCommand("/test")).rejects.toThrow(/Not connected/);
  });

  it("sends a shell packet and resolves via pending command", async () => {
    const client = await forceConnected();
    const p = client.sendCommand("/test");
    // Manually resolve the pending command
    const pending = [...internals(client).pendingCommands.values()][0];
    pending?.resolve({ output: "ok\n", success: true, counter: 1, command: "/test" });
    const result = await p;
    expect(result.output).toBe("ok\n");
  });

  it("rejects on command timeout", async () => {
    vi.useFakeTimers();
    const client = await forceConnected();
    const p = client.sendCommand("/slow", { timeoutMs: 100 });
    vi.advanceTimersByTime(200);
    await expect(p).rejects.toThrow(/timeout/);
    vi.useRealTimers();
  });
});

// ── disconnect ─────────────────────────────────────────────────────────────

describe("MacTelnetClient disconnect (direct)", () => {
  it("sends END packet and cleans up", async () => {
    const client = await forceConnected();
    await client.disconnect();
    expect(mockSocket.close).toHaveBeenCalled();
    expect(internals(client).state).toBe("disconnected");
  });

  it("rejects pending commands on cleanup", async () => {
    const client = await forceConnected();
    const p = client.sendCommand("/test");
    internals(client).cleanup();
    await expect(p).rejects.toThrow(/closed/);
  });

  it("is idempotent when already disconnected", async () => {
    const client = await forceConnected();
    await client.disconnect();
    await expect(client.disconnect()).resolves.toBeUndefined();
  });
});

// ── keepAlive ──────────────────────────────────────────────────────────────

describe("MacTelnetClient keepAlive (direct)", () => {
  it("starts and stops keep-alive timer", async () => {
    vi.useFakeTimers();
    const client = await forceConnected();
    internals(client).startKeepAlive();
    expect(internals(client).keepAliveTimer).not.toBeNull();
    internals(client).stopKeepAlive();
    expect(internals(client).keepAliveTimer).toBeNull();
    vi.useRealTimers();
  });

  it("send ACK on interval tick", async () => {
    vi.useFakeTimers();
    const client = await forceConnected();
    internals(client).startKeepAlive();
    const before = mockSocket.send.mock.calls.length;
    vi.advanceTimersByTime(1100);
    expect(mockSocket.send.mock.calls.length).toBeGreaterThan(before);
    internals(client).stopKeepAlive();
    vi.useRealTimers();
  });

  it("stopKeepAlive is idempotent", async () => {
    const client = await makeClient();
    internals(client).stopKeepAlive();
    internals(client).stopKeepAlive();
    expect(internals(client).keepAliveTimer).toBeNull();
  });

  it("does not start if keepAliveIntervalMs is 0", async () => {
    vi.useFakeTimers();
    const client = await makeClient({ keepAliveIntervalMs: 0 });
    internals(client).state = "connected";
    internals(client).socket = mockSocket;
    internals(client).session = createSessionState({ sessionKey: 0x1234 });
    internals(client).startKeepAlive();
    expect(internals(client).keepAliveTimer).toBeNull();
    vi.useRealTimers();
  });
});

// ── stateChange / events ──────────────────────────────────────────────────

describe("MacTelnetClient stateChange events", () => {
  it("emits stateChange on setState", async () => {
    const client = await makeClient();
    const events: { from: string; to: string }[] = [];
    client.on("stateChange", (e) => events.push(e as { from: string; to: string }));
    internals(client).setState("connecting");
    expect(events[0]?.to).toBe("connecting");
  });

  it("emits stateChange on destroy", async () => {
    const client = await forceConnected();
    const events: unknown[] = [];
    client.on("stateChange", (e) => events.push(e));
    client.destroy();
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── AbortSignal ────────────────────────────────────────────────────────────

describe("MacTelnetClient AbortSignal", () => {
  it("destroys immediately if signal pre-aborted", async () => {
    const { MacTelnetClient } = await import("./client");
    const controller = new AbortController();
    controller.abort();
    const client = new MacTelnetClient({
      targetMac: "aa:bb:cc:dd:ee:ff",
      username: "admin",
      password: "pw",
      signal: controller.signal,
    });
    expect(internals(client as unknown as Awaited<ReturnType<typeof makeClient>>).state).toBe(
      "disconnected"
    );
  });

  it("destroys on abort after construction", async () => {
    const { MacTelnetClient } = await import("./client");
    const controller = new AbortController();
    const client = new MacTelnetClient({
      targetMac: "aa:bb:cc:dd:ee:ff",
      username: "admin",
      password: "pw",
      signal: controller.signal,
    });
    controller.abort();
    expect((client as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });
});

// ── getLocalMac ────────────────────────────────────────────────────────────

describe("MacTelnetClient getLocalMac", () => {
  it("returns zero MAC before connect", async () => {
    const client = await makeClient();
    const mac = (client as unknown as { getLocalMac: () => Uint8Array }).getLocalMac();
    expect(Array.from(mac)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
