# @sourceregistry/mikrotik-client [WIP]

[![npm version](https://img.shields.io/npm/v/@sourceregistry/mikrotik-client?logo=npm)](https://www.npmjs.com/package/@sourceregistry/mikrotik-client)
[![JSR](https://jsr.io/badges/@sourceregistry/mikrotik-client)](https://jsr.io/@sourceregistry/mikrotik-client)
[![License](https://img.shields.io/npm/l/@sourceregistry/mikrotik-client)](LICENSE)

TypeScript-first client for MikroTik RouterOS and SwitchOS.

This package targets the official RouterOS binary API documented by MikroTik and keeps the public surface compact:

- `RouterOSClient` for direct command execution over TCP or API-SSL
- `RouterOSSshClient` for command execution through the local OpenSSH client
- a small dynamic `client.api` tree inspired by `pve-client`
- typed `client.helpers` wrappers for common menus
- sentence tags, queries, streaming `listen`, and trap handling
- `SwitchOSClient` for digest-auth `.b` endpoints used by SwOS web UI
- MNDP-based neighbor discovery helpers for bootstrap flows

## Stability

This library is intended to be stable.

- Typed RouterOS helpers are added only for publicly documented menus and command paths.
- If a RouterOS operation is not documented well enough to stand behind as stable API, use the raw surface: `client.execute(...)`, `client.print(...)`, or `client.api...`.
- SwitchOS remains intentionally low-level. MikroTik does not publish a fully supported public SwOS API, so this package exposes transport primitives (`read`, `write`, `action`, `download`) and optional schema-driven access rather than claiming stable typed coverage for undocumented endpoints.
- Discovery stays focused on local hardware bootstrap, not centralized planning.

## Feature Matrix

| Capability                  | RouterOS                               | SwitchOS                                             |
| --------------------------- | -------------------------------------- | ---------------------------------------------------- |
| Connect/authenticate        | Yes, binary API over TCP or API-SSL    | Yes, HTTP digest auth                                |
| Raw command execution       | Yes, `execute(...)`                    | No CLI surface; use endpoint `read`/`write`/`action` |
| SSH command execution       | Yes, via local `ssh` executable        | No                                                   |
| Dynamic path API            | Yes, `client.api...`                   | No                                                   |
| Typed helper layer          | Yes, documented/common menus only      | No stable typed helper layer                         |
| Read menu data              | Yes                                    | Yes                                                  |
| Write configuration         | Yes                                    | Yes                                                  |
| Trigger action endpoints    | Yes                                    | Yes                                                  |
| Streaming/listen            | Yes, `listen(...)`                     | No                                                   |
| Trap/error handling         | Yes, `RouterOSTrapError`               | HTTP/request errors only                             |
| Download files/data         | Not as dedicated helper                | Yes, `download(...)`                                 |
| Schema-aware access         | Not needed                             | Yes, optional schema support                         |
| Pre-auth local discovery    | Yes, MNDP listener/discovery helpers   | Detects MikroTik ads on network, usable before auth  |
| Provisioning/config helpers | Yes, typed helpers plus raw API access | Yes, low-level endpoint helpers                      |

### RouterOS

| Area                                            | Support                                 |
| ----------------------------------------------- | --------------------------------------- |
| System resource / identity                      | Typed helpers                           |
| Package update / RouterBOARD / reboot / export  | Typed helpers                           |
| Interfaces / bonding                            | Typed helpers                           |
| Legacy wireless registration table              | Typed helpers                           |
| WiFi registration table                         | Typed helpers                           |
| LTE monitor                                     | Typed helper                            |
| Bridges / bridge ports / bridge VLANs           | Typed helpers                           |
| Bridge / bridge-port STP monitor                | Typed helpers                           |
| IP addresses / routes / neighbors               | Typed helpers                           |
| DHCP leases                                     | Typed helper                            |
| IP services                                     | Typed helpers                           |
| IPsec peers                                     | Typed helper                            |
| Firewall filters                                | Typed helpers                           |
| IPv6 neighbors                                  | Typed helper                            |
| PPP secrets                                     | Typed helpers                           |
| WireGuard interfaces / peers                    | Typed helpers                           |
| Routing rules / BGP templates / BGP connections | Typed helpers                           |
| Anything else in RouterOS API                   | Raw `execute`, `print`, or `client.api` |

### SwitchOS

| Area                                             | Support                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| Generic endpoint reads                           | `read(path)`                                       |
| Generic endpoint writes                          | `write(path, body)`                                |
| Action endpoints like `/reboot`                  | `action(path)`                                     |
| Binary/file downloads                            | `download(path)`                                   |
| Model/schema inspection                          | `schema`, `listEndpoints()`, `getEndpointSchema()` |
| Encoding helpers for hex/IP/MAC/bitmask/literals | Provided                                           |
| Stable typed feature wrappers                    | Not provided intentionally                         |
| Undocumented/model-specific operations           | Use raw low-level client only                      |

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

If an endpoint or action is not clearly documented by MikroTik or validated by a stable device schema, prefer staying on the low-level `SwitchOSClient` surface instead of wrapping it as typed library API.

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

await client.write("/vlan.b", [{ vid: 1, nm: "64656661756c74", mbr: 0x0001ffff }]);
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

## Neighbor Discovery

Use the Neighbor Discovery Service as the first bootstrap step when you need to find MikroTik devices on the local network before authentication.

This is intentionally discovery-only:

- local segment / broadcast domain only
- depends on discovery being enabled on the device
- useful for finding devices before API or HTTP credentials are known
- not a replacement for authenticated inventory
- discovery is MNDP-only in the active package surface

### Recommended API

```ts
import {
  NeighborDiscoveryService,
  discoverNeighbors,
  listenNeighbors,
} from "@sourceregistry/mikrotik-client";

const neighbors = await discoverNeighbors({
  timeoutMs: 3_000,
});

for (const neighbor of neighbors) {
  console.log({
    mac: neighbor.macAddress,
    identity: neighbor.identity,
    platform: neighbor.platform,
    version: neighbor.version,
    hardware: neighbor.hardware,
    interface: neighbor.interfaceName,
    ip: neighbor.address,
  });
}

const service = await listenNeighbors({
  requestIntervalMs: 30_000,
});

for await (const neighbor of service) {
  console.log("neighbor update", neighbor.identity, neighbor.address);
}

await service.close();

const explicitService = await new NeighborDiscoveryService({
  requestIntervalMs: 30_000,
}).start();

explicitService.on("neighbor", (neighbor, previous) => {
  console.log("neighbor event", {
    identity: neighbor.identity,
    previousIdentity: previous?.identity,
  });
});

await explicitService.close();
```

Use `requestIntervalMs` when you want the Neighbor Discovery Service to keep probing the subnet continuously instead of sending a single solicitation at startup.

### Low-Level MNDP

Use the raw MNDP listener when you want advertisements exactly as MikroTik sends them instead of normalized `DiscoveredNeighbor` records.

```ts
import { discoverMNDP, listenMNDP } from "@sourceregistry/mikrotik-client";

const advertisements = await discoverMNDP({
  timeoutMs: 3_000,
});

for (const advertisement of advertisements) {
  console.log("found", advertisement.identity, advertisement.remoteAddress);
}

const listener = await listenMNDP({
  requestIntervalMs: 30_000,
});

listener.on("advertisement", (advertisement) => {
  console.log("mndp", advertisement.identity, advertisement.remoteAddress);
});
```

Bootstrap flow usually looks like:

1. discover a neighbor with `discoverNeighbors()` or `listenNeighbors()`
2. choose transport and credentials
3. connect with `RouterOSClient` or `SwitchOSClient`
4. fetch authoritative state after authentication

For a simple discovery-to-login flow, see:

```bash
npm run example:discover-neighbor
```

If MNDP discovery is not visible from your host, the example also supports direct fallback through environment variables:

```bash
MIKROTIK_HOST=127.0.0.1
MIKROTIK_PORT=8728
MIKROTIK_USERNAME=admin
MIKROTIK_PASSWORD=secret
npm run example:discover-neighbor
```

For the Docker RouterOS compose you referenced, typical direct targets are:

- `routeros` -> `127.0.0.1:8728`
- `routeros2` -> `127.0.0.1:28728`
- `routeros-client` -> `127.0.0.1:38728`

Set `MIKROTIK_TLS=true` when targeting API-SSL instead of plain API.

If you want to test MNDP from inside the same Docker bridge instead of using direct fallback, add a Node dev container to the RouterOS compose and run the discovery example there:

```bash
docker compose up -d adopter-dev
docker compose exec adopter-dev npm run example:discover-neighbor
```

Inside that dev container, `MIKROTIK_USERNAME` and `MIKROTIK_PASSWORD` can be set on the service or passed at exec time.

For a one-shot run that installs tooling if needed and then exits, use:

```bash
docker compose run --rm adopter-run
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

## SSH Commands

Use `RouterOSSshClient` when SSH is preferred or the RouterOS API service is not enabled. This client does not add npm dependencies; it shells out to the local OpenSSH `ssh` executable with argument arrays, not a shell command string.

Password prompts are not automated by this package. Use SSH keys or an agent, or provide a custom `spawn` implementation if your environment has its own credential flow.

Host key checking defaults to `accept-new`: new hosts are recorded by OpenSSH, but changed host keys fail instead of being accepted silently. For stricter environments, set `strictHostKeyChecking: true` and pre-provision `known_hosts`. Avoid `strictHostKeyChecking: false` outside local labs.

`identityFile` can be a path or a `Blob`. Blob keys are written to a private temporary file with `0600` permissions for the lifetime of one command, then removed. This is useful when the private key is stored in a database or secret store instead of the filesystem.

```ts
import { RouterOSSshClient } from "@sourceregistry/mikrotik-client";

const ssh = new RouterOSSshClient({
  host: "192.168.88.1",
  username: "admin",
  identityFile: "/home/me/.ssh/routeros_ed25519",
  timeoutMs: 10_000,
});

const result = await ssh.execute("/system/resource/print", {
  words: ["terse"],
});

console.log(result.stdout);
```

```ts
const keyFromDatabase = new Blob([privateKeyPem]);

const ssh = new RouterOSSshClient({
  host: "192.168.88.1",
  username: "admin",
  identityFile: keyFromDatabase,
});
```

## Dynamic API Tree

The `api` proxy converts property access into RouterOS path segments. It is typed recursively, so arbitrary RouterOS menu paths can be chained without falling back to `unknown`:

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
const packageUpdate = await client.system.package.update.checkForUpdates();
const routerboard = await client.system.routerboard.get({
  proplist: ["model", "current-firmware", "upgrade-firmware"],
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

const routes = await client.ip.route.list({
  proplist: [".id", "dst-address", "gateway", "distance", "routing-table"],
});

const neighbors = await client.ip.neighbor.list({
  proplist: ["interface", "address", "address6", "mac-address", "identity", "platform"],
});

const ipsecPeers = await client.ip.ipsec.peer.list({
  proplist: [".id", "name", "address", "local-address", "exchange-mode"],
});

const dhcpLeases = await client.ip.dhcpServer.lease.list({
  proplist: [".id", "address", "mac-address", "host-name", "status"],
});

const ipServices = await client.ip.service.list({
  proplist: [".id", "name", "port", "disabled", "tls-version"],
});

const ipv6Neighbors = await client.ipv6.neighbor.list({
  proplist: [".id", "address", "mac-address", "interface", "vrf"],
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

const legacyWirelessClients = await client.interface.wireless.registrationTable.list({
  proplist: [".id", "interface", "ssid", "mac-address", "signal"],
});

const wifiClients = await client.interface.wifi.registrationTable.list({
  proplist: [".id", "interface", "ssid", "mac-address", "signal", "band"],
});

const bridgeStp = await client.bridge.monitor("bridge");
const bridgePortStp = await client.bridge.port.monitor("*5");
const lteInfo = await client.interface.lte.monitor("lte1");

await client.ip.service.set("*1", {
  disabled: true,
});

await client.system.exportConfig({
  file: "backup",
  terse: true,
});

await client.system.package.update.install();
await client.system.routerboard.upgrade();
await client.system.reboot();
```

Helpers are curated, not exhaustive. Missing operations are not necessarily unsupported by the library; they may still be available through `client.execute(...)`, `client.print(...)`, or `client.api...` and can be promoted into typed helpers later once command shape and stability are well documented.

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
npm run example:listen
npm run example:network
npm run example:routeros-bgp-wireguard
npm run example:discover-neighbor
```
