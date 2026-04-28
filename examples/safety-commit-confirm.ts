/**
 * Safety primitives example.
 *
 * Demonstrates `commitConfirm`, `atomicScript`, and backup helpers from
 * the safety module. These wrap mutations with automatic rollback if you
 * don't confirm within a time window.
 *
 * ⚠️  This example makes REAL CHANGES to your device. Test with caution.
 */

import { RouterOSClient } from "../src/routeros";
import {
  commitConfirm,
  atomicScript,
  saveBackup,
  removeBackup,
  listBackups,
} from "../src/safety";

async function main() {
  const client = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: process.env.MIKROTIK_USERNAME ?? "admin",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    tls: process.env.MIKROTIK_TLS === "true",
    ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
  });

  try {
    // ── Backup helpers ──────────────────────────────────────────────
    console.log("=== Backup Operations ===");

    // List existing backups
    const existingBackups = await listBackups(client, "example");
    console.log(`Existing backups (prefix "example"): ${existingBackups.length}`);

    // Save a backup
    await saveBackup(client, "example-before-changes");
    console.log("Saved backup: example-before-changes.rsc");

    // ── commitConfirm ───────────────────────────────────────────────
    console.log("\n=== commitConfirm ===");
    console.log("Wrapping IP address change with commit-confirm...");

    const handle = await commitConfirm({
      transport: client,
      windowSeconds: 300, // 5 minutes to confirm
      backupName: "cc-example",
      async fn(transport) {
        // This runs inside the safety window:
        // 1. A backup was taken before this function runs
        // 2. An auto-revert scheduler was created
        // 3. If you don't call handle.confirm() within 300s, the device auto-reverts
        await transport.execute("/ip/address/add", {
          attributes: {
            address: "192.168.200.1/24",
            interface: "ether2",
            comment: "commit-confirm example",
          },
        });
        console.log("Mutation applied: added 192.168.200.1/24");
      },
      ...(process.env.MIKROTIK_TIMEOUT_MS ? { timeoutMs: Number(process.env.MIKROTIK_TIMEOUT_MS) } : {}),
    });

    console.log(`Transaction ${handle.txid} — confirms within ${300}s`);
    console.log(`Call handle.confirm() to accept, handle.rollback() to revert.`);

    // Confirm the changes (accept them)
    await handle.confirm();
    console.log("Confirmed — changes are permanent.");

    // Rollback example (commented out):
    // await handle.rollback();
    // console.log("Rolled back — device restored to previous state.");

    // ── atomicScript ────────────────────────────────────────────────
    console.log("\n=== atomicScript ===");
    console.log("Running a script atomically with commit-confirm...");

    const scriptHandle = await atomicScript(client, {
      windowSeconds: 300,
      script: `
/ip firewall filter add chain=input action=accept comment="atomic example rule"
/system note set comment="modified by atomicScript example"
      `,
    });

    console.log(`Script executed atomically — transaction ${scriptHandle.txid}`);
    await scriptHandle.confirm();
    console.log("Confirmed.");

    // ── Unsafe direct apply ─────────────────────────────────────────
    console.log("\n=== unsafeDirectApply (skip safety wrapper) ===");
    console.log(
      "Set unsafeDirectApply: true to skip commit-confirm entirely."
    );
    console.log("(Commented out for safety — uncomment to enable)");
    // const unsafeHandle = await commitConfirm({
    //   transport: client,
    //   unsafeDirectApply: true, // No backup, no auto-revert!
    //   async fn(transport) { ... },
    // });
    // console.log("Applied without safety wrapper.");

  } finally {
    await client.close();
    console.log("\nDone.");
  }
}

void main();
