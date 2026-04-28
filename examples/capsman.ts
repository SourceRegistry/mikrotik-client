/**
 * CAPsMan (Controlled Access Point System Manager) example.
 *
 * Demonstrates full CRUD operations for CAPsMan wireless configuration:
 * configurations, security profiles, channel profiles, datapaths,
 * provisioning rules, and interface management.
 *
 * Requires a MikroTik device with CAPsMan packages installed.
 */

import { RouterOSClient } from "../src/routeros";
import type { RouterOSRecord } from "../src/routeros";

async function main() {
  const client = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: process.env.MIKROTIK_USERNAME ?? "admin",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    tls: process.env.MIKROTIK_TLS === "true",
    ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
  });

  try {
    // ── Configuration ──────────────────────────────────────────────────
    console.log("=== CAPsMan Configuration ===");

    const capsManApi = client.api["caps-man"];
    if (!capsManApi?.configuration || !capsManApi?.channel) {
      console.log("CAPsMan API not available on this device.");
      return;
    }

    const configs: RouterOSRecord[] = await capsManApi.configuration.print();
    console.log(`Configurations: ${configs.length}`);

    // List channel profiles
    const channels: RouterOSRecord[] = await capsManApi.channel.print();
    console.log(`Channel profiles: ${channels.length}`);

    for (const ch of channels) {
      console.log(`  ${ch.name ?? "(unnamed)"} — band: ${ch.band ?? "?"}`);
    }

    // List security profiles
    const securityApi = capsManApi["security-profiles"];
    if (!securityApi) {
      console.log("Security profiles API not available.");
    } else {
      const security: RouterOSRecord[] = await securityApi.print();
      console.log(`Security profiles: ${security.length}`);

      for (const sec of security) {
        console.log(`  ${sec.name ?? "(unnamed)"} — WPA2: ${sec["wpa2-psk"] ? "set" : "not set"}`);
      }
    }

    // ── Datapath ───────────────────────────────────────────────────────
    console.log("\n=== CAPsMan Datapath ===");

    if (capsManApi.datapath) {
      const datapaths: RouterOSRecord[] = await capsManApi.datapath.print();
      console.log(`Datapath profiles: ${datapaths.length}`);

      for (const dp of datapaths) {
        console.log(`  ${dp.name ?? "(unnamed)"} — bridge: ${dp["bridge-mode"] ?? "?"}`);
      }
    } else {
      console.log("Datapath API not available.");
    }

    // ── Interfaces ─────────────────────────────────────────────────────
    console.log("\n=== CAPsMan Interfaces ===");

    if (capsManApi.interface) {
      const capsmanIfaces: RouterOSRecord[] = await capsManApi.interface.print();
      console.log(`CAPsMan interfaces: ${capsmanIfaces.length}`);
    } else {
      console.log("Interface API not available.");
    }

    // ── Manager interface ──────────────────────────────────────────────
    console.log("\n=== CAPsMan Manager Interface ===");

    const managerApi = capsManApi.manager;
    if (!managerApi) {
      console.log("Manager API not available.");
    } else if (managerApi.interface) {
      const mgrIface: RouterOSRecord[] = await managerApi.interface.print();
      console.log(`Manager interfaces: ${mgrIface.length}`);
    } else {
      console.log("Manager interface API not available.");
    }

    console.log("\nDone.");
  } finally {
    await client.close();
  }
}

void main();
