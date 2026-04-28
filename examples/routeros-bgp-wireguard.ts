import { RouterOSClient } from "../src/index";

async function main() {
  const client = new RouterOSClient({
    host: process.env.MIKROTIK_HOST ?? "192.168.88.1",
    username: process.env.MIKROTIK_USERNAME ?? "admin",
    password: process.env.MIKROTIK_PASSWORD ?? "",
    tls: process.env.MIKROTIK_TLS === "true",
    ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
  });

  try {
    await client.wireguard.interface.add({
      name: "wg-site2",
      "listen-port": 51820,
      comment: "Site-to-site underlay",
    });

    await client.ip.address.add({
      address: "10.255.255.1/30",
      interface: "wg-site2",
      comment: "WG transit",
    });

    await client.wireguard.peer.add({
      interface: "wg-site2",
      "public-key": "REMOTE_PUBLIC_KEY_HERE",
      "allowed-address": ["10.255.255.2/32", "10.20.0.0/16"],
      "endpoint-address": "site2.example.net",
      "endpoint-port": 51820,
      "persistent-keepalive": 25,
      comment: "Remote site peer",
    });

    await client.routing.bgp.template.add({
      name: "wan-ebgp",
      as: 65001,
      "router-id": "10.255.255.1",
      "routing-table": "main",
    });

    await client.routing.bgp.connection.add({
      name: "site2-ebgp",
      as: 65001,
      connect: true,
      listen: false,
      multihop: true,
      "local.address": "10.255.255.1",
      "remote.address": "10.255.255.2",
      "remote.as": 65002,
      templates: "wan-ebgp",
      comment: "BGP over WireGuard to site2",
    });

    const [wgInterfaces, wgPeers, bgpTemplates, bgpConnections] = await Promise.all([
      client.wireguard.interface.list({
        proplist: [".id", "name", "listen-port", "running"],
      }),
      client.wireguard.peer.list({
        proplist: [".id", "interface", "allowed-address", "endpoint-address", "endpoint-port"],
      }),
      client.routing.bgp.template.list({
        proplist: [".id", "name", "as", "router-id", "routing-table"],
      }),
      client.routing.bgp.connection.list({
        proplist: [".id", "name", "remote.address", "remote.as", "local.address", "multihop"],
      }),
    ]);

    console.log({ wgInterfaces, wgPeers, bgpTemplates, bgpConnections });
  } finally {
    await client.close();
  }
}

void main();
