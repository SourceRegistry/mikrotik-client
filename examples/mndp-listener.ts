/**
 * Discovery example.
 *
 * Demonstrates MNDP (MikroTik Neighbor Discovery Protocol) for finding
 * devices on Layer 2 networks via UDP broadcast on port 5678.
 *
 * No authentication required — MNDP is a broadcast protocol.
 */

import { discoverMNDP, listenMNDP, type MNDPAdvertisement } from "../src/discovery";

async function main() {
  // ── discoverMNDP — one-shot broadcast ──────────────────────────────
  console.log("=== One-Shot Discovery ===\n");
  console.log("Broadcasting MNDP request...");

  const timeoutSeconds = Number(process.env.MNDP_TIMEOUT_SECS) || 5;
  const neighbors = await discoverMNDP({
    timeoutMs: timeoutSeconds * 1000,
  });

  console.log(`Found ${neighbors.length} device(s):\n`);

  for (const n of neighbors) {
    console.log(`  Identity: ${n.identity ?? "(unknown)"}`);
    console.log(`  MAC:      ${n.macAddress ?? "?"}`);
    console.log(`  Version:  ${n.versionString ?? "?"}`);
    console.log(`  Platform: ${n.platform ?? "?"}`);
    console.log(`  Interface: ${n.interfaceName ?? "?"}`);
    console.log("");
  }

  // ── listenMNDP — continuous listener ─────────────────────────────
  console.log("=== Continuous Listener ===\n");
  console.log("Listening for MNDP advertisements for 5 seconds...");

  const listener = await listenMNDP({
    broadcastAddress: process.env.MNDP_BROADCAST || "255.255.255.255",
  });

  listener.on("advertisement", (adv: MNDPAdvertisement) => {
    console.log(`[NEW] ${adv.identity ?? "?"} (${adv.macAddress ?? "?"}) — ${adv.versionString ?? "?"}`);
  });

  listener.on("close", (err) => {
    console.log(`\nListener closed: ${err ? "error" : "normal"}`);
  });

  // Run for 5 seconds then stop
  setTimeout(() => {
    console.log("\nStopping listener (5s elapsed)...");
    listener.close();
  }, 5000);

  // Iterate (backpressure-aware) or just wait for the close
  // for await (const adv of listener) { ... }

  console.log("Listener started. Waiting...");

  console.log("\nDone.");
}

void main();
