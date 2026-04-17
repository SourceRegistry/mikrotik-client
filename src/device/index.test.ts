import { describe, expect, it } from "vitest";
import {
  createManagedDeviceClient,
  ROUTEROS_CAPABILITIES,
  SWITCHOS_CAPABILITIES,
  type DevicePlanItem,
  type ManagedDeviceClient,
} from "./index";

const classicSwitchSchema = {
  source: "test",
  endpoints: {
    "/link.b": {
      url: "/link.b",
      shape: "object",
      sections: [
        {
          tab_id: "link",
          tab_title: "Link",
          title: "",
          url: "/link.b",
          shape: "object",
          list: false,
          read_only: false,
          refresh_ms: 3000,
          controls: [
            {
              label: "Name",
              id: "nm",
              ui_type: "M",
              read_only: false,
              repeat_count: 3,
              encoding: { kind: "utf8-hex", response: "hex", request: "hex" },
              options: null,
              scale: null,
              min: null,
              max: null,
              base: 10,
              delimiter: null,
              defaults: {},
              children: [],
              wire_keys: ["nm"],
            },
          ],
        },
      ],
    },
    "/vlan.b": {
      url: "/vlan.b",
      shape: "array",
      sections: [
        {
          tab_id: "vlan",
          tab_title: "VLANs",
          title: "",
          url: "/vlan.b",
          shape: "array",
          list: true,
          read_only: false,
          refresh_ms: null,
          controls: [
            {
              label: "VLAN ID",
              id: "vid",
              ui_type: "H",
              read_only: false,
              repeat_count: 1,
              encoding: { kind: "unsigned-int", response: "int", request: "int" },
              options: null,
              scale: null,
              min: null,
              max: null,
              base: 10,
              delimiter: null,
              defaults: {},
              children: [],
              wire_keys: ["vid"],
            },
            {
              label: "IGMP Snooping",
              id: "igmp",
              ui_type: "F",
              read_only: false,
              repeat_count: 1,
              encoding: { kind: "bool-bit", response: "bit", request: "bit" },
              options: null,
              scale: null,
              min: null,
              max: null,
              base: 10,
              delimiter: null,
              defaults: {},
              children: [],
              wire_keys: ["igmp"],
            },
            {
              label: "Members",
              id: "mbr",
              ui_type: "F",
              read_only: false,
              repeat_count: 1,
              encoding: { kind: "bitset", response: "mask", request: "mask" },
              options: null,
              scale: null,
              min: null,
              max: null,
              base: 10,
              delimiter: null,
              defaults: {},
              children: [],
              wire_keys: ["mbr"],
            },
          ],
        },
      ],
    },
    "/lacp.b": {
      url: "/lacp.b",
      shape: "object",
      sections: [
        {
          tab_id: "lacp",
          tab_title: "LAG",
          title: "",
          url: "/lacp.b",
          shape: "object",
          list: false,
          read_only: false,
          refresh_ms: 3000,
          controls: [
            {
              label: "Mode",
              id: "mode",
              ui_type: "G",
              read_only: false,
              repeat_count: 3,
              encoding: { kind: "enum-index", response: "int", request: "int" },
              options: null,
              scale: null,
              min: null,
              max: null,
              base: 10,
              delimiter: null,
              defaults: {},
              children: [],
              wire_keys: ["mode"],
            },
            {
              label: "Group",
              id: "sgrp",
              ui_type: "H",
              read_only: false,
              repeat_count: 3,
              encoding: { kind: "unsigned-int", response: "int", request: "int" },
              options: null,
              scale: null,
              min: null,
              max: null,
              base: 10,
              delimiter: null,
              defaults: {},
              children: [],
              wire_keys: ["sgrp"],
            },
          ],
        },
      ],
    },
  },
} as const;

