import net from "node:net";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as chr from "./chr";

describe("chrSkip", () => {
  const origChr = process.env.MIKROTIK_CHR_IMAGE;
  const origRun = process.env.RUN_CHR_INTEGRATION;

  beforeEach(() => {
    delete process.env.MIKROTIK_CHR_IMAGE;
    delete process.env.RUN_CHR_INTEGRATION;
  });

  afterEach(() => {
    process.env.MIKROTIK_CHR_IMAGE = origChr;
    process.env.RUN_CHR_INTEGRATION = origRun;
  });

  it("returns skip reason when no env vars set", () => {
    const reason = chr.chrSkip();
    expect(reason).toBeDefined();
    expect(reason).toContain("CHR integration");
  });

  it("returns undefined when MIKROTIK_CHR_IMAGE is set", () => {
    process.env.MIKROTIK_CHR_IMAGE = "mikrotik/chr:7.16";
    expect(chr.chrSkip()).toBeUndefined();
  });

  it("returns undefined when RUN_CHR_INTEGRATION is set", () => {
    process.env.RUN_CHR_INTEGRATION = "1";
    expect(chr.chrSkip()).toBeUndefined();
  });
});

describe("chrFixture", () => {
  it("returns setup and teardown functions", () => {
    const [setup, teardown] = chr.chrFixture();
    expect(typeof setup).toBe("function");
    expect(typeof teardown).toBe("function");
  });
});

describe("spinCHR smoke test", () => {
  // Only run when Docker + CHR image are available
  const skip = chr.chrSkip();
  if (skip) {
    it.skip("skipped — no CHR image configured", () => {});
  } else {
    it("spins a container and connects via TCP", async () => {
      const device = await chr.spinCHR();

      expect(device.host).toBe("127.0.0.1");
      expect(device.port).toBeGreaterThan(0);
      expect(device.port).toBeLessThan(65535);
      expect(device.user).toBe("admin");
      expect(device.containerId).toMatch(/^chr-test-/);
      expect(device.version).toBeDefined();

      // Verify TCP port is actually open
      const connected = await new Promise<boolean>((resolve) => {
        const sock = net.createConnection({ host: device.host, port: device.port });
        sock.once("connect", () => {
          sock.destroy();
          resolve(true);
        });
        sock.once("error", () => {
          sock.destroy();
          resolve(false);
        });
      });
      expect(connected).toBe(true);

      await device.dispose();
    }, 90_000);
  }
});
