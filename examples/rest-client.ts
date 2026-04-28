/**
 * RouterOS REST API v7 client example.
 *
 * Demonstrates `RouterOSRestClient` — an HTTP-based transport that implements
 * the same `DeviceTransport` interface as the binary API client. This means
 * typed helpers (`createRouterOSHelpers`) work identically with both transports.
 *
 * Requires RouterOS v7 with the REST API enabled (`/ip/service`).
 */

import { RouterOSRestClient, createRouterOSHelpers, type DeviceTransport } from "../src/routeros";

function createClient(): RouterOSRestClient {
    // For self-signed certificates, use a custom fetch with undici:
    //
    //   import { Agent, fetch as undiciFetch } from "undici";
    //   const client = new RouterOSRestClient({
    //     baseUrl: "https://192.168.88.1",
    //     username: "admin",
    //     password: process.env.MIKROTIK_PASSWORD ?? "",
    //     fetch: (url, init) =>
    //       undiciFetch(url, {
    //         ...init,
    //         dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
    //       }),
    //   });

    const host = process.env.MIKROTIK_HOST ?? "192.168.88.1";
    const port = process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined;
    const baseUrl = `https://${host}${port !== undefined ? `:${port}` : ""}`;

    return new RouterOSRestClient({
        baseUrl,
        username: process.env.MIKROTIK_USERNAME ?? "admin",
        password: process.env.MIKROTIK_PASSWORD ?? "",
    });
}

async function main() {
    const transport: DeviceTransport = createClient();

    // Using the REST transport with typed helpers — same API as binary API client
    const helpers = createRouterOSHelpers(transport);

    try {
        // ── Read operations ──────────────────────────────────────────────

        const [identity, resource, interfaces, ipAddresses] = await Promise.all([
            helpers.system.identity.get(),
            helpers.system.resource.get({
                proplist: ["uptime", "version", "cpu-load"],
            }),
            helpers.interface.list({
                proplist: [".id", "name", "running", "disabled"],
            }),
            helpers.ip.address.list({
                proplist: [".id", "address", "interface", "disabled"],
            }),
        ]);

        console.log("=== System Identity ===");
        console.log(identity);

        console.log("=== System Resource ===");
        console.log({
            version: resource?.version,
            uptime: resource?.uptime,
            cpuLoad: resource?.["cpu-load"],
        });

        console.log("=== Interfaces ===");
        for (const iface of interfaces) {
            console.log(`  ${iface.name} (running: ${iface.running ?? "?"})`);
        }

        console.log("=== IP Addresses ===");
        for (const addr of ipAddresses) {
            console.log(`  ${addr.address} on ${addr.interface}`);
        }

        // ── Raw execute (add / set / remove) ─────────────────────────────

        // Add a temporary IP address
        console.log("\n=== Adding IP address ===");
        await transport.execute("/ip/address/add", {
            attributes: {
                address: "192.168.100.1/24",
                interface: "ether2",
                comment: "REST example",
            },
        });
        console.log("Added 192.168.100.1/24 on ether2");

        // List routes via raw execute
        console.log("\n=== Routes (sample) ===");
        const routeResult = await transport.execute("/ip/route/print", {
            attributes: { ".proplist": [".id", "dst-address", "gateway", "distance"] },
        });
        for (const route of routeResult.records.slice(0, 5)) {
            console.log(`  ${route["dst-address"]} via ${route.gateway}`);
        }
    } finally {
        // Cleanup
        console.log(
            "\nDone. The REST client does not hold a persistent connection — no close() needed."
        );
    }
}

void main();
