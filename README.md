# @sourceregistry/mikrotik-client

[![npm version](https://img.shields.io/npm/v/@sourceregistry/mikrotik-client?logo=npm)](https://www.npmjs.com/package/@sourceregistry/mikrotik-client)
[![JSR](https://jsr.io/badges/@sourceregistry/mikrotik-client)](https://jsr.io/@sourceregistry/mikrotik-client)
[![License](https://img.shields.io/npm/l/@sourceregistry/mikrotik-client)](LICENSE)

TypeScript SDK for MikroTik RouterOS and SwitchOS. Low-level client — transport, protocol, schema, and device-safety primitives — for controllers, CLIs, scripts, and tests.

## Features

- **RouterOS transports**: binary API (TCP/API-SSL), HTTP REST (v7+), SSH, MAC-Telnet
- **SwitchOS transport**: HTTP + digest auth
- **MNDP neighbor discovery**: bootstrap-level device discovery (UDP 5678)
- **Typed helpers**: `client.interface.list()`, `client.ip.address.add()`, etc.
- **Dynamic API tree**: `client.api.system.resource.print()` — arbitrary RouterOS paths
- **Streaming**: `client.api.interface.listen()` — real-time change events
- **IR module**: parse `/export` dumps, render scripts, structural diff, apply patches
- **Safety module**: commit-confirm with auto-revert, atomic script apply, backups
- **Crypto helpers**: CSR generation (RSA/ECDSA), X.509 parsing, device certificate management
- **Connection middleware**: connection pooling, retry/backoff, rate limiting, circuit breaker
- **Netinstall**: TFTP + BOOTP server for RouterOS firmware recovery

## Installation

```bash
npm install @sourceregistry/mikrotik-client
```

Requires Node.js ≥ 20.

## Quick Start

```ts
import { RouterOSClient } from "@sourceregistry/mikrotik-client";

const client = new RouterOSClient({
  host: "192.168.88.1",
  username: "admin",
  password: "secret",
});

const resource = await client.system.resource.get({
  proplist: ["uptime", "version", "cpu-load"],
});
console.log(resource);

await client.close();
```

## Transports

### API (TCP / API-SSL)

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

### REST (HTTP / HTTPS v7+)

```ts
import { RouterOSRestClient } from "@sourceregistry/mikrotik-client";

const client = new RouterOSRestClient({
  baseUrl: "https://router.example.com",
  username: "admin",
  password: "secret",
});

const addresses = await client.ip.address.print();
```

### SSH

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

For key material stored in databases or secret stores, use a `Blob`:

```ts
const keyFromDatabase = new Blob([privateKeyPem]);
const ssh = new RouterOSSshClient({
  host: "192.168.88.1",
  username: "admin",
  identityFile: keyFromDatabase,
});
```

### SwitchOS

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

## Typed Helpers

Common RouterOS menus have typed wrappers via `client.<resource>`:

```ts
const interfaces = await client.interface.list({
  proplist: [".id", "name", "running", "disabled"],
});

await client.ip.address.add({
  address: "192.168.99.1/24",
  interface: "bridge",
  comment: "lab subnet",
});

const routes = await client.ip.route.list({
  proplist: [".id", "dst-address", "gateway", "distance"],
});

const bridges = await client.bridge.list({
  proplist: [".id", "name", "vlan-filtering", "disabled"],
});

await client.ip.service.set("*1", { disabled: true });
await client.system.exportConfig({ file: "backup", terse: true });
```

### Supported Resources

| Area                                         | Support                                       |
| -------------------------------------------- | --------------------------------------------- |
| System resource / identity / reboot / export | Typed helpers                                 |
| Package update / RouterBOARD                 | Typed helpers                                 |
| Interfaces / bonding                         | Typed helpers                                 |
| Bridges / bridge ports / bridge VLANs        | Typed helpers                                 |
| Bridge / bridge-port STP monitor             | Typed helpers                                 |
| IP addresses / routes / neighbors            | Typed helpers                                 |
| DHCP leases                                  | Typed helpers                                 |
| IP services                                  | Typed helpers                                 |
| IPsec peers                                  | Typed helpers                                 |
| Firewall filters                             | Typed helpers                                 |
| IPv6 neighbors                               | Typed helpers                                 |
| PPP secrets                                  | Typed helpers                                 |
| WireGuard interfaces / peers                 | Typed helpers                                 |
| Routing rules / BGP                          | Typed helpers                                 |
| WiFi / legacy wireless registration          | Typed helpers                                 |
| LTE monitor                                  | Typed helpers                                 |
| CAPsMAN full CRUD + `ensure*` helpers        | Typed helpers                                 |
| Anything else in RouterOS API                | Raw `execute`, `print`, or dynamic `api` tree |

## Dynamic API Tree

Chain arbitrary RouterOS paths through a typed proxy:

```ts
const identities = await client.api.system.identity.print();

await client.api.ip.address.add({
  attributes: {
    address: "192.168.88.10/24",
    interface: "bridge",
  },
});
```

For segments not typed in the proxy, use `.path()`:

```ts
await client.api.path("routing").path("bgp").path("connection").print();
```

## Listening For Changes

```ts
const stream = await client.api.interface.listen();

for await (const reply of stream) {
  console.log(reply.type, reply.attributes);
}

await stream.cancel();
```

## IR — Parse, Render, Diff

Parse `/export` dumps, render scripts, compute structural diffs, and apply patches:

```ts
import { parseExport, renderScript, diff, applyPatch } from "@sourceregistry/mikrotik-client/ir";

const liveConfig = parseExport(liveExportText);
const desiredConfig = parseExport(desiredExportText);

const patch = diff(liveConfig, desiredConfig);
const result = await applyPatch(client, patch);
```

## Safety — Commit-Confirm, Backups

```ts
import { commitConfirm, saveBackup } from "@sourceregistry/mikrotik-client/safety";

await saveBackup(client, "pre-change.rsc");

const handle = await commitConfirm(
  client,
  {
    timeoutMs: 120_000,
  },
  async () => {
    await client.ip.address.add({
      address: "10.0.0.1/24",
      interface: "ether1",
    });
  }
);

// Confirm the change is working
await handle.confirm();

// Or roll back if something went wrong
// await handle.rollback();
```

## Neighbor Discovery

Find MikroTik devices on the local network before authentication:

```ts
import { discoverNeighbors } from "@sourceregistry/mikrotik-client";

const neighbors = await discoverNeighbors({
  timeoutMs: 3_000,
});

for (const n of neighbors) {
  console.log({
    mac: n.macAddress,
    identity: n.identity,
    platform: n.platform,
    version: n.version,
  });
}
```

## Crypto — CSR Generation & X.509 Parsing

```ts
import {
  generateCsr,
  parseCertificate,
  listCertificates,
} from "@sourceregistry/mikrotik-client/crypto";

const { csrPem, keyPem } = generateCsr({
  commonName: "router.lab.local",
  sans: ["router.lab.local", "192.168.88.1"],
  keyType: "ecdsa",
  namedCurve: "P-256",
});

const certs = await listCertificates(client);
const parsed = parseCertificate(certs[0].pem);
```

## Connection Middleware

Composable connection management:

```ts
import { ConnectionPool, RateLimiter, CircuitBreaker } from "@sourceregistry/mikrotik-client";

const limiter = new RateLimiter({ maxTps: 20, burst: 5 });
const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });

const pool = new ConnectionPool({
  min: 1,
  max: 5,
  idleTimeoutMs: 60_000,
  create: async () => new RouterOSClient(opts),
  destroy: (c) => c.close(),
});
```

## Error Handling

```ts
import { MikrotikError } from "@sourceregistry/mikrotik-client";

try {
  await client.ip.address.add({
    /* ... */
  });
} catch (error) {
  if (error instanceof MikrotikError) {
    console.error(error.code, error.message);
    console.error("retriable:", error.retriable);
  }
}
```

## Development

```bash
# Build
npm run build

# Lint + typecheck
npm run lint
npm run format:check

# Tests
npm test                              # unit tests
CI=1 npm run test:integration        # CHR integration (requires Docker)
```

Integration tests run against RouterOS CHR in Docker (tags `7.22`, `latest`). Set `MIKROTIK_CHR_IMAGE` to override:

```bash
MIKROTIK_CHR_IMAGE=mikrotik/chr:latest npm run test:integration
```

## Sub-path Exports

| Import                                       | Contents                                     |
| -------------------------------------------- | -------------------------------------------- |
| `@sourceregistry/mikrotik-client`            | Full barrel — all modules                    |
| `@sourceregistry/mikrotik-client/routeros`   | RouterOS API, REST, SSH, helpers, transports |
| `@sourceregistry/mikrotik-client/switchos`   | SwitchOS client                              |
| `@sourceregistry/mikrotik-client/discovery`  | MNDP / neighbor discovery                    |
| `@sourceregistry/mikrotik-client/ir`         | Parse, render, diff, apply                   |
| `@sourceregistry/mikrotik-client/safety`     | Commit-confirm, backups                      |
| `@sourceregistry/mikrotik-client/crypto`     | CSR, X.509, device certs                     |
| `@sourceregistry/mikrotik-client/mac-telnet` | MAC-Telnet UDP client                        |
| `@sourceregistry/mikrotik-client/netinstall` | Netinstall TFTP / BOOTP                      |
