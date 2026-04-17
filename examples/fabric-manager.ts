import { DatacenterManager, FabricManager } from "../src/experimental/index";

async function main() {
  const inventory = new DatacenterManager([
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
  ]);

  const fabric = new FabricManager({
    inventory,
    nodes: [
      {
        id: "leaf1",
        deviceId: "dc1-leaf1",
        site: "dc1",
        role: "leaf",
        fabric: "prod",
        bridgeName: "bridge-fabric",
        asn: 65001,
        loopback: "10.255.255.1",
        tags: ["fabric", "mlag"],
      },
      {
        id: "leaf2",
        deviceId: "dc1-leaf2",
        site: "dc1",
        role: "leaf",
        fabric: "prod",
        bridgeName: "bridge-fabric",
        asn: 65001,
        loopback: "10.255.255.2",
        tags: ["fabric", "mlag"],
      },
    ],
    links: [
      {
        id: "server01",
        kind: "mlag",
        mode: "802.3ad",
        lacpRate: "1sec",
        endpoints: [
          {
            nodeId: "leaf1",
            members: ["ether1", "ether2"],
            bondName: "bond-server01",
            bridge: "bridge-fabric",
            mlagId: 10,
          },
          {
            nodeId: "leaf2",
            members: ["ether1", "ether2"],
            bondName: "bond-server01",
            bridge: "bridge-fabric",
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
          { nodeId: "leaf1", bridge: "bridge-fabric", tagged: ["bridge-fabric", "bond-server01"] },
          { nodeId: "leaf2", bridge: "bridge-fabric", tagged: ["bridge-fabric", "bond-server01"] },
        ],
      },
    ],
    bgpPeers: [
      {
        id: "spine1-leaf1",
        nodeId: "leaf1",
        name: "spine1",
        remoteAddress: "10.255.0.1",
        remoteAs: 65000,
        templateName: "fabric-ebgp",
      },
      {
        id: "spine1-leaf2",
        nodeId: "leaf2",
        name: "spine1",
        remoteAddress: "10.255.0.2",
        remoteAs: 65000,
        templateName: "fabric-ebgp",
      },
    ],
  });

  try {
    const plan = fabric.plan({ fabric: "prod" });
    console.log(plan);
  } finally {
    await fabric.close();
  }
}

void main();