function createSwitchClient() {
  const writes: Array<{ path: string; body: string }> = [];
  const state = {
    "/link.b": "{nm:['657468657231','657468657232','657468657233']}",
    "/lacp.b": "{mode:[0x0,0x0,0x0],sgrp:[0x0,0x0,0x0]}",
    "/vlan.b": "[]",
    "/sys.b": "{id:'737731',brd:'435353363130',upt:0x2a}",
  };

  const client = createManagedDeviceClient({
    host: "10.0.0.2",
    os: "switchos",
    schema: classicSwitchSchema,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if ((init?.method ?? "GET") === "GET") {
        return new Response(state[path as keyof typeof state] ?? "{}", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const body = String(init?.body ?? "");
      writes.push({ path, body });
      if (path in state) {
        state[path as keyof typeof state] = body;
      }
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    },
  }) as ManagedDeviceClient;

  return { client, writes };
}

describe("Managed device client", () => {
  it("supports switchos snapshots through common interface", async () => {
    const { client } = createSwitchClient();
    await expect(client.snapshot("sw1")).resolves.toEqual({
      id: "sw1",
      os: "switchos",
      capabilities: SWITCHOS_CAPABILITIES,
      identity: "sw1",
      boardName: "CSS610",
      platform: "switchos",
      uptime: "42",
      version: undefined,
      cpuLoad: undefined,
    });
  });

  it("applies switchos bond and vlan plan items", async () => {
    const { client, writes } = createSwitchClient();

    const bond: DevicePlanItem = {
      id: "bond:sw1:lag1",
      nodeId: "sw1",
      deviceId: "sw1",
      kind: "bond",
      summary: "bond",
      payload: {
        name: "bond-uplink",
        slaves: ["ether1", "ether2"],
        mode: "802.3ad",
        "mlag-id": 5,
      },
    };
    const vlan: DevicePlanItem = {
      id: "vlan:sw1:20",
      nodeId: "sw1",
      deviceId: "sw1",
      kind: "bridge-vlan",
      summary: "vlan",
      payload: {
        "vlan-ids": 20,
        tagged: ["bond-uplink"],
      },
    };

    await client.applyPlanItem(bond);
    await client.applyPlanItem(vlan);

    expect(writes).toEqual([
      {
        path: "/lacp.b",
        body: "{mode:[0x1,0x1,0x0],sgrp:[0x5,0x5,0x0]}",
      },
      {
        path: "/vlan.b",
        body: "[{vid:0x14,mbr:0x3,igmp:0x0}]",
      },
    ]);
  });

  it("treats switchos bridge-port apply as no-op", async () => {
    const { client, writes } = createSwitchClient();

    await client.applyPlanItem({
      id: "bp",
      nodeId: "sw1",
      deviceId: "sw1",
      kind: "bridge-port",
      summary: "bp",
      payload: { interface: "bond1" },
    });

    expect(writes).toEqual([]);
  });

  it("inspects switchos items as create/noop/update", async () => {
    const { client } = createSwitchClient();
    const bond: DevicePlanItem = {
      id: "bond:sw1:lag1",
      nodeId: "sw1",
      deviceId: "sw1",
      kind: "bond",
      summary: "bond",
      payload: {
        name: "bond-uplink",
        slaves: ["ether1", "ether2"],
        mode: "802.3ad",
        "mlag-id": 5,
      },
    };

    await expect(client.inspectPlanItem(bond)).resolves.toEqual({ status: "create" });
    await client.applyPlanItem(bond);
    await expect(client.inspectPlanItem(bond)).resolves.toEqual({ status: "noop" });
    await expect(
      client.inspectPlanItem({
        ...bond,
        payload: { ...bond.payload, slaves: ["ether1", "ether3"] },
      })
    ).resolves.toEqual({ status: "update" });
  });

  it("rejects unsupported switchos routing plan items", async () => {
    const { client } = createSwitchClient();

    await expect(
      client.applyPlanItem({
        id: "bgp",
        nodeId: "sw1",
        deviceId: "sw1",
        kind: "bgp-connection",
        summary: "bgp",
        payload: {},
      })
    ).rejects.toThrow("not implemented");
  });

  it("publishes useful capability defaults", () => {
    const router = createManagedDeviceClient({
      host: "10.0.0.1",
      os: "routeros",
    });

    expect(router.capabilities).toEqual(ROUTEROS_CAPABILITIES);
    expect(router.snapshot).toBeTypeOf("function");
    expect(createSwitchClient().client.capabilities).toEqual(SWITCHOS_CAPABILITIES);
  });
});
