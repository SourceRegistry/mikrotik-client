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
    await client.bridge.add({
      name: "bridge-dc",
      "vlan-filtering": true,
      "protocol-mode": "none",
      comment: "Datacenter fabric bridge",
    });

    await client.bridge.set("*4", {
      mlag: true,
      "mlag-id": 10,
      priority: "0x1000",
    });

    await client.interface.bonding.add({
      name: "bond-server01",
      mode: "802.3ad",
      slaves: ["ether1", "ether2"],
      "lacp-rate": "1sec",
      "mlag-id": 10,
      "transmit-hash-policy": "layer-2-and-3",
      comment: "Server dual-homed LACP bond",
    });

    await client.bridge.port.add({
      bridge: "bridge-dc",
      interface: "bond-server01",
      comment: "Server bond uplink",
    });

    await client.bridge.vlan.add({
      bridge: "bridge-dc",
      "vlan-ids": [10, 20, 30],
      tagged: ["bridge-dc", "bond-server01"],
      comment: "Server VLAN trunk",
    });

    const [bridges, bonds, vlans] = await Promise.all([
      client.bridge.list({
        proplist: [".id", "name", "mlag", "mlag-id", "vlan-filtering"],
      }),
      client.interface.bonding.list({
        proplist: [".id", "name", "mode", "slaves", "lacp-rate", "mlag-id"],
      }),
      client.bridge.vlan.list({
        proplist: [".id", "bridge", "vlan-ids", "tagged", "untagged"],
      }),
    ]);

    console.log({ bridges, bonds, vlans });
  } finally {
    await client.close();
  }
}

void main();
