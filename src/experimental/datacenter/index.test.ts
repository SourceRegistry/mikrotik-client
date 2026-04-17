import { describe, expect, it } from "vitest";
import { DatacenterManager } from "./index";
import type { DevicePlanItem, ManagedDeviceClient } from "../../device";
import { ROUTEROS_CAPABILITIES, SWITCHOS_CAPABILITIES } from "../../device";

function createMockClient(
  identity: string,
  version: string,
  board = "CCR",
  platform = "MikroTik"
) {
  return {
    os: "routeros",
    capabilities: ROUTEROS_CAPABILITIES,
    raw: {},
    snapshot: async (deviceId: string) => ({
      id: deviceId,
      os: "routeros",
      capabilities: ROUTEROS_CAPABILITIES,
      identity,
      version,
      boardName: board,
      platform,
      cpuLoad: "5",
      uptime: "1d",
    }),
    inspectPlanItem: async () => ({ status: "noop" }),
    applyPlanItem: async (_item: DevicePlanItem) => undefined,
    close: async () => undefined,
  } as unknown as ManagedDeviceClient;
}

describe("DatacenterManager", () => {
  it("segments devices by site role and tags", async () => {
    const manager = new DatacenterManager();

    const dc1Leaf = manager.add({
      id: "dc1-leaf1",
      host: "10.0.0.11",
      site: "dc1",
      role: "leaf",
      tags: ["fabric", "mlag"],
    });
    dc1Leaf.client = createMockClient("dc1-leaf1", "7.17.2");

    const dc2Edge = manager.add({
      id: "dc2-edge1",
      host: "10.1.0.1",
      site: "dc2",
      role: "edge",
      tags: ["wan"],
    });
    dc2Edge.client = createMockClient("dc2-edge1", "7.17.2");

    expect(manager.bySite("dc1").map((device) => device.id)).toEqual(["dc1-leaf1"]);
    expect(manager.byRole("edge").map((device) => device.id)).toEqual(["dc2-edge1"]);
    expect(manager.byTag("fabric").map((device) => device.id)).toEqual(["dc1-leaf1"]);

    const snapshots = await manager.snapshot({ site: "dc1" });
    expect(snapshots).toEqual([
      {
        id: "dc1-leaf1",
        os: "routeros",
        capabilities: ROUTEROS_CAPABILITIES,
        identity: "dc1-leaf1",
        version: "7.17.2",
        boardName: "CCR",
        platform: "MikroTik",
        cpuLoad: "5",
        uptime: "1d",
      },
    ]);
  });

  it("runs action across selected segment", async () => {
    const manager = new DatacenterManager();
    const leaf1 = manager.add({
      id: "leaf1",
      host: "10.0.0.11",
      site: "dc1",
      role: "leaf",
      tags: ["fabric"],
    });
    leaf1.client = createMockClient("leaf1", "7.17.2");

    const leaf2 = manager.add({
      id: "leaf2",
      host: "10.0.0.12",
      site: "dc1",
      role: "leaf",
      tags: ["fabric"],
    });
    leaf2.client = createMockClient("leaf2", "7.17.2");

    const results = await manager.run({ site: "dc1", role: "leaf" }, async (device) => {
      const snapshot = await device.client.snapshot(device.id);
      return snapshot.identity;
    });

    expect(results.map((item) => item.result)).toEqual(["leaf1", "leaf2"]);
  });

  it("supports switchos devices through same simple client interface", async () => {
    const manager = new DatacenterManager([
      {
        id: "sw1",
        host: "10.0.2.10",
        os: "switchos",
      },
    ]);

    const device = manager.get("sw1");
    if (!device) throw new Error("Missing switch device");
    device.client = {
      os: "switchos",
      capabilities: SWITCHOS_CAPABILITIES,
      raw: {},
      snapshot: async (deviceId: string) => ({
        id: deviceId,
        os: "switchos",
        capabilities: SWITCHOS_CAPABILITIES,
        identity: "sw1",
        boardName: "CSS610",
        platform: "switchos",
        uptime: "2d",
      }),
      inspectPlanItem: async () => ({ status: "noop" }),
      applyPlanItem: async (_item: DevicePlanItem) => undefined,
      close: async () => undefined,
    };

    await expect(manager.snapshot("sw1")).resolves.toEqual([
      {
        id: "sw1",
        os: "switchos",
        capabilities: SWITCHOS_CAPABILITIES,
        identity: "sw1",
        boardName: "CSS610",
        platform: "switchos",
        uptime: "2d",
      },
    ]);
  });
});
