# @sourceregistry/mikrotik-client [WIP]

[![npm version](https://img.shields.io/npm/v/@sourceregistry/mikrotik-client?logo=npm)](https://www.npmjs.com/package/@sourceregistry/mikrotik-client)
[![JSR](https://jsr.io/badges/@sourceregistry/mikrotik-client)](https://jsr.io/@sourceregistry/mikrotik-client)
[![License](https://img.shields.io/npm/l/@sourceregistry/mikrotik-client)](LICENSE)

TypeScript-first client for MikroTik RouterOS and SwitchOS.

This package targets the official RouterOS binary API documented by MikroTik and keeps the public surface compact:

- `RouterOSClient` for direct command execution over TCP or API-SSL
- a small dynamic `client.api` tree inspired by `pve-client`
- typed `client.helpers` wrappers for common menus
- sentence tags, queries, streaming `listen`, and trap handling
- `SwitchOSClient` for digest-auth `.b` endpoints used by SwOS web UI

Experimental orchestration helpers live under `@sourceregistry/mikrotik-client/experimental`:

- `DatacenterManager` for inventory, segmentation, fan-out actions, and subnet discovery
- `FabricManager` for network intent, topology grouping, preview, dry-run planning, and apply

## Installation

```bash
npm install @sourceregistry/mikrotik-client
```

## SwitchOS

SwitchOS does not expose public supported API docs, but MikroTik SwOS web UI uses stable digest-auth HTTP endpoints:

- `GET /<name>.b`
- `POST /<name>.b`
- `POST` body as `text/plain` JS-like literal
- special action endpoints like `/reboot` and `/reset` with body `*`

This package exposes low-level `SwitchOSClient` for that transport. Recommended use: schema-driven endpoint access per model or family.

```ts
import {
  SwitchOSClient,
  decodeSwitchOSHexString,
  decodeSwitchOSIpv4,
} from "@sourceregistry/mikrotik-client";

const client = new SwitchOSClient({
  baseUrl: "http://192.168.88.2",
  username: "admin",
  password: "secret",
});

const sys = await client.read<{ id: string; ip: number }>("/sys.b");

console.log({
  identity: decodeSwitchOSHexString(sys.id),
  ip: decodeSwitchOSIpv4(sys.ip),
});

await client.write("/vlan.b", [
  { vid: 1, nm: "64656661756c74", mbr: 0x0001ffff },
]);
```

## Quick Start

```ts
import { RouterOSClient } from "@sourceregistry/mikrotik-client";

const client = new RouterOSClient({
  host: "192.168.88.1",
  username: "admin",
  password: "secret",
});

const resources = await client.api.system.resource.print({
  attributes: {
    ".proplist": ["uptime", "cpu-load", "version"],
  },
});

console.log(resources[0]);
await client.close();
```

## Binary API Commands

```ts
const client = new RouterOSClient({
  host: "router.example.com",
  tls: true,
  port: 8729,
  username: "api-user",
  password: "secret",
});

const result = await client.execute("/ip/address/print", {
  attributes: {
    ".proplist": ["address", "interface", "disabled"],
  },
  queries: ["?disabled=no"],
});

console.log(result.records);
```

## Dynamic API Tree

The `api` proxy converts property access into RouterOS path segments:

```ts
const identities = await client.api.system.identity.print();
await client.api.ip.address.add({
  attributes: {
    address: "192.168.88.10/24",
    interface: "bridge",
  },
});
```

If you need a segment that is not a valid property, use `.path()`:

```ts
await client.api.path("routing").path("bgp").path("connection").print();
```

## Helpers

For common menus, use the typed helper layer:

```ts
const identity = await client.system.identity.get();
const resource = await client.system.resource.get({
  proplist: ["uptime", "version", "cpu-load"],
});
const interfaces = await client.interface.list({
  proplist: [".id", "name", "running", "disabled"],
});

await client.ip.address.add({
  address: "192.168.99.1/24",
  interface: "bridge",
  comment: "lab subnet",
});

const bridges = await client.bridge.list({
  proplist: [".id", "name", "vlan-filtering", "disabled"],
});

const pppSecrets = await client.ppp.secret.list({
  proplist: [".id", "name", "service", "profile", "disabled"],
});

const routingRules = await client.routing.rule.list({
  proplist: [".id", "action", "table", "src-address", "dst-address"],
});

const bonds = await client.interface.bonding.list({
  proplist: [".id", "name", "mode", "slaves", "lacp-rate", "mlag-id"],
});

const bgpConnections = await client.routing.bgp.connection.list({
  proplist: [".id", "name", "remote.address", "remote.as", "local.address"],
});

const wgPeers = await client.wireguard.peer.list({
  proplist: [".id", "interface", "allowed-address", "endpoint-address"],
});
```


## Datacenter Wrapper

## Experimental Orchestration

Import orchestration helpers from experimental subpath:

```ts
import { DatacenterManager, FabricManager } from "@sourceregistry/mikrotik-client/experimental";
```

Use `DatacenterManager` when many routers exist across sites, roles, and segments:

```ts
import { DatacenterManager } from "@sourceregistry/mikrotik-client/experimental";

const manager = new DatacenterManager([
  {
    id: "dc1-leaf1",
    host: "10.0.0.11",
    username: "admin",
    password: "secret",
    site: "dc1",
    role: "leaf",
    tags: ["fabric", "mlag"],
  },
  {
    id: "dc1-edge1",
    host: "10.0.1.1",
    username: "admin",
    password: "secret",
    site: "dc1",
    role: "edge",
    tags: ["wan"],
  },
]);

const fabric = await manager.snapshot({ tags: ["fabric"] });

const bondStates = await manager.run({ site: "dc1", role: "leaf" }, async (device) => ({
  id: device.id,
  snapshot: await device.client.snapshot(device.id),
}));
```

### Discovery

Discovery scan probe RouterOS API/API-SSL on given subnets. Needs credentials. Good for bootstrap, not full source of truth.

```ts
const found = await DatacenterManager.discover({
  subnets: ["10.0.0.0/24", "10.0.1.0/24"],
  credentials: { username: "admin", password: "secret" },
  defaultSite: "dc1",
  defaultRole: "unknown",
  tags: ["discovered"],
});
```

## Fabric Wrapper

Best split:
- `DatacenterManager` = inventory/discovery
- `FabricManager` = networking intent and topology

`FabricManager` model nodes, links, segments, BGP peers, WireGuard tunnels, then build plan before apply:

```ts
import { DatacenterManager, FabricManager } from "@sourceregistry/mikrotik-client/experimental";

const inventory = new DatacenterManager([
  {
    id: "dc1-leaf1",
    host: "10.0.0.11",
    username: "admin",
    password: "secret",
    site: "dc1",
    role: "leaf",
  },
]);

const fabric = new FabricManager({
  inventory,
  nodes: [
    {
      id: "leaf1",
      deviceId: "dc1-leaf1",
      fabric: "prod",
      bridgeName: "bridge-fabric",
      asn: 65001,
      loopback: "10.255.255.1",
    },
  ],
  links: [
    {
      id: "server01",
      kind: "mlag",
      endpoints: [
        {
          nodeId: "leaf1",
          members: ["ether1", "ether2"],
          bondName: "bond-server01",
          mlagId: 10,
        },
      ],
    },
  ],
  segments: [
    {
      id: "servers",
      name: "servers",
      vlanId: 20,
      attachments: [
        {
          nodeId: "leaf1",
          bridge: "bridge-fabric",
          tagged: ["bridge-fabric", "bond-server01"],
        },
      ],
    },
  ],
});

const plan = fabric.plan({ fabric: "prod" });
console.log(plan);
const preview = await fabric.previewPlan(plan);
console.log(preview);
// await fabric.apply(plan)
```

## Listening For Changes

```ts
const stream = await client.api.interface.listen();

for await (const reply of stream) {
  console.log(reply.type, reply.attributes);
}
```

Stop a listener with:

```ts
await stream.cancel();
```

## Error Handling

RouterOS `!trap` replies reject with `RouterOSTrapError`:

```ts
import { RouterOSTrapError } from "@sourceregistry/mikrotik-client";

try {
  await client.api.interface.set({
    attributes: {
      ".id": "missing-interface",
      disabled: true,
    },
  });
} catch (error) {
  if (error instanceof RouterOSTrapError) {
    console.error(error.replies[0]?.attributes.message);
  }
}
```

## Development

```bash
npm run build
npm test
npm run example:basic
npm run example:helpers
npm run example:network
npm run example:datacenter-mlag
npm run example:multisite-bgp-wireguard
npm run example:datacenter-manager
npm run example:discover
npm run example:fabric-manager
```
