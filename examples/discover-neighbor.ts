import { discoverNeighbors, type DiscoveredNeighbor, RouterOSClient } from "../src";

function summarize(device: DiscoveredNeighbor) {
  return {
    source: device.source,
    identity: device.identity,
    mac: device.macAddress,
    platform: device.platform,
    version: device.version,
    hardware: device.hardware,
    interface: device.interfaceName,
    address: device.address,
  };
}

function directCandidateFromEnv(): DiscoveredNeighbor | undefined {
  const host = process.env.MIKROTIK_HOST;
  if (!host) {
    return undefined;
  }

  const portText = process.env.MIKROTIK_PORT;
  const port = portText ? Number.parseInt(portText, 10) : undefined;
  const tls = process.env.MIKROTIK_TLS === "true";
  const identity = process.env.MIKROTIK_IDENTITY;

  return {
    source: "mndp",
    id: `direct|${host}|${port ?? (tls ? 8729 : 8728)}`,
    address: host,
    ...(identity !== undefined ? { identity } : {}),
    platform: tls ? "routeros-api-ssl" : "routeros-api",
    raw: {
      version: 0,
      ttl: 0,
      checksum: 0,
      remoteAddress: host,
      remotePort: port ?? (tls ? 8729 : 8728),
      remoteFamily: "IPv4",
      receivedAt: new Date(),
      packet: {
        version: 0,
        ttl: 0,
        checksum: 0,
        tlvs: [],
        raw: new Uint8Array(),
      },
      rawTlvs: new Map(),
    },
  };
}

async function main() {
  const timeoutMs = Number(process.env.MIKROTIK_TIMEOUT_MS ?? 5_000);
  const devices = await discoverNeighbors({
    timeoutMs: 3_000,
  });

  console.table(devices.map(summarize));

  const candidate =
    directCandidateFromEnv() ??
    devices.find(
      (device) => device.source === "mndp" && device.address && device.address !== "0.0.0.0"
    );
  if (!candidate?.address) {
    console.log("No reachable neighbor found over MNDP.");
    console.log(
      "Set MIKROTIK_HOST and optionally MIKROTIK_PORT / MIKROTIK_TLS for direct connection."
    );
    return;
  }

  const username = "admin";
  const password = "admin";
  if (!username) {
    console.log("Set MIKROTIK_USERNAME and MIKROTIK_PASSWORD to continue.");
    return;
  }

  const client = new RouterOSClient({
    host: candidate.address,
    tls: process.env.MIKROTIK_TLS === "true",
    username,
    password,
    timeoutMs,
    ...(process.env.MIKROTIK_PORT ? { port: Number.parseInt(process.env.MIKROTIK_PORT, 10) } : {}),
  });

  try {
    console.log(
      `Connecting to ${candidate.address}:${process.env.MIKROTIK_PORT ?? (process.env.MIKROTIK_TLS === "true" ? "8729" : "8728")} with a ${timeoutMs}ms timeout...`
    );
    const [identity, resource] = await Promise.all([
      client.system.identity.get(),
      client.system.resource.get({
        proplist: ["version", "board-name", "platform"],
      }),
    ]);

    console.log("Connected neighbor:");
    console.log({
      discoveredIdentity: candidate.identity,
      authenticatedIdentity: identity?.name,
      version: resource?.version,
      boardName: resource?.["board-name"],
      platform: resource?.platform,
    });
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
