import { DatacenterManager } from "../src/experimental/index";
import { RouterOSClient } from "../src/routeros/index";

async function main() {
  const manager = new DatacenterManager([
    {
      id: "dc1-leaf1",
      host: process.env.DC1_LEAF1_HOST ?? "10.0.0.11",
      username: process.env.MIKROTIK_USERNAME ?? "admin",
      password: process.env.MIKROTIK_PASSWORD ?? "",
      site: "dc1",
      role: "leaf",
      tags: ["fabric", "mlag"],
    },
    {
      id: "dc1-leaf2",
      host: process.env.DC1_LEAF2_HOST ?? "10.0.0.12",
      username: process.env.MIKROTIK_USERNAME ?? "admin",
      password: process.env.MIKROTIK_PASSWORD ?? "",
      site: "dc1",
      role: "leaf",
      tags: ["fabric", "mlag"],
    },
    {
      id: "dc1-edge1",
      host: process.env.DC1_EDGE1_HOST ?? "10.0.1.1",
      username: process.env.MIKROTIK_USERNAME ?? "admin",
      password: process.env.MIKROTIK_PASSWORD ?? "",
      site: "dc1",
      role: "edge",
      tags: ["wan"],
    },
  ]);

  try {
    const fabricSnapshot = await manager.snapshot({ tags: ["fabric"] });

    const bondStates = await manager.run({ site: "dc1", role: "leaf" }, async (device) => {
      const client = device.client.raw as RouterOSClient;
      return {
        device: device.id,
        identity: await client.system.identity.get(),
        bonds: await client.interface.bonding.list({
          proplist: [".id", "name", "mode", "slaves", "mlag-id"],
        }),
        vlans: await client.bridge.vlan.list({
          proplist: [".id", "bridge", "vlan-ids", "tagged"],
        }),
      };
    });

    console.log({
      fabricSnapshot,
      bondStates,
    });
  } finally {
    await manager.close();
  }
}

void main();
