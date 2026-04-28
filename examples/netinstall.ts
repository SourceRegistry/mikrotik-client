/**
 * Netinstall example.
 *
 * Demonstrates the Netinstall protocol for reflashing RouterOS devices.
 * Netinstall uses BOOTP for device discovery and TFTP for image delivery.
 *
 * ⚠️  WARNING: This is a DESTRUCTIVE operation. It will erase all data
 * on the target device. Only use in controlled environments.
 *
 * Requirements:
 * - The target device must be in netinstall mode (button press on boot)
 * - Local interface must be on the same Layer 2 network
 * - A RouterOS netinstall binary image file
 *
 * Environment variables:
 * - NETINSTALL_IMAGE: path to .npk image file
 * - NETINSTALL_DEVICE_MAC: target device MAC (optional, auto-discover if omitted)
 * - LOCAL_IP: static IP to assign to local interface (e.g., 192.168.88.1)
 */

import { NetinstallSession } from "../src/netinstall";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

async function main() {
  // ── Configuration ─────────────────────────────────────────────────────
  const imageDir = process.env.NETINSTALL_IMAGE_DIR || join(os.homedir(), "Downloads");
  const imageName = process.env.NETINSTALL_IMAGE_NAME || "netinstall-7";
  const deviceMac = process.env.NETINSTALL_DEVICE_MAC;
  const serverIp = process.env.NETINSTALL_SERVER_IP || "192.168.88.1";

  console.log("=== Netinstall Demo ===\n");

  // ── Step 1: Locate the image ──────────────────────────────────────────
  const imageBuffer = findImage(imageDir, imageName);
  if (!imageBuffer) {
    console.log(`Netinstall image not found in ${imageDir}`);
    console.log("Set NETINSTALL_IMAGE_DIR and NETINSTALL_IMAGE_NAME");
    console.log("\nTo use netinstall in production:");
    console.log("  1. Put the device in netinstall mode (button on boot)");
    console.log("  2. Download the netinstall binary from MikroTik");
    console.log("  3. Run the session from above");
  } else {
    console.log(`Image loaded: ${imageBuffer.length} bytes`);
    console.log(`Server IP: ${serverIp}`);
    console.log(`Target MAC: ${deviceMac ?? "(auto-discover)"}`);

    // ── Step 2: Create session ──────────────────────────────────────────
    // ⚠️  This actually reflashes the device. Only run with a real device!
    // const session = new NetinstallSession({
    //   imageBuffer,
    //   serverIp,
    //   ... (deviceMac ? { deviceMac } : {}),
    // });

    // session.on("progress", (evt) => {
    //   console.log(`[progress] ${evt.kind}: ${evt.message}`);
    // });

    // session.on("bootp", (evt) => {
    //   console.log(`[bootp] Device discovered: ${evt.mac}`);
    // });

    // session.on("tftp", (evt) => {
    //   console.log(`[tftp] ${evt.kind}: ${evt.bytesTransferred}/${evt.totalBytes}`);
    // });

    // try {
    //   await session.start();
    //   console.log("Install complete!");
    // } catch (err) {
    //   console.error("Install failed:", err);
    // }

    console.log("\nNetinstall session creation shown (commented out for safety).");
    console.log("Uncomment and set environment variables to flash a real device.");
  }

  console.log("\nDone.");
}

/**
 * Helper to find the netinstall image file in a directory.
 */
function findImage(dir: string, name: string): Buffer | null {
  try {
    const path = join(dir, name);
    return readFileSync(path);
  } catch {
    return null;
  }
}

void main();
