import dgram from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverMNDP,
  listenMNDP,
  MNDP_TLV_ADDRESS,
  MNDP_TLV_HARDWARE,
  MNDP_TLV_IDENTITY,
  MNDP_TLV_INTERFACE_NAME,
  MNDP_TLV_PLATFORM,
  MNDP_TLV_SOFT_ID,
  MNDP_TLV_TIMESTAMP,
  MNDP_TLV_VERSION,
  parseMNDPPacket,
  toMNDPAdvertisement,
} from "./mndp";

function encodeTlv(type: number, value: Uint8Array): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, Buffer.from(value)]);
}

function encodeString(value: string): Uint8Array {
  return Buffer.from(value, "utf8");
}

function encodeUptime(value: number): Uint8Array {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function createMndpPacket(): Buffer {
  const header = Buffer.from([1, 255, 0, 0]);
  return Buffer.concat([
    header,
    encodeTlv(MNDP_TLV_ADDRESS, Uint8Array.from([0x00, 0x0c, 0x42, 0x00, 0x38, 0x9f])),
    encodeTlv(MNDP_TLV_IDENTITY, encodeString("core-router")),
    encodeTlv(MNDP_TLV_VERSION, encodeString("7.16.1")),
    encodeTlv(MNDP_TLV_PLATFORM, encodeString("MikroTik")),
    encodeTlv(MNDP_TLV_TIMESTAMP, encodeUptime(86461)),
    encodeTlv(MNDP_TLV_SOFT_ID, encodeString("mikrotik-client")),
    encodeTlv(MNDP_TLV_HARDWARE, encodeString("RB5009UG+S+")),
    encodeTlv(MNDP_TLV_INTERFACE_NAME, encodeString("ether1")),
  ]);
}

async function createUdpSocket(): Promise<dgram.Socket> {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", () => resolve()));
  return socket;
}

describe("MNDP discovery", () => {
  const sockets = new Set<dgram.Socket>();

  afterEach(async () => {
    await Promise.all(
      [...sockets].map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.close(() => resolve());
          })
      )
    );
    sockets.clear();
  });

  it("parses MNDP packets into typed advertisements", () => {
    const packet = parseMNDPPacket(new Uint8Array(createMndpPacket()));
    const advertisement = toMNDPAdvertisement(packet, {
      address: "192.168.88.1",
      port: 5678,
      family: "IPv4",
    });

    expect(packet.version).toBe(1);
    expect(advertisement.macAddress).toBe("00:0c:42:00:38:9f");
    expect(advertisement.identity).toBe("core-router");
    expect(advertisement.versionString).toBe("7.16.1");
    expect(advertisement.platform).toBe("MikroTik");
    expect(advertisement.uptimeSeconds).toBe(86461);
    expect(advertisement.softId).toBe("mikrotik-client");
    expect(advertisement.hardware).toBe("RB5009UG+S+");
    expect(advertisement.interfaceName).toBe("ether1");
  });

  it("listens for MNDP advertisements", async () => {
    const listener = await listenMNDP({
      port: 0,
      host: "127.0.0.1",
      request: false,
    });

    const address = listener.socket.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind MNDP listener.");
    }

    const sender = await createUdpSocket();
    sockets.add(sender);

    await new Promise<void>((resolve, reject) => {
      sender.send(createMndpPacket(), address.port, "127.0.0.1", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const advertisement = await listener.nextAdvertisement(500);
    expect(advertisement?.identity).toBe("core-router");
    expect(advertisement?.remoteAddress).toBe("127.0.0.1");

    await listener.close();
  });

  it("discovers and deduplicates advertisements over a timeout window", async () => {
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve discovery port.");
    }

    const discoveryPromise = discoverMNDP({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: false,
      timeoutMs: 100,
    });

    const sender = await createUdpSocket();
    sockets.add(sender);

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

    const advertisements = await discoveryPromise;
    expect(advertisements).toHaveLength(1);
    expect(advertisements[0]?.identity).toBe("core-router");
  });

  it("can keep requesting discovery on an interval", async () => {
    let requests = 0;
    const probe = await createUdpSocket();
    const probeAddress = probe.address();
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    if (!probeAddress || typeof probeAddress === "string") {
      throw new Error("Failed to reserve discovery port.");
    }

    const listener = await listenMNDP({
      port: probeAddress.port,
      host: "127.0.0.1",
      request: true,
      requestIntervalMs: 20,
      broadcastAddress: "127.0.0.1",
      socketFactory: () => {
        const socket = dgram.createSocket("udp4");
        const originalSend = socket.send.bind(socket);
        socket.send = ((...args: Parameters<typeof socket.send>) => {
          requests += 1;
          return originalSend(...args);
        }) as typeof socket.send;
        return socket;
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Expected repeated MNDP requests.")), 120);
      const check = setInterval(() => {
        if (requests >= 2) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 10);
    });

    await listener.close();
  });
});
