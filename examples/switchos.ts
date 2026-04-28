/**
 * SwitchOS client example.
 *
 * Demonstrates `SwitchOSClient` — HTTP digest-auth client for MikroTik SwOS
 * web UI endpoints. SwitchOS does not expose a publicly documented CLI, but
 * the web UI uses stable `.b` endpoints with digest authentication.
 *
 * Typical flow:
 * 1. Read system info via `read("/sys.b")`
 * 2. Read/write VLANs via `write("/vlan.b", ...)`
 * 3. Trigger actions like reboot via `action("/reboot")`
 *
 * For encoding helpers (hex, IP, MAC, bitmask), see the decode functions below.
 */

import {
    SwitchOSClient,
    decodeSwitchOSHexString,
    decodeSwitchOSIpv4,
    decodeSwitchOSMac,
    decodeSwitchOSBitmask,
    encodeSwitchOSIpv4,
    encodeSwitchOSMac,
    encodeSwitchOSBitmask,
} from "../src/switchos";

async function main() {
    const host = process.env.MIKROTIK_HOST ?? "192.168.88.2";
    const port = process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : 80;
    const baseUrl = `http://${host}${port !== 80 ? `:${port}` : ""}`;

    const client = new SwitchOSClient({
        baseUrl,
        username: process.env.MIKROTIK_USERNAME ?? "admin",
        password: process.env.MIKROTIK_PASSWORD ?? "",
    });

    try {
        // ── Read system info ─────────────────────────────────────────────
        console.log("=== System Info ===");
        const sys = await client.read<{
            id: string; // Hex-encoded identity
            ip: number; // Integer-encoded IPv4
            mask: number; // Integer-encoded subnet mask
            gateway: number;
            mac: number; // MAC as integer
            uptime: number;
        }>("/sys.b");

        console.log("Identity:", decodeSwitchOSHexString(sys.id ?? ""));
        console.log("IP:", decodeSwitchOSIpv4(sys.ip ?? 0));
        console.log("Gateway:", decodeSwitchOSIpv4(sys.gateway ?? 0));

        // ── Encoding/decoding helpers ────────────────────────────────────
        console.log("\n=== Encoding Helpers ===");
        console.log("IPv4 encode/decode:", {
            ip: "192.168.1.1",
            encoded: encodeSwitchOSIpv4("192.168.1.1"),
            decoded: decodeSwitchOSIpv4(encodeSwitchOSIpv4("192.168.1.1")),
        });
        console.log("MAC encode/decode:", {
            mac: "aa:bb:cc:dd:ee:ff",
            encoded: encodeSwitchOSMac("aa:bb:cc:dd:ee:ff"),
        });
        console.log("Bitmask encode/decode:", {
            indices: [0, 1, 2, 5],
            encoded: encodeSwitchOSBitmask([0, 1, 2, 5]),
            decoded: decodeSwitchOSBitmask(encodeSwitchOSBitmask([0, 1, 2, 5])),
        });

        // ── Read VLAN configuration ──────────────────────────────────────
        console.log("\n=== VLAN Configuration ===");
        const vlans = await client.read<
            Array<{
                vid: number;
                nm: string; // Hex-encoded VLAN name
                mbr: number; // Bitmask of member ports
            }>
        >("/vlan.b");

        for (const vlan of vlans) {
            const vlanName = decodeSwitchOSHexString(vlan.nm);
            const members = decodeSwitchOSBitmask(vlan.mbr);
            console.log(`  VLAN ${vlan.vid}: ${vlanName} (ports: ${members.join(", ")})`);
        }

        // ── Write VLAN configuration ─────────────────────────────────────
        console.log("\n=== Write VLAN Example (commented out) ===");
        console.log("To add a VLAN, uncomment the following:");
        console.log(`
  await client.write("/vlan.b", [
    { vid: 10, nm: "657465723120766c616e", mbr: 0x03 }, // "ether1 vlan" on ports 0,1
  ]);
    `);

        // ── Action endpoints ─────────────────────────────────────────────
        console.log("=== Action Example (reboot) ===");
        console.log("To reboot the device, call:");
        console.log('  await client.action("/reboot");');

        // ── Schema inspection ───────────────────────────────────────────
        console.log("\n=== Schema Inspection ===");
        const endpoints = client.listEndpoints();
        console.log("Available endpoints:", endpoints.slice(0, 10));

        if (endpoints.length > 0) {
            const schema = client.getEndpointSchema(endpoints[0] ?? "");
            console.log(`Schema for ${endpoints[0]}:`, {
                sections: schema?.sections?.length ?? 0,
            });
        }
    } finally {
        console.log("\nDone.");
    }
}

void main();
