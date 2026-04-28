/**
 * IR (Intermediate Representation) example.
 *
 * Demonstrates parsing RouterOS `/export` output into a typed IR tree,
 * rendering that tree back into a canonical script, and computing structural
 * diffs between two configurations.
 *
 * This example is SELF-CONTAINED — no live device connection required.
 */

import { parseExport, renderScript, diff, createEmptyConfig } from "../src/ir";
import type { RouterOSConfig, IRItem, IRResourceBlock, IRItemKind, Patch } from "../src/ir";
import { isResourceBlock } from "../src/ir";

// Sample RouterOS /export output
const SAMPLE_EXPORT = `
# RouterOS export
/system identity
set name=contoh

/interface bridge
add name=bridge-local
add name=bridge-vpn

/interface ethernet
set [ find default-name=ether1 ] disabled=yes
set [ find default-name=ether2 ] disabled=no

/ip address
add address=192.168.88.1/24 interface=bridge-local
add address=10.8.0.1/24 interface=bridge-vpn

/ip firewall filter
add action=accept chain=input comment="allow established" connection-state=established,related
add action=drop chain=input comment="drop invalid" connection-state=invalid

/interface bridge port
add bridge=bridge-local interface=ether2
`;

// Desired configuration (what we want to converge to)
const DESIRED_CONFIG_JSON = `
/system identity
set name=router-site-a

/interface bridge
add name=bridge-local
# bridge-vpn removed from desired config

/interface ethernet
set [ find default-name=ether1 ] disabled=no
set [ find default-name=ether2 ] disabled=no

/ip address
add address=192.168.88.1/24 interface=bridge-local
add address=10.8.0.1/30 interface=bridge-vpn

/ip firewall filter
add action=accept chain=input comment="allow established" connection-state=established,related

/interface bridge port
add bridge=bridge-local interface=ether2
`;

async function main() {
    // ── Step 1: Parse export text → IR ────────────────────────────────
    console.log("=== Step 1: Parse /export → IR ===\n");
    const liveConfig: RouterOSConfig = parseExport(SAMPLE_EXPORT);

    console.log(`Parsed ${liveConfig.items.length} items`);
    for (const item of liveConfig.items) {
        if (isResourceBlock(item)) {
            console.log(`  ${item.path} — ${item.command} (${item.properties.length} property/ies)`);
        } else if (item.kind === "comment") {
            console.log(`  [${item.kind}]: ${item.text}`);
        } else if (item.kind === "env") {
            console.log(`  [${item.kind}]: ${item.name}=${item.value}`);
        } else if (item.kind === "system") {
            console.log(`  [${item.kind}]: ${item.command}`);
        } else if (item.kind === "block") {
            console.log(`  [${item.kind}]: ${item.items.length} items`);
        }
    }

    // ── Step 2: Render IR → script text ──────────────────────────────
    console.log("\n=== Step 2: Render IR → script ===\n");
    const script = renderScript(liveConfig, {
        compact: false,
        terse: false,
        sortByDependency: true,
    });
    console.log(script.slice(0, 500) + (script.length > 500 ? "\n... (truncated)" : ""));

    // ── Step 3: Parse desired config and diff ────────────────────────
    console.log("\n=== Step 3: Diff (live vs desired) ===\n");
    const desiredConfig: RouterOSConfig = parseExport(DESIRED_CONFIG_JSON);
    const patch: Patch = diff(liveConfig, desiredConfig);

    console.log(`Patch summary:`);
    console.log(`  Create: ${patch.create.length} new resources`);
    console.log(`  Update: ${patch.update.length} changes`);
    console.log(`  Delete: ${patch.delete.length} removals`);

    for (const op of patch.create) {
        console.log(`  + CREATE ${op.block.path}`);
    }
    for (const op of patch.update) {
        console.log(
            `  ~ UPDATE ${op.block.path}: ${op.changes.map((c) => `${c.name}: ${c.oldValue} → ${c.newValue}`).join("; ")}`
        );
    }
    for (const op of patch.delete) {
        console.log(`  - DELETE ${op.block.path}`);
    }

    // ── Step 4: Empty config → render ────────────────────────────────
    console.log("\n=== Step 4: Empty config render ===\n");
    const empty = createEmptyConfig();
    const emptyScript = renderScript(empty);
    console.log(`Empty config renders to: "${emptyScript}"`);
}

void main();

/**
 * ── With a live device ──────────────────────────────────────────────
 *
 * To apply a patch to a real device, you would do:
 *
 *   import { RouterOSClient } from "@sourceregistry/mikrotik-client";
 *   import { applyPatch } from "@sourceregistry/mikrotik-client/ir";
 *
 *   const client = new RouterOSClient({ host: "192.168.88.1", ... });
 *   const result = await applyPatch(client, patch);
 *   console.log(result.applied, result.skipped, result.failed);
 */
