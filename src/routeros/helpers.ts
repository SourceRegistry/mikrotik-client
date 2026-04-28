import type {
  RouterOSCommandOptions,
  RouterOSListenOptions,
  RouterOSPrimitive,
  RouterOSRecord,
  RouterOSStream,
} from "./index";
import type { DeviceTransport } from "./transport";
import { parseBool, parseInteger } from "../utils/codecs";
import { createCapsManHelpers } from "./capsman";
import type { CapsManHelpers } from "./capsman";

export type RouterOSPrintOptions = {
  proplist?: readonly string[];
  queries?: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type RouterOSMonitorOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

// ─── DTO types ────────────────────────────────────────────────────────────────
// All fields are optional because RouterOS may omit fields when proplist is used
// or when a field is not applicable to the current device/configuration.

export type RouterOSSystemResource = {
  uptime?: string;
  version?: string;
  build?: string;
  platform?: string;
  "board-name"?: string;
  "cpu-load"?: number;
  "cpu-count"?: number;
  "free-memory"?: number;
  "total-memory"?: number;
};

export type RouterOSIdentity = {
  name?: string;
};

export type RouterOSPackageUpdateStatus = {
  channel?: string;
  status?: string;
  "installed-version"?: string;
  "latest-version"?: string;
};

export type RouterOSRouterboard = {
  routerboard?: boolean;
  model?: string;
  "current-firmware"?: string;
  "upgrade-firmware"?: string;
  "factory-firmware"?: string;
};

export type RouterOSInterface = {
  ".id"?: string;
  name?: string;
  type?: string;
  running?: boolean;
  disabled?: boolean;
  mtu?: number;
  "actual-mtu"?: number;
  "mac-address"?: string;
};

export type RouterOSWirelessRegistration = {
  ".id"?: string;
  interface?: string;
  ssid?: string;
  "mac-address"?: string;
  uptime?: string;
  "last-activity"?: string;
  signal?: string;
  band?: string;
  "auth-type"?: string;
};

export type RouterOSBonding = {
  ".id"?: string;
  name?: string;
  mode?: string;
  slaves?: string;
  "lacp-rate"?: string;
  "mlag-id"?: string;
  disabled?: boolean;
  comment?: string;
};

export type RouterOSIpAddress = {
  ".id"?: string;
  address?: string;
  interface?: string;
  network?: string;
  disabled?: boolean;
  dynamic?: boolean;
  comment?: string;
};

export type RouterOSIpRoute = {
  ".id"?: string;
  "dst-address"?: string;
  gateway?: string;
  distance?: number;
  disabled?: boolean;
  comment?: string;
  "routing-table"?: string;
  "vrf-interface"?: string;
};

export type RouterOSDhcpLease = {
  ".id"?: string;
  address?: string;
  "mac-address"?: string;
  "host-name"?: string;
  server?: string;
  status?: string;
  dynamic?: boolean;
  disabled?: boolean;
  comment?: string;
};

export type RouterOSNeighbor = {
  ".id"?: string;
  interface?: string;
  address?: string;
  address6?: string;
  "mac-address"?: string;
  identity?: string;
  version?: string;
  board?: string;
  platform?: string;
  "discovered-by"?: string;
  uptime?: string;
};

export type RouterOSIpsecPeer = {
  ".id"?: string;
  name?: string;
  address?: string;
  "local-address"?: string;
  profile?: string;
  "exchange-mode"?: string;
  disabled?: boolean;
};

export type RouterOSFirewallFilterRule = {
  ".id"?: string;
  chain?: string;
  action?: string;
  disabled?: boolean;
  comment?: string;
  protocol?: string;
  "src-address"?: string;
  "dst-address"?: string;
};

export type RouterOSIpService = {
  ".id"?: string;
  name?: string;
  port?: number;
  address?: string;
  disabled?: boolean;
  certificate?: string;
  vrf?: string;
  "tls-version"?: string;
};

export type RouterOSIpv6Neighbor = {
  ".id"?: string;
  address?: string;
  "mac-address"?: string;
  interface?: string;
  vrf?: string;
  router?: boolean;
};

export type RouterOSBridge = {
  ".id"?: string;
  name?: string;
  "vlan-filtering"?: boolean;
  "protocol-mode"?: string;
  comment?: string;
  disabled?: boolean;
};

export type RouterOSBridgePort = {
  ".id"?: string;
  bridge?: string;
  interface?: string;
  pvid?: number;
  "frame-types"?: string;
  edge?: string;
  comment?: string;
  disabled?: boolean;
};

export type RouterOSBridgeVlan = {
  ".id"?: string;
  bridge?: string;
  tagged?: string;
  untagged?: string;
  "vlan-ids"?: string;
  disabled?: boolean;
  comment?: string;
};

export type RouterOSBridgeMonitor = {
  state?: string;
  "current-mac-address"?: string;
  "bridge-id"?: string;
  "root-bridge"?: boolean;
  "root-bridge-id"?: string;
  "regional-root-bridge-id"?: string;
  "root-path-cost"?: number;
  "root-port"?: string;
  "port-count"?: number;
  "designated-port-count"?: number;
  "mst-config-digest"?: string;
  "fast-forward"?: boolean;
  "multicast-router"?: boolean;
  "igmp-querier"?: boolean;
  "mld-querier"?: boolean;
  "declared-vlan-ids"?: string;
  "registered-vlan-ids"?: string;
};

export type RouterOSBridgePortMonitor = {
  interface?: string;
  status?: string;
  "port-id"?: string;
  role?: string;
  "edge-port"?: boolean;
  "edge-port-discovery"?: boolean;
  "point-to-point-port"?: boolean;
  "external-fdb"?: boolean;
  "sending-rstp"?: boolean;
  learning?: boolean;
  forwarding?: boolean;
  "actual-path-cost"?: number;
  "internal-root-path-cost"?: number;
  "designated-bridge-id"?: string;
  "designated-port-id"?: string;
  "designated-remaining-hops"?: number;
  "declared-vlan-ids"?: string;
  "registered-vlan-ids"?: string;
};

export type RouterOSPppSecret = {
  ".id"?: string;
  name?: string;
  password?: string;
  service?: string;
  profile?: string;
  "local-address"?: string;
  "remote-address"?: string;
  disabled?: boolean;
  comment?: string;
};

export type RouterOSRoutingRule = {
  ".id"?: string;
  action?: string;
  table?: string;
  "src-address"?: string;
  "dst-address"?: string;
  interface?: string;
  disabled?: boolean;
  comment?: string;
};

export type RouterOSWireGuardInterface = {
  ".id"?: string;
  name?: string;
  "listen-port"?: number;
  mtu?: number;
  disabled?: boolean;
  "public-key"?: string;
  "private-key"?: string;
  running?: boolean;
};

export type RouterOSWireGuardPeer = {
  ".id"?: string;
  interface?: string;
  "public-key"?: string;
  "allowed-address"?: string;
  "endpoint-address"?: string;
  "endpoint-port"?: number;
  "persistent-keepalive"?: string;
  disabled?: boolean;
  comment?: string;
};

export type RouterOSBgpConnection = {
  ".id"?: string;
  name?: string;
  as?: string;
  connect?: boolean;
  listen?: boolean;
  disabled?: boolean;
  multihop?: boolean;
  vrf?: string;
  "remote.address"?: string;
  "remote.as"?: string;
  "local.address"?: string;
  "local.role"?: string;
  "router-id"?: string;
};

export type RouterOSBgpTemplate = {
  ".id"?: string;
  name?: string;
  as?: string;
  disabled?: boolean;
  vrf?: string;
  "routing-table"?: string;
  "router-id"?: string;
};

export type RouterOSLteMonitor = {
  ".id"?: string;
  imei?: string;
  model?: string;
  manufacturer?: string;
  revision?: string;
  "current-operator"?: string;
  "access-technology"?: string;
  signal?: number;
  rssi?: number;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  roaming?: boolean;
};

// ─── RouterOSHelpers type ─────────────────────────────────────────────────────

export type RouterOSHelpers = {
  system: {
    resource: {
      get(options?: RouterOSPrintOptions): Promise<RouterOSSystemResource | undefined>;
    };
    identity: {
      get(options?: RouterOSPrintOptions): Promise<RouterOSIdentity | undefined>;
      set(name: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
    package: {
      update: {
        checkForUpdates(
          options?: Omit<RouterOSCommandOptions, "attributes">
        ): Promise<RouterOSPackageUpdateStatus | undefined>;
        install(options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
      };
    };
    routerboard: {
      get(options?: RouterOSPrintOptions): Promise<RouterOSRouterboard | undefined>;
      upgrade(options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
    reboot(options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    exportConfig(
      attributes: {
        file: string;
        compact?: boolean;
        terse?: boolean;
        verbose?: boolean;
        "show-sensitive"?: boolean;
        path?: string;
      },
      options?: Omit<RouterOSCommandOptions, "attributes">
    ): Promise<void>;
  };
  interface: {
    list(options?: RouterOSPrintOptions): Promise<RouterOSInterface[]>;
    listen(options?: RouterOSListenOptions): Promise<RouterOSStream>;
    enable(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    disable(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    wireless: {
      registrationTable: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSWirelessRegistration[]>;
      };
    };
    wifi: {
      registrationTable: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSWirelessRegistration[]>;
      };
    };
    lte: {
      monitor(
        interfaceId: string,
        options?: RouterOSMonitorOptions
      ): Promise<RouterOSLteMonitor | undefined>;
    };
    bonding: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSBonding[]>;
      add(
        attributes: {
          name: string;
          slaves: string | readonly string[];
          mode?:
          | "802.3ad"
          | "balance-xor"
          | "active-backup"
          | "balance-rr"
          | "broadcast"
          | "balance-tlb"
          | "balance-alb";
          "lacp-rate"?: "30secs" | "1sec";
          "mlag-id"?: string | number;
          "transmit-hash-policy"?: string;
          "link-monitoring"?: "mii" | "arp" | "none";
          "mii-interval"?: string | number;
          "arp-ip-targets"?: string | readonly string[];
          primary?: string;
          mtu?: string | number;
          disabled?: boolean;
          comment?: string;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
  };
  bridge: {
    list(options?: RouterOSPrintOptions): Promise<RouterOSBridge[]>;
    monitor(
      bridgeId: string,
      options?: RouterOSMonitorOptions
    ): Promise<RouterOSBridgeMonitor | undefined>;
    add(
      attributes: {
        name: string;
        comment?: string;
        disabled?: boolean;
        "vlan-filtering"?: boolean;
        "protocol-mode"?: string;
      },
      options?: Omit<RouterOSCommandOptions, "attributes">
    ): Promise<void>;
    remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    set(
      id: string,
      attributes: Record<string, RouterOSPrimitive>,
      options?: Omit<RouterOSCommandOptions, "attributes">
    ): Promise<void>;
    port: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSBridgePort[]>;
      monitor(
        portId: string,
        options?: RouterOSMonitorOptions
      ): Promise<RouterOSBridgePortMonitor | undefined>;
      add(
        attributes: {
          bridge: string;
          interface: string;
          pvid?: number | string;
          comment?: string;
          disabled?: boolean;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
      set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
    };
    vlan: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSBridgeVlan[]>;
      add(
        attributes: {
          bridge: string;
          "vlan-ids": string | number | readonly (string | number)[];
          tagged?: string | readonly string[];
          untagged?: string | readonly string[];
          disabled?: boolean;
          comment?: string;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
  };
  ip: {
    neighbor: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSNeighbor[]>;
    };
    ipsec: {
      peer: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSIpsecPeer[]>;
      };
    };
    route: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSIpRoute[]>;
    };
    dhcpServer: {
      lease: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSDhcpLease[]>;
      };
    };
    service: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSIpService[]>;
      set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
    };
    address: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSIpAddress[]>;
      add(
        attributes: {
          address: string;
          interface: string;
          network?: string;
          comment?: string;
          disabled?: boolean;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      set(
        id: string,
        attributes: {
          address?: string;
          interface?: string;
          network?: string;
          comment?: string;
          disabled?: boolean;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
    firewall: {
      filter: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSFirewallFilterRule[]>;
        add(
          attributes: Record<string, RouterOSPrimitive>,
          options?: Omit<RouterOSCommandOptions, "attributes">
        ): Promise<void>;
        remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
      };
    };
  };
  wireguard: {
    interface: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSWireGuardInterface[]>;
      add(
        attributes: {
          name: string;
          "listen-port"?: string | number;
          mtu?: string | number;
          "private-key"?: string;
          disabled?: boolean;
          comment?: string;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
    peer: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSWireGuardPeer[]>;
      add(
        attributes: {
          interface: string;
          "public-key": string;
          "allowed-address": string | readonly string[];
          "endpoint-address"?: string;
          "endpoint-port"?: string | number;
          "persistent-keepalive"?: string | number;
          disabled?: boolean;
          comment?: string;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
  };
  ppp: {
    secret: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSPppSecret[]>;
      add(
        attributes: {
          name: string;
          password: string;
          service?: string;
          profile?: string;
          disabled?: boolean;
          comment?: string;
          "local-address"?: string;
          "remote-address"?: string;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      set(
        id: string,
        attributes: {
          password?: string;
          service?: string;
          profile?: string;
          disabled?: boolean;
          comment?: string;
          "local-address"?: string;
          "remote-address"?: string;
        },
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
  };
  routing: {
    bgp: {
      connection: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSBgpConnection[]>;
        add(
          attributes: Record<string, RouterOSPrimitive>,
          options?: Omit<RouterOSCommandOptions, "attributes">
        ): Promise<void>;
        set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options?: Omit<RouterOSCommandOptions, "attributes">
        ): Promise<void>;
        remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
      };
      template: {
        list(options?: RouterOSPrintOptions): Promise<RouterOSBgpTemplate[]>;
        add(
          attributes: Record<string, RouterOSPrimitive>,
          options?: Omit<RouterOSCommandOptions, "attributes">
        ): Promise<void>;
        set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options?: Omit<RouterOSCommandOptions, "attributes">
        ): Promise<void>;
        remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
      };
    };
    rule: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSRoutingRule[]>;
      add(
        attributes: Record<string, RouterOSPrimitive>,
        options?: Omit<RouterOSCommandOptions, "attributes">
      ): Promise<void>;
      remove(id: string, options?: Omit<RouterOSCommandOptions, "attributes">): Promise<void>;
    };
  };
  capsman: CapsManHelpers;
  ipv6: {
    neighbor: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSIpv6Neighbor[]>;
    };
  };
};

// ─── Parse functions ──────────────────────────────────────────────────────────
// Each function maps a raw RouterOSRecord (all-string values) to a typed DTO.
// Only known fields are included; extra fields returned by the device are dropped.
//
// Pattern: extract each field to a const, then use conditional spreads so that
// TypeScript can narrow away `undefined` at the assignment site
// (required by exactOptionalPropertyTypes).

function parseSystemResource(raw: RouterOSRecord): RouterOSSystemResource {
  const uptime = raw["uptime"];
  const version = raw["version"];
  const build = raw["build"];
  const platform = raw["platform"];
  const boardName = raw["board-name"];
  const cpuLoad = raw["cpu-load"];
  const cpuCount = raw["cpu-count"];
  const freeMem = raw["free-memory"];
  const totalMem = raw["total-memory"];
  return {
    ...(uptime !== undefined && { uptime }),
    ...(version !== undefined && { version }),
    ...(build !== undefined && { build }),
    ...(platform !== undefined && { platform }),
    ...(boardName !== undefined && { "board-name": boardName }),
    ...(cpuLoad !== undefined && { "cpu-load": parseInteger(cpuLoad) }),
    ...(cpuCount !== undefined && { "cpu-count": parseInteger(cpuCount) }),
    ...(freeMem !== undefined && { "free-memory": parseInteger(freeMem) }),
    ...(totalMem !== undefined && { "total-memory": parseInteger(totalMem) }),
  };
}

function parseIdentity(raw: RouterOSRecord): RouterOSIdentity {
  const name = raw["name"];
  return { ...(name !== undefined && { name }) };
}

function parsePackageUpdateStatus(raw: RouterOSRecord): RouterOSPackageUpdateStatus {
  const channel = raw["channel"];
  const status = raw["status"];
  const installed = raw["installed-version"];
  const latest = raw["latest-version"];
  return {
    ...(channel !== undefined && { channel }),
    ...(status !== undefined && { status }),
    ...(installed !== undefined && { "installed-version": installed }),
    ...(latest !== undefined && { "latest-version": latest }),
  };
}

function parseRouterboard(raw: RouterOSRecord): RouterOSRouterboard {
  const routerboard = raw["routerboard"];
  const model = raw["model"];
  const current = raw["current-firmware"];
  const upgrade = raw["upgrade-firmware"];
  const factory = raw["factory-firmware"];
  return {
    ...(routerboard !== undefined && { routerboard: parseBool(routerboard) }),
    ...(model !== undefined && { model }),
    ...(current !== undefined && { "current-firmware": current }),
    ...(upgrade !== undefined && { "upgrade-firmware": upgrade }),
    ...(factory !== undefined && { "factory-firmware": factory }),
  };
}

function parseInterface(raw: RouterOSRecord): RouterOSInterface {
  const id = raw[".id"];
  const name = raw["name"];
  const type = raw["type"];
  const running = raw["running"];
  const disabled = raw["disabled"];
  const mtu = raw["mtu"];
  const actualMtu = raw["actual-mtu"];
  const mac = raw["mac-address"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(type !== undefined && { type }),
    ...(running !== undefined && { running: parseBool(running) }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(mtu !== undefined && { mtu: parseInteger(mtu) }),
    ...(actualMtu !== undefined && { "actual-mtu": parseInteger(actualMtu) }),
    ...(mac !== undefined && { "mac-address": mac }),
  };
}

function parseWirelessRegistration(raw: RouterOSRecord): RouterOSWirelessRegistration {
  const id = raw[".id"];
  const iface = raw["interface"];
  const ssid = raw["ssid"];
  const mac = raw["mac-address"];
  const uptime = raw["uptime"];
  const lastActivity = raw["last-activity"];
  const signal = raw["signal"];
  const band = raw["band"];
  const authType = raw["auth-type"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(iface !== undefined && { interface: iface }),
    ...(ssid !== undefined && { ssid }),
    ...(mac !== undefined && { "mac-address": mac }),
    ...(uptime !== undefined && { uptime }),
    ...(lastActivity !== undefined && { "last-activity": lastActivity }),
    ...(signal !== undefined && { signal }),
    ...(band !== undefined && { band }),
    ...(authType !== undefined && { "auth-type": authType }),
  };
}

function parseBonding(raw: RouterOSRecord): RouterOSBonding {
  const id = raw[".id"];
  const name = raw["name"];
  const mode = raw["mode"];
  const slaves = raw["slaves"];
  const lacpRate = raw["lacp-rate"];
  const mlagId = raw["mlag-id"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(mode !== undefined && { mode }),
    ...(slaves !== undefined && { slaves }),
    ...(lacpRate !== undefined && { "lacp-rate": lacpRate }),
    ...(mlagId !== undefined && { "mlag-id": mlagId }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseIpAddress(raw: RouterOSRecord): RouterOSIpAddress {
  const id = raw[".id"];
  const address = raw["address"];
  const iface = raw["interface"];
  const network = raw["network"];
  const disabled = raw["disabled"];
  const dynamic = raw["dynamic"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(address !== undefined && { address }),
    ...(iface !== undefined && { interface: iface }),
    ...(network !== undefined && { network }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(dynamic !== undefined && { dynamic: parseBool(dynamic) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseIpRoute(raw: RouterOSRecord): RouterOSIpRoute {
  const id = raw[".id"];
  const dst = raw["dst-address"];
  const gateway = raw["gateway"];
  const distance = raw["distance"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  const table = raw["routing-table"];
  const vrf = raw["vrf-interface"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(dst !== undefined && { "dst-address": dst }),
    ...(gateway !== undefined && { gateway }),
    ...(distance !== undefined && { distance: parseInteger(distance) }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
    ...(table !== undefined && { "routing-table": table }),
    ...(vrf !== undefined && { "vrf-interface": vrf }),
  };
}

function parseDhcpLease(raw: RouterOSRecord): RouterOSDhcpLease {
  const id = raw[".id"];
  const address = raw["address"];
  const mac = raw["mac-address"];
  const host = raw["host-name"];
  const server = raw["server"];
  const status = raw["status"];
  const dynamic = raw["dynamic"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(address !== undefined && { address }),
    ...(mac !== undefined && { "mac-address": mac }),
    ...(host !== undefined && { "host-name": host }),
    ...(server !== undefined && { server }),
    ...(status !== undefined && { status }),
    ...(dynamic !== undefined && { dynamic: parseBool(dynamic) }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseNeighbor(raw: RouterOSRecord): RouterOSNeighbor {
  const id = raw[".id"];
  const iface = raw["interface"];
  const address = raw["address"];
  const address6 = raw["address6"];
  const mac = raw["mac-address"];
  const identity = raw["identity"];
  const version = raw["version"];
  const board = raw["board"];
  const platform = raw["platform"];
  const discoveredBy = raw["discovered-by"];
  const uptime = raw["uptime"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(iface !== undefined && { interface: iface }),
    ...(address !== undefined && { address }),
    ...(address6 !== undefined && { address6 }),
    ...(mac !== undefined && { "mac-address": mac }),
    ...(identity !== undefined && { identity }),
    ...(version !== undefined && { version }),
    ...(board !== undefined && { board }),
    ...(platform !== undefined && { platform }),
    ...(discoveredBy !== undefined && { "discovered-by": discoveredBy }),
    ...(uptime !== undefined && { uptime }),
  };
}

function parseIpsecPeer(raw: RouterOSRecord): RouterOSIpsecPeer {
  const id = raw[".id"];
  const name = raw["name"];
  const address = raw["address"];
  const local = raw["local-address"];
  const profile = raw["profile"];
  const exchange = raw["exchange-mode"];
  const disabled = raw["disabled"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(address !== undefined && { address }),
    ...(local !== undefined && { "local-address": local }),
    ...(profile !== undefined && { profile }),
    ...(exchange !== undefined && { "exchange-mode": exchange }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
  };
}

function parseFirewallFilterRule(raw: RouterOSRecord): RouterOSFirewallFilterRule {
  const id = raw[".id"];
  const chain = raw["chain"];
  const action = raw["action"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  const protocol = raw["protocol"];
  const src = raw["src-address"];
  const dst = raw["dst-address"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(chain !== undefined && { chain }),
    ...(action !== undefined && { action }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
    ...(protocol !== undefined && { protocol }),
    ...(src !== undefined && { "src-address": src }),
    ...(dst !== undefined && { "dst-address": dst }),
  };
}

function parseIpService(raw: RouterOSRecord): RouterOSIpService {
  const id = raw[".id"];
  const name = raw["name"];
  const port = raw["port"];
  const address = raw["address"];
  const disabled = raw["disabled"];
  const cert = raw["certificate"];
  const vrf = raw["vrf"];
  const tls = raw["tls-version"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(port !== undefined && { port: parseInteger(port) }),
    ...(address !== undefined && { address }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(cert !== undefined && { certificate: cert }),
    ...(vrf !== undefined && { vrf }),
    ...(tls !== undefined && { "tls-version": tls }),
  };
}

function parseIpv6Neighbor(raw: RouterOSRecord): RouterOSIpv6Neighbor {
  const id = raw[".id"];
  const address = raw["address"];
  const mac = raw["mac-address"];
  const iface = raw["interface"];
  const vrf = raw["vrf"];
  const router = raw["router"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(address !== undefined && { address }),
    ...(mac !== undefined && { "mac-address": mac }),
    ...(iface !== undefined && { interface: iface }),
    ...(vrf !== undefined && { vrf }),
    ...(router !== undefined && { router: parseBool(router) }),
  };
}

function parseBridge(raw: RouterOSRecord): RouterOSBridge {
  const id = raw[".id"];
  const name = raw["name"];
  const vlanFiltering = raw["vlan-filtering"];
  const protocolMode = raw["protocol-mode"];
  const comment = raw["comment"];
  const disabled = raw["disabled"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(vlanFiltering !== undefined && { "vlan-filtering": parseBool(vlanFiltering) }),
    ...(protocolMode !== undefined && { "protocol-mode": protocolMode }),
    ...(comment !== undefined && { comment }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
  };
}

function parseBridgePort(raw: RouterOSRecord): RouterOSBridgePort {
  const id = raw[".id"];
  const bridge = raw["bridge"];
  const iface = raw["interface"];
  const pvid = raw["pvid"];
  const frameTypes = raw["frame-types"];
  const edge = raw["edge"];
  const comment = raw["comment"];
  const disabled = raw["disabled"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(bridge !== undefined && { bridge }),
    ...(iface !== undefined && { interface: iface }),
    ...(pvid !== undefined && { pvid: parseInteger(pvid) }),
    ...(frameTypes !== undefined && { "frame-types": frameTypes }),
    ...(edge !== undefined && { edge }),
    ...(comment !== undefined && { comment }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
  };
}

function parseBridgeVlan(raw: RouterOSRecord): RouterOSBridgeVlan {
  const id = raw[".id"];
  const bridge = raw["bridge"];
  const tagged = raw["tagged"];
  const untagged = raw["untagged"];
  const vlanIds = raw["vlan-ids"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(bridge !== undefined && { bridge }),
    ...(tagged !== undefined && { tagged }),
    ...(untagged !== undefined && { untagged }),
    ...(vlanIds !== undefined && { "vlan-ids": vlanIds }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseBridgeMonitor(raw: RouterOSRecord): RouterOSBridgeMonitor {
  const state = raw["state"];
  const curMac = raw["current-mac-address"];
  const bridgeId = raw["bridge-id"];
  const rootBridge = raw["root-bridge"];
  const rootBridgeId = raw["root-bridge-id"];
  const regionalRoot = raw["regional-root-bridge-id"];
  const rootPathCost = raw["root-path-cost"];
  const rootPort = raw["root-port"];
  const portCount = raw["port-count"];
  const desigPortCount = raw["designated-port-count"];
  const mstDigest = raw["mst-config-digest"];
  const fastFwd = raw["fast-forward"];
  const mcastRouter = raw["multicast-router"];
  const igmpQuerier = raw["igmp-querier"];
  const mldQuerier = raw["mld-querier"];
  const declaredVlans = raw["declared-vlan-ids"];
  const registeredVlans = raw["registered-vlan-ids"];
  return {
    ...(state !== undefined && { state }),
    ...(curMac !== undefined && { "current-mac-address": curMac }),
    ...(bridgeId !== undefined && { "bridge-id": bridgeId }),
    ...(rootBridge !== undefined && { "root-bridge": parseBool(rootBridge) }),
    ...(rootBridgeId !== undefined && { "root-bridge-id": rootBridgeId }),
    ...(regionalRoot !== undefined && { "regional-root-bridge-id": regionalRoot }),
    ...(rootPathCost !== undefined && { "root-path-cost": parseInteger(rootPathCost) }),
    ...(rootPort !== undefined && { "root-port": rootPort }),
    ...(portCount !== undefined && { "port-count": parseInteger(portCount) }),
    ...(desigPortCount !== undefined && { "designated-port-count": parseInteger(desigPortCount) }),
    ...(mstDigest !== undefined && { "mst-config-digest": mstDigest }),
    ...(fastFwd !== undefined && { "fast-forward": parseBool(fastFwd) }),
    ...(mcastRouter !== undefined && { "multicast-router": parseBool(mcastRouter) }),
    ...(igmpQuerier !== undefined && { "igmp-querier": parseBool(igmpQuerier) }),
    ...(mldQuerier !== undefined && { "mld-querier": parseBool(mldQuerier) }),
    ...(declaredVlans !== undefined && { "declared-vlan-ids": declaredVlans }),
    ...(registeredVlans !== undefined && { "registered-vlan-ids": registeredVlans }),
  };
}

function parseBridgePortMonitor(raw: RouterOSRecord): RouterOSBridgePortMonitor {
  const iface = raw["interface"];
  const status = raw["status"];
  const portId = raw["port-id"];
  const role = raw["role"];
  const edgePort = raw["edge-port"];
  const edgeDisc = raw["edge-port-discovery"];
  const p2p = raw["point-to-point-port"];
  const extFdb = raw["external-fdb"];
  const rstp = raw["sending-rstp"];
  const learning = raw["learning"];
  const forwarding = raw["forwarding"];
  const actualCost = raw["actual-path-cost"];
  const intRootCost = raw["internal-root-path-cost"];
  const desigBridge = raw["designated-bridge-id"];
  const desigPort = raw["designated-port-id"];
  const desigHops = raw["designated-remaining-hops"];
  const declaredVlans = raw["declared-vlan-ids"];
  const registeredVlans = raw["registered-vlan-ids"];
  return {
    ...(iface !== undefined && { interface: iface }),
    ...(status !== undefined && { status }),
    ...(portId !== undefined && { "port-id": portId }),
    ...(role !== undefined && { role }),
    ...(edgePort !== undefined && { "edge-port": parseBool(edgePort) }),
    ...(edgeDisc !== undefined && { "edge-port-discovery": parseBool(edgeDisc) }),
    ...(p2p !== undefined && { "point-to-point-port": parseBool(p2p) }),
    ...(extFdb !== undefined && { "external-fdb": parseBool(extFdb) }),
    ...(rstp !== undefined && { "sending-rstp": parseBool(rstp) }),
    ...(learning !== undefined && { learning: parseBool(learning) }),
    ...(forwarding !== undefined && { forwarding: parseBool(forwarding) }),
    ...(actualCost !== undefined && { "actual-path-cost": parseInteger(actualCost) }),
    ...(intRootCost !== undefined && { "internal-root-path-cost": parseInteger(intRootCost) }),
    ...(desigBridge !== undefined && { "designated-bridge-id": desigBridge }),
    ...(desigPort !== undefined && { "designated-port-id": desigPort }),
    ...(desigHops !== undefined && { "designated-remaining-hops": parseInteger(desigHops) }),
    ...(declaredVlans !== undefined && { "declared-vlan-ids": declaredVlans }),
    ...(registeredVlans !== undefined && { "registered-vlan-ids": registeredVlans }),
  };
}

function parsePppSecret(raw: RouterOSRecord): RouterOSPppSecret {
  const id = raw[".id"];
  const name = raw["name"];
  const password = raw["password"];
  const service = raw["service"];
  const profile = raw["profile"];
  const localAddr = raw["local-address"];
  const remoteAddr = raw["remote-address"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(password !== undefined && { password }),
    ...(service !== undefined && { service }),
    ...(profile !== undefined && { profile }),
    ...(localAddr !== undefined && { "local-address": localAddr }),
    ...(remoteAddr !== undefined && { "remote-address": remoteAddr }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseRoutingRule(raw: RouterOSRecord): RouterOSRoutingRule {
  const id = raw[".id"];
  const action = raw["action"];
  const table = raw["table"];
  const src = raw["src-address"];
  const dst = raw["dst-address"];
  const iface = raw["interface"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(action !== undefined && { action }),
    ...(table !== undefined && { table }),
    ...(src !== undefined && { "src-address": src }),
    ...(dst !== undefined && { "dst-address": dst }),
    ...(iface !== undefined && { interface: iface }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseWireGuardInterface(raw: RouterOSRecord): RouterOSWireGuardInterface {
  const id = raw[".id"];
  const name = raw["name"];
  const listenPort = raw["listen-port"];
  const mtu = raw["mtu"];
  const disabled = raw["disabled"];
  const pubKey = raw["public-key"];
  const privKey = raw["private-key"];
  const running = raw["running"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(listenPort !== undefined && { "listen-port": parseInteger(listenPort) }),
    ...(mtu !== undefined && { mtu: parseInteger(mtu) }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(pubKey !== undefined && { "public-key": pubKey }),
    ...(privKey !== undefined && { "private-key": privKey }),
    ...(running !== undefined && { running: parseBool(running) }),
  };
}

function parseWireGuardPeer(raw: RouterOSRecord): RouterOSWireGuardPeer {
  const id = raw[".id"];
  const iface = raw["interface"];
  const pubKey = raw["public-key"];
  const allowed = raw["allowed-address"];
  const endpointAddr = raw["endpoint-address"];
  const endpointPort = raw["endpoint-port"];
  const keepalive = raw["persistent-keepalive"];
  const disabled = raw["disabled"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(iface !== undefined && { interface: iface }),
    ...(pubKey !== undefined && { "public-key": pubKey }),
    ...(allowed !== undefined && { "allowed-address": allowed }),
    ...(endpointAddr !== undefined && { "endpoint-address": endpointAddr }),
    ...(endpointPort !== undefined && { "endpoint-port": parseInteger(endpointPort) }),
    ...(keepalive !== undefined && { "persistent-keepalive": keepalive }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseBgpConnection(raw: RouterOSRecord): RouterOSBgpConnection {
  const id = raw[".id"];
  const name = raw["name"];
  const as = raw["as"];
  const connect = raw["connect"];
  const listen = raw["listen"];
  const disabled = raw["disabled"];
  const multihop = raw["multihop"];
  const vrf = raw["vrf"];
  const remoteAddr = raw["remote.address"];
  const remoteAs = raw["remote.as"];
  const localAddr = raw["local.address"];
  const localRole = raw["local.role"];
  const routerId = raw["router-id"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(as !== undefined && { as }),
    ...(connect !== undefined && { connect: parseBool(connect) }),
    ...(listen !== undefined && { listen: parseBool(listen) }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(multihop !== undefined && { multihop: parseBool(multihop) }),
    ...(vrf !== undefined && { vrf }),
    ...(remoteAddr !== undefined && { "remote.address": remoteAddr }),
    ...(remoteAs !== undefined && { "remote.as": remoteAs }),
    ...(localAddr !== undefined && { "local.address": localAddr }),
    ...(localRole !== undefined && { "local.role": localRole }),
    ...(routerId !== undefined && { "router-id": routerId }),
  };
}

function parseBgpTemplate(raw: RouterOSRecord): RouterOSBgpTemplate {
  const id = raw[".id"];
  const name = raw["name"];
  const as = raw["as"];
  const disabled = raw["disabled"];
  const vrf = raw["vrf"];
  const routingTable = raw["routing-table"];
  const routerId = raw["router-id"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(as !== undefined && { as }),
    ...(disabled !== undefined && { disabled: parseBool(disabled) }),
    ...(vrf !== undefined && { vrf }),
    ...(routingTable !== undefined && { "routing-table": routingTable }),
    ...(routerId !== undefined && { "router-id": routerId }),
  };
}

function parseLteMonitor(raw: RouterOSRecord): RouterOSLteMonitor {
  const id = raw[".id"];
  const imei = raw["imei"];
  const model = raw["model"];
  const manufacturer = raw["manufacturer"];
  const revision = raw["revision"];
  const operator = raw["current-operator"];
  const tech = raw["access-technology"];
  const signal = raw["signal"];
  const rssi = raw["rssi"];
  const rsrp = raw["rsrp"];
  const rsrq = raw["rsrq"];
  const sinr = raw["sinr"];
  const roaming = raw["roaming"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(imei !== undefined && { imei }),
    ...(model !== undefined && { model }),
    ...(manufacturer !== undefined && { manufacturer }),
    ...(revision !== undefined && { revision }),
    ...(operator !== undefined && { "current-operator": operator }),
    ...(tech !== undefined && { "access-technology": tech }),
    ...(signal !== undefined && { signal: parseInteger(signal) }),
    ...(rssi !== undefined && { rssi: parseInteger(rssi) }),
    ...(rsrp !== undefined && { rsrp: parseInteger(rsrp) }),
    ...(rsrq !== undefined && { rsrq: parseInteger(rsrq) }),
    ...(sinr !== undefined && { sinr: parseInteger(sinr) }),
    ...(roaming !== undefined && { roaming: parseBool(roaming) }),
  };
}

// ─── Private utilities ────────────────────────────────────────────────────────

function toPrintOptions(options: RouterOSPrintOptions = {}): RouterOSCommandOptions {
  const { proplist, queries, signal, timeoutMs } = options;
  return {
    ...(proplist !== undefined && { attributes: { ".proplist": proplist } }),
    ...(queries !== undefined && { queries }),
    ...(signal !== undefined && { signal }),
    ...(timeoutMs !== undefined && { timeoutMs }),
  };
}

function toMonitorRaw(
  result: Awaited<ReturnType<DeviceTransport["execute"]>>
): RouterOSRecord | undefined {
  return result.records[0] ?? result.done?.attributes;
}

function withId(
  id: string,
  attributes?: Record<string, RouterOSPrimitive>
): Record<string, RouterOSPrimitive> {
  return {
    ".id": id,
    ...attributes,
  };
}

// Typed helpers are reserved for RouterOS menus and commands with public,
// documented command paths. Undocumented or model-specific behavior should
// stay on the raw client surface (`execute`, `print`, `api`) until proven stable.
function createRouterOSHelpersInternal(client: DeviceTransport): RouterOSHelpers {
  return {
    system: {
      resource: {
        async get(options: RouterOSPrintOptions = {}): Promise<RouterOSSystemResource | undefined> {
          const records = await client.print("/system/resource", toPrintOptions(options));
          const raw = records[0];
          return raw !== undefined ? parseSystemResource(raw) : undefined;
        },
      },
      identity: {
        async get(options: RouterOSPrintOptions = {}): Promise<RouterOSIdentity | undefined> {
          const records = await client.print("/system/identity", toPrintOptions(options));
          const raw = records[0];
          return raw !== undefined ? parseIdentity(raw) : undefined;
        },
        async set(
          name: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/system/identity/set", {
            ...options,
            attributes: { name },
          });
        },
      },
      package: {
        update: {
          async checkForUpdates(
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<RouterOSPackageUpdateStatus | undefined> {
            const result = await client.execute("/system/package/update/check-for-updates", options);
            const raw = toMonitorRaw(result);
            return raw !== undefined ? parsePackageUpdateStatus(raw) : undefined;
          },
          async install(
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/system/package/update/install", options);
          },
        },
      },
      routerboard: {
        async get(options: RouterOSPrintOptions = {}): Promise<RouterOSRouterboard | undefined> {
          const records = await client.print("/system/routerboard", toPrintOptions(options));
          const raw = records[0];
          return raw !== undefined ? parseRouterboard(raw) : undefined;
        },
        async upgrade(
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/system/routerboard/upgrade", options);
        },
      },
      async reboot(
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/system/reboot", options);
      },
      async exportConfig(
        attributes: {
          file: string;
          compact?: boolean;
          terse?: boolean;
          verbose?: boolean;
          "show-sensitive"?: boolean;
          path?: string;
        },
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/export", {
          ...options,
          attributes,
        });
      },
    },
    interface: {
      list(options: RouterOSPrintOptions = {}): Promise<RouterOSInterface[]> {
        return client.print("/interface", toPrintOptions(options)).then(records =>
          records.map(parseInterface)
        );
      },
      listen(options: RouterOSListenOptions = {}): Promise<RouterOSStream> {
        return client.listen("/interface/listen", options);
      },
      async enable(
        id: string,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/interface/set", {
          ...options,
          attributes: withId(id, { disabled: false }),
        });
      },
      async disable(
        id: string,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/interface/set", {
          ...options,
          attributes: withId(id, { disabled: true }),
        });
      },
      wireless: {
        registrationTable: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSWirelessRegistration[]> {
            return client.print(
              "/interface/wireless/registration-table",
              toPrintOptions(options)
            ).then(records => records.map(parseWirelessRegistration));
          },
        },
      },
      wifi: {
        registrationTable: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSWirelessRegistration[]> {
            return client.print(
              "/interface/wifi/registration-table",
              toPrintOptions(options)
            ).then(records => records.map(parseWirelessRegistration));
          },
        },
      },
      lte: {
        async monitor(
          interfaceId: string,
          options: RouterOSMonitorOptions = {}
        ): Promise<RouterOSLteMonitor | undefined> {
          const { signal, timeoutMs } = options;
          const result = await client.execute("/interface/lte/monitor", {
            ...(signal !== undefined && { signal }),
            ...(timeoutMs !== undefined && { timeoutMs }),
            attributes: {
              numbers: interfaceId,
              once: true,
            },
          });
          const raw = toMonitorRaw(result);
          return raw !== undefined ? parseLteMonitor(raw) : undefined;
        },
      },
      bonding: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSBonding[]> {
          return client.print("/interface/bonding", toPrintOptions(options)).then(records =>
            records.map(parseBonding)
          );
        },
        async add(
          attributes: {
            name: string;
            slaves: string | readonly string[];
            mode?: "802.3ad" | "balance-xor" | "active-backup" | "balance-rr" | "broadcast" | "balance-tlb" | "balance-alb";
            "lacp-rate"?: "30secs" | "1sec";
            "mlag-id"?: string | number;
            "transmit-hash-policy"?: string;
            "link-monitoring"?: "mii" | "arp" | "none";
            "mii-interval"?: string | number;
            "arp-ip-targets"?: string | readonly string[];
            primary?: string;
            mtu?: string | number;
            disabled?: boolean;
            comment?: string;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bonding/add", {
            ...options,
            attributes,
          });
        },
        async set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bonding/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bonding/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
    },
    bridge: {
      list(options: RouterOSPrintOptions = {}): Promise<RouterOSBridge[]> {
        return client.print("/interface/bridge", toPrintOptions(options)).then(records =>
          records.map(parseBridge)
        );
      },
      async monitor(
        bridgeId: string,
        options: RouterOSMonitorOptions = {}
      ): Promise<RouterOSBridgeMonitor | undefined> {
        const { signal, timeoutMs } = options;
        const result = await client.execute("/interface/bridge/monitor", {
          ...(signal !== undefined && { signal }),
          ...(timeoutMs !== undefined && { timeoutMs }),
          attributes: {
            numbers: bridgeId,
            once: true,
          },
        });
        const raw = toMonitorRaw(result);
        return raw !== undefined ? parseBridgeMonitor(raw) : undefined;
      },
      async add(
        attributes: {
          name: string;
          comment?: string;
          disabled?: boolean;
          "vlan-filtering"?: boolean;
          "protocol-mode"?: string;
        },
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/interface/bridge/add", {
          ...options,
          attributes,
        });
      },
      async remove(
        id: string,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/interface/bridge/remove", {
          ...options,
          attributes: withId(id),
        });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ): Promise<void> {
        await client.execute("/interface/bridge/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      port: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSBridgePort[]> {
          return client.print("/interface/bridge/port", toPrintOptions(options)).then(records =>
            records.map(parseBridgePort)
          );
        },
        async monitor(
          portId: string,
          options: RouterOSMonitorOptions = {}
        ): Promise<RouterOSBridgePortMonitor | undefined> {
          const { signal, timeoutMs } = options;
          const result = await client.execute("/interface/bridge/port/monitor", {
            ...(signal !== undefined && { signal }),
            ...(timeoutMs !== undefined && { timeoutMs }),
            attributes: {
              numbers: portId,
              once: true,
            },
          });
          const raw = toMonitorRaw(result);
          return raw !== undefined ? parseBridgePortMonitor(raw) : undefined;
        },
        async add(
          attributes: {
            bridge: string;
            interface: string;
            pvid?: number | string;
            comment?: string;
            disabled?: boolean;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bridge/port/add", {
            ...options,
            attributes,
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bridge/port/remove", {
            ...options,
            attributes: withId(id),
          });
        },
        async set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bridge/port/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
      },
      vlan: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSBridgeVlan[]> {
          return client.print("/interface/bridge/vlan", toPrintOptions(options)).then(records =>
            records.map(parseBridgeVlan)
          );
        },
        async add(
          attributes: {
            bridge: string;
            "vlan-ids": string | number | readonly (string | number)[];
            tagged?: string | readonly string[];
            untagged?: string | readonly string[];
            disabled?: boolean;
            comment?: string;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bridge/vlan/add", {
            ...options,
            attributes,
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/bridge/vlan/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
    },
    ip: {
      neighbor: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSNeighbor[]> {
          return client.print("/ip/neighbor", toPrintOptions(options)).then(records =>
            records.map(parseNeighbor)
          );
        },
      },
      ipsec: {
        peer: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpsecPeer[]> {
            return client.print("/ip/ipsec/peer", toPrintOptions(options)).then(records =>
              records.map(parseIpsecPeer)
            );
          },
        },
      },
      route: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpRoute[]> {
          return client.print("/ip/route", toPrintOptions(options)).then(records =>
            records.map(parseIpRoute)
          );
        },
      },
      dhcpServer: {
        lease: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSDhcpLease[]> {
            return client.print(
              "/ip/dhcp-server/lease",
              toPrintOptions(options)
            ).then(records => records.map(parseDhcpLease));
          },
        },
      },
      service: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpService[]> {
          return client.print("/ip/service", toPrintOptions(options)).then(records =>
            records.map(parseIpService)
          );
        },
        async set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ip/service/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
      },
      address: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpAddress[]> {
          return client.print("/ip/address", toPrintOptions(options)).then(records =>
            records.map(parseIpAddress)
          );
        },
        async add(
          attributes: {
            address: string;
            interface: string;
            network?: string;
            comment?: string;
            disabled?: boolean;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ip/address/add", {
            ...options,
            attributes,
          });
        },
        async set(
          id: string,
          attributes: {
            address?: string;
            interface?: string;
            network?: string;
            comment?: string;
            disabled?: boolean;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ip/address/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ip/address/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
      firewall: {
        filter: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSFirewallFilterRule[]> {
            return client.print(
              "/ip/firewall/filter",
              toPrintOptions(options)
            ).then(records => records.map(parseFirewallFilterRule));
          },
          async add(
            attributes: Record<string, RouterOSPrimitive>,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/ip/firewall/filter/add", {
              ...options,
              attributes,
            });
          },
          async remove(
            id: string,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/ip/firewall/filter/remove", {
              ...options,
              attributes: withId(id),
            });
          },
        },
      },
    },
    wireguard: {
      interface: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSWireGuardInterface[]> {
          return client.print("/interface/wireguard", toPrintOptions(options)).then(records =>
            records.map(parseWireGuardInterface)
          );
        },
        async add(
          attributes: {
            name: string;
            "listen-port"?: string | number;
            mtu?: string | number;
            "private-key"?: string;
            disabled?: boolean;
            comment?: string;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/wireguard/add", {
            ...options,
            attributes,
          });
        },
        async set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/wireguard/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/wireguard/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
      peer: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSWireGuardPeer[]> {
          return client.print("/interface/wireguard/peers", toPrintOptions(options)).then(records =>
            records.map(parseWireGuardPeer)
          );
        },
        async add(
          attributes: {
            interface: string;
            "public-key": string;
            "allowed-address": string | readonly string[];
            "endpoint-address"?: string;
            "endpoint-port"?: string | number;
            "persistent-keepalive"?: string | number;
            disabled?: boolean;
            comment?: string;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/wireguard/peers/add", {
            ...options,
            attributes,
          });
        },
        async set(
          id: string,
          attributes: Record<string, RouterOSPrimitive>,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/wireguard/peers/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/interface/wireguard/peers/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
    },
    ppp: {
      secret: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSPppSecret[]> {
          return client.print("/ppp/secret", toPrintOptions(options)).then(records =>
            records.map(parsePppSecret)
          );
        },
        async add(
          attributes: {
            name: string;
            password: string;
            service?: string;
            profile?: string;
            disabled?: boolean;
            comment?: string;
            "local-address"?: string;
            "remote-address"?: string;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ppp/secret/add", {
            ...options,
            attributes,
          });
        },
        async set(
          id: string,
          attributes: {
            password?: string;
            service?: string;
            profile?: string;
            disabled?: boolean;
            comment?: string;
            "local-address"?: string;
            "remote-address"?: string;
          },
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ppp/secret/set", {
            ...options,
            attributes: withId(id, attributes),
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/ppp/secret/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
    },
    routing: {
      bgp: {
        connection: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSBgpConnection[]> {
            return client.print("/routing/bgp/connection", toPrintOptions(options)).then(records =>
              records.map(parseBgpConnection)
            );
          },
          async add(
            attributes: Record<string, RouterOSPrimitive>,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/routing/bgp/connection/add", {
              ...options,
              attributes,
            });
          },
          async set(
            id: string,
            attributes: Record<string, RouterOSPrimitive>,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/routing/bgp/connection/set", {
              ...options,
              attributes: withId(id, attributes),
            });
          },
          async remove(
            id: string,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/routing/bgp/connection/remove", {
              ...options,
              attributes: withId(id),
            });
          },
        },
        template: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSBgpTemplate[]> {
            return client.print("/routing/bgp/template", toPrintOptions(options)).then(records =>
              records.map(parseBgpTemplate)
            );
          },
          async add(
            attributes: Record<string, RouterOSPrimitive>,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/routing/bgp/template/add", {
              ...options,
              attributes,
            });
          },
          async set(
            id: string,
            attributes: Record<string, RouterOSPrimitive>,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/routing/bgp/template/set", {
              ...options,
              attributes: withId(id, attributes),
            });
          },
          async remove(
            id: string,
            options: Omit<RouterOSCommandOptions, "attributes"> = {}
          ): Promise<void> {
            await client.execute("/routing/bgp/template/remove", {
              ...options,
              attributes: withId(id),
            });
          },
        },
      },
      rule: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSRoutingRule[]> {
          return client.print("/routing/rule", toPrintOptions(options)).then(records =>
            records.map(parseRoutingRule)
          );
        },
        async add(
          attributes: Record<string, RouterOSPrimitive>,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/routing/rule/add", {
            ...options,
            attributes,
          });
        },
        async remove(
          id: string,
          options: Omit<RouterOSCommandOptions, "attributes"> = {}
        ): Promise<void> {
          await client.execute("/routing/rule/remove", {
            ...options,
            attributes: withId(id),
          });
        },
      },
    },
    capsman: createCapsManHelpers(client),
    ipv6: {
      neighbor: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpv6Neighbor[]> {
          return client.print("/ipv6/neighbor", toPrintOptions(options)).then(records =>
            records.map(parseIpv6Neighbor)
          );
        },
      },
    },
  };
}

/**
 * Create typed RouterOS resource helpers bound to a transport.
 *
 * Works with both {@link RouterOSClient} (binary API) and
 * {@link RouterOSRestClient} (REST API v7). Methods that use streaming
 * (`interface.listen`) will throw `RouterOSRestProtocolError` if the
 * REST transport is used.
 *
 * @example
 * ```ts
 * const helpers = createRouterOSHelpers(client);
 * const interfaces = await helpers.interface.list();
 * const resource = await helpers.system.resource.get();
 * ```
 */
export function createRouterOSHelpers(client: DeviceTransport): RouterOSHelpers {
  return createRouterOSHelpersInternal(client);
}
