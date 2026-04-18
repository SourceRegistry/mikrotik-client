import dgram from "node:dgram";
import { describe, expect, it } from "vitest";
import { discoverNeighbors, NeighborDiscoveryService } from "./index";
import {
  MNDP_TLV_ADDRESS,
  MNDP_TLV_IDENTITY,
  MNDP_TLV_VERSION,
} from "./mndp";

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
