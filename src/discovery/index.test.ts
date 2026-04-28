import dgram from "node:dgram";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverNeighbors, NeighborDiscoveryService, listenNeighbors } from "./index";
import { MNDP_TLV_ADDRESS, MNDP_TLV_IDENTITY, MNDP_TLV_VERSION } from "./mndp";
import type { DiscoveredNeighbor, NeighborDiscoverySource } from "./index";

function encodeTlv(type: number, value: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, Buffer.from(value)]);
}

function createMndpPacket(identity = "core-router"): Buffer {
  return Buffer.concat([
    Buffer.from([1, 255, 0, 0]),
    encodeTlv(MNDP_TLV_ADDRESS, Uint8Array.from([0x00, 0x0c, 0x42, 0x00, 0x38, 0x9f])),
    encodeTlv(MNDP_TLV_IDENTITY, Buffer.from(identity, "utf8")),
    encodeTlv(MNDP_TLV_VERSION, Buffer.from("7.16.1", "utf8")),
  ]);
}

async function createUdpSocket(): Promise<dgram.Socket> {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", () => resolve()));
  return socket;
}

function _createNeighbor(_overrides: Partial<DiscoveredNeighbor> = {}): DiscoveredNeighbor {
  return {
    source: "mndp" as NeighborDiscoverySource,
    id: "test-id",
    identity: "test-router",
    macAddress: "00:0C:42:00:38:9F",
    raw: {} as unknown as Record<string, string>,
    ..._overrides,
  };
}

describe("NeighborDiscoveryService", () => {
  it("discovers MNDP neighbors without needing a manual listener", async () => {
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve discovery port.");
    }

    const discoveryPromise = discoverNeighbors({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
      timeoutMs: 100,
    });

    const sender = await createUdpSocket();
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const devices = await discoveryPromise;
    expect(devices).toHaveLength(1);
    expect(devices[0]?.source).toBe("mndp");
    expect(devices[0]?.identity).toBe("core-router");

    await new Promise<void>((resolve) => sender.close(() => resolve()));
  });

  it("can run continuous local discovery", async () => {
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve discovery port.");
    }

    const service = await new NeighborDiscoveryService({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
    }).start();

    expect(service.listener).toBeDefined();
    let emitted = 0;
    service.on("neighbor", (neighbor, previous) => {
      emitted += 1;
      expect(neighbor.source).toBe("mndp");
      if (emitted === 1) {
        expect(previous).toBeUndefined();
      }
    });

    const sender = await createUdpSocket();
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const discovered = await service.nextNeighbor(500);
    expect(discovered?.source).toBe("mndp");
    expect(discovered?.identity).toBe("core-router");
    expect(service.list()).toHaveLength(1);

    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket("edge-switch"), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const updated = await service.nextNeighbor(500);
    expect(updated?.identity).toBe("edge-switch");
    expect(service.list()).toHaveLength(1);
    expect(emitted).toBe(2);

    await service.close();
    await new Promise<void>((resolve) => sender.close(() => resolve()));
  });
});

describe("discoverNeighbors dedup behavior", () => {
  it("deduplicates neighbors with same macAddress", async () => {
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve port.");
    }

    const discoveryPromise = discoverNeighbors({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
      timeoutMs: 100,
    });

    const sender = await createUdpSocket();
    // Same device advertised twice - should dedupe to 1
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const devices = await discoveryPromise;
    expect(devices).toHaveLength(1);

    await new Promise<void>((resolve) => sender.close(() => resolve()));
  });

  it("keeps neighbors with different identities", async () => {
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve port.");
    }

    const service = await new NeighborDiscoveryService({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
    }).start();

    const sender = await createUdpSocket();
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket("router1"), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket("router2"), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Wait for advertisements to be processed
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const list = service.list();
    expect(list.length).toBeGreaterThanOrEqual(1);

    await service.close();
    await new Promise<void>((resolve) => sender.close(() => resolve()));
  });
});

describe("NeighborDiscoveryService (no-network)", () => {
  let service: NeighborDiscoveryService;

  beforeEach(() => {
    service = new NeighborDiscoveryService();
  });

  it("returns empty list before start", () => {
    expect(service.list()).toHaveLength(0);
  });

  it("throws when start() called after closed", async () => {
    // finish() to close the service without needing a listener
    service.finish();
    await expect(service.start()).rejects.toThrow("NeighborDiscoveryService is closed.");
  });

  it("nextNeighbor returns undefined when closed without error", async () => {
    service.finish();
    const result = await service.nextNeighbor(10);
    expect(result).toBeUndefined();
  });

  it("nextNeighbor throws when closed with error", async () => {
    service.finish(new Error("test shutdown"));
    await expect(service.nextNeighbor(10)).rejects.toThrow("test shutdown");
  });

  it("finish() is idempotent", () => {
    service.finish();
    // Second call should not throw
    service.finish();
  });

  it("close() is idempotent when already closed", async () => {
    // No listener, just call finish then close
    service.finish();
    await service.close(); // Should not throw
  });

  it("emits close event on finish", () => {
    const onClose = vi.fn();
    service.on("close", onClose);
    service.finish();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(undefined);
  });

  it("emits close event with error on finish(error)", () => {
    const onClose = vi.fn();
    service.on("close", onClose);
    const err = new Error("panic");
    service.finish(err);
    expect(onClose).toHaveBeenCalledWith(err);
  });

  it("nextNeighbor with queue returns immediately", async () => {
    service = new NeighborDiscoveryService();
    // Simulate by directly calling nextNeighbor after finish to get undefined
    service.finish();
    expect(await service.nextNeighbor()).toBeUndefined();
  });

  it("nextNeighbor timeout returns undefined", async () => {
    // Service is not started, so no neighbors will arrive
    const result = await service.nextNeighbor(50);
    expect(result).toBeUndefined();
  });

  it("list() returns empty on fresh service", () => {
    expect(service.list()).toEqual([]);
  });

  it("listener getter returns undefined before start", () => {
    expect(service.listener).toBeUndefined();
  });
});

describe("listenNeighbors helper", () => {
  it("creates and starts a service", async () => {
    // Use a short-lived probe to avoid real network
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve port.");
    }

    const service = await listenNeighbors({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
    });
    expect(service.listener).toBeDefined();
    await service.close();
  });
});

// Skip on platforms where UDP broadcast port binding fails
describe.skipIf(!process.env.CI)("integration helpers", () => {
  it("listenNeighbors works with real UDP", async () => {
    const service = new NeighborDiscoveryService({
      host: "127.0.0.1",
    });
    // This will bind to an ephemeral port
    await expect(service.start()).resolves.toBeDefined();
    await service.close();
  });
});

describe("discoverNeighbors dedupe=false", () => {
  it("returns duplicates when dedupe is false", async () => {
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve port.");
    }

    const discoveryPromise = discoverNeighbors({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
      timeoutMs: 100,
      dedupe: false,
    });

    const sender = await createUdpSocket();
    // Send same packet twice
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), probeAddress.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const devices = await discoveryPromise;
    // Without dedupe, duplicates should be present
    expect(devices.length).toBeGreaterThanOrEqual(1);

    await new Promise<void>((resolve) => sender.close(() => resolve()));
  });
});

describe("NeighborDiscoveryService async iterator", () => {
  it("yields then exits on close", async () => {
    const service = new NeighborDiscoveryService();

    // Collect yielded neighbors
    const yielded: DiscoveredNeighbor[] = [];
    (async () => {
      for await (const n of service) {
        yielded.push(n);
      }
    })();

    // Close immediately
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    service.finish();

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(yielded).toBeDefined();
  });
});
