/**
 * RouterOS SSH client example.
 *
 * Demonstrates `RouterOSSshClient` — executes RouterOS commands through the
 * local OpenSSH client binary. This is useful when you need to authenticate
 * with SSH keys or want to leverage existing SSH configuration (known_hosts,
 * proxy jumps, etc.).
 *
 * Requires:
 * - `ssh` binary available in PATH
 * - SSH service enabled on the RouterOS device (`/ip/service` → `ssh`)
 * - SSH key or password authentication configured
 */

import { RouterOSSshClient } from "../src/routeros";

async function main() {
  const host = process.env.MIKROTIK_HOST ?? "192.168.88.1";
  const username = process.env.MIKROTIK_USERNAME ?? "admin";
  const port = process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : 22;
  const identityFile = process.env.MIKROTIK_SSH_KEY;

  // Create SSH client with key-based auth (or password if key is not provided)
  const client = new RouterOSSshClient({
    host,
    username,
    port,
    ...(identityFile !== undefined ? { identityFile } : {}),
    // Alternatively, for password auth with sshpass:
    // extraArgs: ["-o", "PasswordAuthentication=yes"],
    // Or to skip host key checking (not recommended for production):
    // strictHostKeyChecking: false,
  });

  console.log(`Connecting to ${username}@${host}:${port} via SSH...`);

  try {
    // ── Execute simple commands ──────────────────────────────────────

    // Get system resource info
    const resourceResult = await client.execute("/system/resource/print", {
      attributes: {
        ".proplist": ["uptime", "version", "cpu-load"],
      },
    });
    console.log("=== System Resource ===");
    console.log(resourceResult.stdout);

    // Get identity
    const identityResult = await client.execute("/system/identity/print");
    console.log("\n=== Identity ===");
    console.log(identityResult.stdout);

    // ── Export configuration ─────────────────────────────────────────

    // Export current config (useful for backup or IR parsing)
    console.log("\n=== Running /export (first 50 lines) ===");
    const exportResult = await client.execute("/export");
    const lines = exportResult.stdout.split("\n").slice(0, 50);
    console.log(lines.join("\n"));
    console.log("... (truncated)");

    // ── Batch execution via stdin ────────────────────────────────────

    // Multiple commands can be piped through stdin
    const batchCommands = `
/system identity print
/ip address print
/interface print
    `.trim();

    console.log("\n=== Batch command execution ===");
    const batchResult = await client.execute("/system/script/run", {
      stdin: batchCommands,
      timeoutMs: 30_000,
    });
    console.log(batchResult.stdout || batchResult.stderr);

  } catch (error) {
    console.error("SSH command failed:", error);
    process.exitCode = 1;
  }
}

void main();
