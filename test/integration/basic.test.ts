import net from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spinCHR, chrSkip } from "../harness/chr";
import type { TestDevice } from "../harness/chr";

const skipDescription = chrSkip();

const run = skipDescription ? describe.skip : describe;

run("integration: CHR basics", () => {
  let device: TestDevice;

  beforeAll(async () => {
    device = await spinCHR();
  }, 60_000);

  afterAll(async () => {
    await device.dispose();
  }, 30_000);

  it("connects via TCP on the published port", async () => {
    const connected = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host: device.host, port: device.port });
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });

    expect(connected).toBe(true);
  });

  it("exposes container metadata", () => {
    expect(device.containerId).toBeTruthy();
    expect(typeof device.containerId).toBe("string");
    expect(device.host).toBe("127.0.0.1");
    expect(typeof device.port).toBe("number");
    expect(device.port).toBeGreaterThan(0);
    expect(device.user).toBe("admin");
    expect(typeof device.pass).toBe("string");
  });

  it("snapshot and restore methods are available on TestDevice", () => {
    expect(typeof device.snapshot).toBe("function");
    expect(typeof device.restore).toBe("function");
  });
});
