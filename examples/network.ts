import { RouterOSClient } from "../src/index";

async function main() {
  const client = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: process.env.MIKROTIK_USERNAME ?? "admin",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    tls: process.env.MIKROTIK_TLS === "true",
    port: process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined,
  });

  try {
    const [bonds, bridges, bridgePorts, bridgeVlans, pppSecrets, routingRules] = await Promise.all([
      client.interface.bonding.list({
        proplist: [".id", "name", "mode", "slaves", "lacp-rate", "mlag-id"],
      }),
      client.bridge.list({
        proplist: [".id", "name", "vlan-filtering", "disabled"],
      }),
      client.bridge.port.list({
        proplist: [".id", "bridge", "interface", "pvid", "disabled"],
      }),
      client.bridge.vlan.list({
        proplist: [".id", "bridge", "vlan-ids", "tagged", "untagged"],
      }),
      client.ppp.secret.list({
        proplist: [".id", "name", "service", "profile", "disabled"],
      }),
      client.routing.rule.list({
        proplist: [".id", "action", "table", "src-address", "dst-address", "disabled"],
      }),
    ]);

    console.log({
      bonds,
      bridges,
      bridgePorts,
      bridgeVlans,
      pppSecrets,
      routingRules,
    });
  } finally {
    await client.close();
  }
}

void main();
