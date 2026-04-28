/**
 * Typed Stream example.
 *
 * Demonstrates `TypedStream<T>` for receiving strongly-typed configuration
 * change events from MikroTik devices via the "listen" command.
 *
 * TypedStream wraps the raw RouterOS stream and emits structured events:
 * - `{ kind: "added", after: T, raw }` — new configuration item
 * - `{ kind: "updated", before: T, after: T, raw }` — config change
 * - `{ kind: "removed", before: T, raw }` — config deletion
 *
 * Also demonstrates resource-based watch() via the RouterOS helpers when
 * available.
 */

import { RouterOSClient } from "../src/routeros";
import type { RouterOSInterface } from "../src/routeros";
import type { RouterOSRecord } from "../src/routeros";
import { parseBool, parseInteger } from "../src/utils/codecs";
import { TypedStream } from "../src/routeros/typed-stream";
import type { TypedEvent } from "../src/routeros/typed-stream";

/**
 * Parse a raw RouterOS record into a typed RouterOSInterface.
 * Note: parseInterface is not exported from the helpers module,
 * so we define a local parser for this example.
 */
function parseInterfaceExample(raw: RouterOSRecord): RouterOSInterface {
    const id = raw[".id"];
    const name = raw["name"];
    const type = raw["type"];
    const running = raw["running"];
    const disabled = raw["disabled"];
    const mtu = raw["mtu"];
    const actualMtu = raw["actual-mtu"];
    const mac = raw["mac-address"];
    return {
        ...(id !== undefined && { ".id": id }),
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(running !== undefined && { running: parseBool(running) }),
        ...(disabled !== undefined && { disabled: parseBool(disabled) }),
        ...(mtu !== undefined && { mtu: parseInteger(mtu) }),
        ...(actualMtu !== undefined && { "actual-mtu": parseInteger(actualMtu) }),
        ...(mac !== undefined && { "mac-address": mac }),
    };
}

async function main() {
    const host = process.env.MIKROTIK_HOST;
    if (!host) {
        console.log("Set MIKROTIK_HOST to stream live interface events.");
        console.log("Showing TypedStream API demo instead.\n");
        return demoTypedStreamStructure();
    }

    const client = new RouterOSClient({
        host,
        username: process.env.MIKROTIK_USERNAME ?? "admin",
        password: process.env.MIKROTIK_PASSWORD ?? "",
        tls: process.env.MIKROTIK_TLS === "true",
        ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
    });

    try {
        // ── Step 1: Raw listen → TypedStream ────────────────────────────
        console.log("=== Step 1: TypedStream from /interface/print ===\n");
        console.log("Watching interface changes for 10 seconds...");
        console.log("Open WinBox and add/remove an interface to see events.\n");

        const controller = new AbortController();
        const routerStream = await client.listen("/interface/print", {
            signal: controller.signal,
        });

        const stream = new TypedStream<RouterOSInterface>(routerStream, parseInterfaceExample, {
            signal: controller.signal,
            onRemovalKeys: [".id", "name"],
        });

        // Listen for typed events
        stream.on("event", (evt: TypedEvent<RouterOSInterface>) => {
            switch (evt.kind) {
                case "added":
                    console.log(`[+] Interface added: ${evt.after.name}`);
                    break;
                case "updated":
                    console.log(`[~] Interface changed: ${evt.before.name}`);
                    if (evt.before.disabled !== evt.after.disabled) {
                        console.log(`    disabled: ${evt.before.disabled} → ${evt.after.disabled}`);
                    }
                    break;
                case "removed":
                    console.log(`[-] Interface removed: ${evt.before.name}`);
                    break;
            }
        });

        stream.on("error", (err) => {
            console.error("Stream error:", err);
        });

        stream.on("close", (reason) => {
            console.log(`\nStream closed: ${reason ?? "normal"}`);
        });

        // Stop after 10 seconds by aborting the signal
        // and disposing the stream
        setTimeout(() => {
            console.log("\nStopping (10s elapsed)...");
            controller.abort();
        }, 10_000);

        // Iterate over events using async iterator (backpressure-aware)
        for await (const _evt of stream) {
            // Events are already handled by .on("event", ...) above
        }
    } finally {
        await client.close();
    }
}

/**
 * Demo: show the TypedStream structure without a live device.
 */
function demoTypedStreamStructure() {
    console.log("TypedStream<T> emits three event kinds:");
    console.log("");
    console.log("  { kind: 'added',    after: T,          raw: RouterOSRecord }");
    console.log("  { kind: 'updated',  before: T, after: T, raw: RouterOSRecord }");
    console.log("  { kind: 'removed',  before: T,         raw: RouterOSRecord }");
    console.log("");
    console.log("Usage pattern:");
    console.log("  1. Get a RouterOSStream via client.listen(path, { follow: true })");
    console.log("  2. Wrap it: new TypedStream(stream, parseFn, opts)");
    console.log("  3. Listen: stream.on('event', (ev) => { ... })");
    console.log("  4. Cleanup: controller.abort() or stream.dispose()");
    console.log("");
    console.log("For resource-level watches, use client.<resource>.watch(opts)");
    console.log("when the resource helper supports it.");
}

void main();
