import { describe, expect, it } from "vitest";
import { DatacenterManager } from "../datacenter";
import type { ManagedDeviceClient } from "../../device";
import { ROUTEROS_CAPABILITIES, SWITCHOS_CAPABILITIES } from "../../device";
import { FabricManager } from "./index";

function createMockClient(callLog: string[] = []) {
  return {
    os: "routeros",
    capabilities: ROUTEROS_CAPABILITIES,
    raw: {},
    snapshot: async (deviceId: string) => ({
      id: deviceId,
      os: "routeros",
      capabilities: ROUTEROS_CAPABILITIES,
      identity: "leaf1",
      version: "7.17.2",
    }),
    inspectPlanItem: async (item: { kind: string }) => ({
      status: item.kind === "bond" ? "create" : "noop",
    }),
    applyPlanItem: async (item: { kind: string; payload: unknown }) => {
      const prefix =
        item.kind === "wireguard-interface"
          ? "wg-interface"
          : item.kind === "wireguard-peer"
            ? "wg-peer"
            : item.kind;
      callLog.push(`${prefix}:${JSON.stringify(item.payload)}`);
    },
    close: async () => undefined,
  } as unknown as ManagedDeviceClient;
}

describe("FabricManager", () => {
  it("builds generic networking plan from links segments peers and tunnels", () => {
    const inventory = new DatacenterManager([
      {
        id: "dev-leaf1",
        host: "10.0.0.11",
      },
    ]);

    const device = inventory.get("dev-leaf1");
    if (!device) throw new Error("Missing inventory device");
    device.client = createMockClient();

    const fabric = new FabricManager({
      inventory,
      nodes: [
        {
          id: "leaf1",
          deviceId: "dev-leaf1",
          site: "dc1",
          role: "leaf",
          fabric: "prod",
          bridgeName: "bridge-fabric",
          asn: 65001,
          loopback: "10.255.255.1",
          tags: ["fabric"],
        },
      ],
      links: [
        {
          id: "srv1",
          kind: "mlag",
          lacpRate: "1sec",
          endpoints: [
            {
              nodeId: "leaf1",
              members: ["ether1", "ether2"],
              bondName: "bond-srv1",
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
              tagged: ["bridge-fabric", "bond-srv1"],
            },
          ],
        },
      ],
      bgpPeers: [
        {
          id: "core1",
          nodeId: "leaf1",
          name: "core1",
          remoteAddress: "10.255.255.2",
          remoteAs: 65000,
          templateName: "fabric-ebgp",
        },
      ],
      wireguardTunnels: [
        {
          id: "site2",
          nodeId: "leaf1",
          interfaceName: "wg-site2",
          peerPublicKey: "PUBKEY",
          allowedAddresses: ["10.20.0.0/16"],
        },
      ],
    });

    const plan = fabric.plan({ fabric: "prod" });
    expect(plan.map((item) => item.kind)).toEqual([
      "bond",
      "bridge-port",
      "bridge-vlan",
      "bgp-template",
      "bgp-connection",
      "wireguard-interface",
      "wireguard-peer",
    ]);
  });

  it("applies supported plan items through router helpers", async () => {
    const calls: string[] = [];
    const inventory = new DatacenterManager([
      {
        id: "dev-leaf1",
        host: "10.0.0.11",
      },
    ]);

    const device = inventory.get("dev-leaf1");
    if (!device) throw new Error("Missing inventory device");
    device.client = createMockClient(calls);

    const fabric = new FabricManager({ inventory });
    await fabric.apply([
      {
        id: "1",
        nodeId: "leaf1",
        deviceId: "dev-leaf1",
        kind: "bond",
        summary: "bond",
        payload: { name: "bond1", slaves: ["ether1", "ether2"], mode: "802.3ad" },
      },
      {
        id: "2",
        nodeId: "leaf1",
        deviceId: "dev-leaf1",
        kind: "bgp-connection",
        summary: "bgp",
        payload: { name: "peer1", "remote.address": "10.0.0.2", "remote.as": 65000 },
      },
      {
        id: "3",
        nodeId: "leaf1",
        deviceId: "dev-leaf1",
        kind: "wireguard-peer",
        summary: "wg",
        payload: { interface: "wg1", "public-key": "PUB", "allowed-address": ["10.0.0.0/24"] },
      },
    ]);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("bond:");
    expect(calls[1]).toContain("bgp-connection:");
    expect(calls[2]).toContain("wg-peer:");
  });

  it("surfaces unsupported switchos fabric apply cleanly", async () => {
    const inventory = new DatacenterManager([
      {
        id: "sw1",
        host: "10.0.0.21",
        os: "switchos",
      },
    ]);

    const device = inventory.get("sw1");
    if (!device) throw new Error("Missing inventory device");
    device.client = {
      os: "switchos",
      capabilities: SWITCHOS_CAPABILITIES,
      raw: {},
      snapshot: async (deviceId: string) => ({
        id: deviceId,
        os: "switchos",
        capabilities: SWITCHOS_CAPABILITIES,
        identity: "sw1",
      }),
      inspectPlanItem: async () => ({ status: "unsupported", reason: "not supported" }),
      applyPlanItem: async (item) => {
        throw new Error(`Fabric apply for switchos not implemented for ${item.kind}`);
      },
      close: async () => undefined,
    };

    const fabric = new FabricManager({ inventory });
    await expect(
      fabric.apply([
        {
          id: "1",
          nodeId: "sw1",
          deviceId: "sw1",
          kind: "bgp-connection",
          summary: "bgp",
          payload: {},
        },
      ])
    ).rejects.toThrow("bgp-connection not supported by switchos");
  });

  it("validates mixed-platform plans before apply", () => {
    const inventory = new DatacenterManager([
      {
        id: "sw1",
        host: "10.0.0.21",
        os: "switchos",
      },
    ]);

    const device = inventory.get("sw1");
    if (!device) throw new Error("Missing inventory device");
    device.client = {
      os: "switchos",
      capabilities: SWITCHOS_CAPABILITIES,
      raw: {},
      snapshot: async (deviceId: string) => ({
        id: deviceId,
        os: "switchos",
        capabilities: SWITCHOS_CAPABILITIES,
      }),
      inspectPlanItem: async () => ({ status: "unsupported", reason: "not supported" }),
      applyPlanItem: async () => undefined,
      close: async () => undefined,
    };

    const fabric = new FabricManager({ inventory });
    const errors = fabric.validatePlan([
      {
        id: "1",
        nodeId: "sw1",
        deviceId: "sw1",
        kind: "bgp-connection",
        summary: "bgp",
        payload: {},
      },
    ]);

    expect(errors).toEqual([
      expect.objectContaining({
        deviceId: "sw1",
        os: "switchos",
        reason: "bgp-connection not supported by switchos",
      }),
    ]);
  });

  it("builds grouped preview with supported and unsupported items", async () => {
    const inventory = new DatacenterManager([
      {
        id: "dev-leaf1",
        host: "10.0.0.11",
      },
      {
        id: "sw1",
        host: "10.0.0.21",
        os: "switchos",
      },
    ]);

    const router = inventory.get("dev-leaf1");
    const sw = inventory.get("sw1");
    if (!router || !sw) throw new Error("Missing inventory devices");
    router.client = createMockClient();
    sw.client = {
      os: "switchos",
      capabilities: SWITCHOS_CAPABILITIES,
      raw: {},
      snapshot: async (deviceId: string) => ({
        id: deviceId,
        os: "switchos",
        capabilities: SWITCHOS_CAPABILITIES,
        identity: "sw1",
        boardName: "CSS610",
      }),
      inspectPlanItem: async () => ({ status: "unsupported", reason: "not supported" }),
      applyPlanItem: async () => undefined,
      close: async () => undefined,
    };

    const fabric = new FabricManager({ inventory });
    const preview = await fabric.previewPlan([
      {
        id: "1",
        nodeId: "leaf1",
        deviceId: "dev-leaf1",
        kind: "bond",
        summary: "bond",
        payload: { name: "bond1", slaves: ["ether1", "ether2"], mode: "802.3ad" },
      },
      {
        id: "2",
        nodeId: "sw1",
        deviceId: "sw1",
        kind: "bgp-connection",
        summary: "bgp",
        payload: {},
      },
    ]);

    expect(preview.supported.map((item) => item.id)).toEqual(["1"]);
    expect(preview.unsupported.map((item) => item.id)).toEqual(["2"]);
    expect(preview.devices).toEqual([
      expect.objectContaining({
        deviceId: "dev-leaf1",
        os: "routeros",
        supported: true,
        nodeIds: ["leaf1"],
        items: [
          expect.objectContaining({
            id: "1",
            inspection: expect.objectContaining({ status: "create" }),
          }),
        ],
      }),
      expect.objectContaining({
        deviceId: "sw1",
        os: "switchos",
        supported: false,
        nodeIds: ["sw1"],
        items: [
          expect.objectContaining({
            id: "2",
            inspection: expect.objectContaining({ status: "unsupported" }),
          }),
        ],
        validationErrors: [
          expect.objectContaining({
            reason: "bgp-connection not supported by switchos",
          }),
        ],
      }),
    ]);
  });
});
