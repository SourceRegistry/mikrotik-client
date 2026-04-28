/**
 * MAC-Telnet example.
 *
 * Demonstrates the MAC-Telnet (Layer 2) protocol client for MikroTik devices.
 * MAC-Telnet communicates over UDP port 20561 using standard network interfaces
 * (no privileged socket required).
 *
 * Use cases: initial device setup, password recovery when SSH/API are disabled,
 * rapid-deploy integration with powerful switches.
 *
 * Note: MAC-Telnet requires the local interface to be on the SAME Layer 2
 * broadcast domain as the target device.
 */

import { MacTelnetClient, listNetworkInterfaces } from "../src/mac-telnet";

async function main() {
  // ── Step 1: List local interfaces ──────────────────────────────────────
  console.log("=== Step 1: Local Network Interfaces ===\n");

  const interfaces = listNetworkInterfaces();
  console.log(`Found ${interfaces.length} interface(s):\n`);

  for (const iface of interfaces) {
    console.log(`  ${iface.name} (${iface.type})`);
    console.log(`    MAC: ${iface.mac}`);
    console.log(`    Up: ${iface.isUp}`);
    for (const addr of iface.addresses) {
      console.log(`    ${addr.family}: ${addr.address}`);
    }
    console.log("");
  }

  // ── Step 2: Connect via MAC-Telnet ─────────────────────────────────────
  console.log("=== Step 2: MAC-Telnet Connection ===\n");

  // Target device MAC — required for MAC-Telnet (no IP needed!)
  const targetMac = process.env.MAC_TELNET_TARGET_MAC;
  const username = process.env.MAC_TELNET_USERNAME || "admin";
  const password = process.env.MAC_TELNET_PASSWORD || "";

  if (!targetMac) {
    console.log("Set MAC_TELNET_TARGET_MAC to connect (e.g., aa:bb:cc:dd:ee:ff)");
    console.log("Skipping connection demo.\n");
    console.log("Note: MAC-Telnet examples are informational without a live device.");
  } else {
    console.log(`Target MAC: ${targetMac}`);
    console.log(`Username: ${username}`);
    console.log("");

    // Parse and validate the target MAC
    // parseMac returns false for invalid formats, or the normalized MAC string
    // e.g., "aa:bb:cc:dd:ee:ff" → "aa:bb:cc:dd:ee:ff"

    // Create client with auth type
    const client = new MacTelnetClient({
      targetMac,
      username,
      password,
      ...(process.env.LOCAL_INTERFACE ? { interfaceName: process.env.LOCAL_INTERFACE } : {}),
      authType: process.env.MAC_TELNET_AUTH_TYPE === "md5" ? "md5" : "ec-srp",
    });

    try {
      // Connect (runs the EC-SRP or MD5 auth handshake)
      await client.connect();
      console.log("Connected!");

      // Send a command
      const result = await client.sendCommand("/system/resource/print");
      console.log(`Output:\n${result}`);

      // Disconnect
      await client.disconnect();
      console.log("Disconnected cleanly.");
    } catch (err) {
      console.error("Connection failed:", err);
      console.log("(Expected if no MikroTik device is on the same L2 network)");
    }
  }

  console.log("\nDone.");
}

void main();
