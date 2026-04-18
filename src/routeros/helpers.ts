import type {
  RouterOSClient,
  RouterOSCommandOptions,
  RouterOSListenOptions,
  RouterOSPrimitive,
  RouterOSRecord,
  RouterOSStream,
} from "./index";

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

export type RouterOSSystemResource = RouterOSRecord & {
  uptime?: string;
  version?: string;
  build?: string;
  platform?: string;
  boardName?: string;
  "board-name"?: string;
  "cpu-load"?: string;
  "cpu-count"?: string;
  "free-memory"?: string;
  "total-memory"?: string;
};

export type RouterOSIdentity = RouterOSRecord & {
  name?: string;
};

export type RouterOSPackageUpdateStatus = RouterOSRecord & {
  channel?: string;
  status?: string;
  "installed-version"?: string;
  "latest-version"?: string;
};

export type RouterOSRouterboard = RouterOSRecord & {
  routerboard?: string;
  model?: string;
  "current-firmware"?: string;
  "upgrade-firmware"?: string;
  "factory-firmware"?: string;
};

export type RouterOSInterface = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  type?: string;
  running?: string;
  disabled?: string;
  mtu?: string;
  "actual-mtu"?: string;
  macAddress?: string;
  "mac-address"?: string;
};

export type RouterOSWirelessRegistration = RouterOSRecord & {
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

export type RouterOSBonding = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  mode?: string;
  slaves?: string;
  "lacp-rate"?: string;
  "mlag-id"?: string;
  disabled?: string;
  comment?: string;
};

export type RouterOSIpAddress = RouterOSRecord & {
  ".id"?: string;
  address?: string;
  interface?: string;
  network?: string;
  disabled?: string;
  dynamic?: string;
  comment?: string;
};

export type RouterOSIpRoute = RouterOSRecord & {
  ".id"?: string;
  "dst-address"?: string;
  gateway?: string;
  distance?: string;
  disabled?: string;
  comment?: string;
  "routing-table"?: string;
  vrfInterface?: string;
  "vrf-interface"?: string;
};

export type RouterOSDhcpLease = RouterOSRecord & {
  ".id"?: string;
  address?: string;
  "mac-address"?: string;
  "host-name"?: string;
  server?: string;
  status?: string;
  dynamic?: string;
  disabled?: string;
  comment?: string;
};

export type RouterOSNeighbor = RouterOSRecord & {
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

export type RouterOSIpsecPeer = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  address?: string;
  "local-address"?: string;
  profile?: string;
  "exchange-mode"?: string;
  disabled?: string;
};

export type RouterOSFirewallFilterRule = RouterOSRecord & {
  ".id"?: string;
  chain?: string;
  action?: string;
  disabled?: string;
  comment?: string;
  protocol?: string;
  "src-address"?: string;
  "dst-address"?: string;
};

export type RouterOSIpService = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  port?: string;
  address?: string;
  disabled?: string;
  certificate?: string;
  vrf?: string;
  "tls-version"?: string;
};

export type RouterOSIpv6Neighbor = RouterOSRecord & {
  ".id"?: string;
  address?: string;
  "mac-address"?: string;
  interface?: string;
  vrf?: string;
  router?: string;
};

export type RouterOSBridge = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  vlanFiltering?: string;
  "vlan-filtering"?: string;
  protocolMode?: string;
  "protocol-mode"?: string;
  comment?: string;
  disabled?: string;
};

export type RouterOSBridgePort = RouterOSRecord & {
  ".id"?: string;
  bridge?: string;
  interface?: string;
  pvid?: string;
  "frame-types"?: string;
  edge?: string;
  comment?: string;
  disabled?: string;
};

export type RouterOSBridgeVlan = RouterOSRecord & {
  ".id"?: string;
  bridge?: string;
  tagged?: string;
  untagged?: string;
  "vlan-ids"?: string;
  disabled?: string;
  comment?: string;
};

export type RouterOSBridgeMonitor = RouterOSRecord & {
  state?: string;
  "current-mac-address"?: string;
  "bridge-id"?: string;
  "root-bridge"?: string;
  "root-bridge-id"?: string;
  "regional-root-bridge-id"?: string;
  "root-path-cost"?: string;
  "root-port"?: string;
  "port-count"?: string;
  "designated-port-count"?: string;
  "mst-config-digest"?: string;
  "fast-forward"?: string;
  "multicast-router"?: string;
  "igmp-querier"?: string;
  "mld-querier"?: string;
  "declared-vlan-ids"?: string;
  "registered-vlan-ids"?: string;
};

export type RouterOSBridgePortMonitor = RouterOSRecord & {
  interface?: string;
  status?: string;
  "port-id"?: string;
  role?: string;
  "edge-port"?: string;
  "edge-port-discovery"?: string;
  "point-to-point-port"?: string;
  "external-fdb"?: string;
  "sending-rstp"?: string;
  learning?: string;
  forwarding?: string;
  "actual-path-cost"?: string;
  "internal-root-path-cost"?: string;
  "designated-bridge-id"?: string;
  "designated-port-id"?: string;
  "designated-remaining-hops"?: string;
  "declared-vlan-ids"?: string;
  "registered-vlan-ids"?: string;
};

export type RouterOSPppSecret = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  password?: string;
  service?: string;
  profile?: string;
  "local-address"?: string;
  "remote-address"?: string;
  disabled?: string;
  comment?: string;
};

export type RouterOSRoutingRule = RouterOSRecord & {
  ".id"?: string;
  action?: string;
  table?: string;
  srcAddress?: string;
  "src-address"?: string;
  dstAddress?: string;
  "dst-address"?: string;
  interface?: string;
  disabled?: string;
  comment?: string;
};

export type RouterOSWireGuardInterface = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  "listen-port"?: string;
  mtu?: string;
  disabled?: string;
  "public-key"?: string;
  "private-key"?: string;
  running?: string;
};

export type RouterOSWireGuardPeer = RouterOSRecord & {
  ".id"?: string;
  interface?: string;
  "public-key"?: string;
  "allowed-address"?: string;
  "endpoint-address"?: string;
  "endpoint-port"?: string;
  "persistent-keepalive"?: string;
  disabled?: string;
  comment?: string;
};

export type RouterOSBgpConnection = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  as?: string;
  connect?: string;
  listen?: string;
  disabled?: string;
  multihop?: string;
  vrf?: string;
  "remote.address"?: string;
  "remote.as"?: string;
  "local.address"?: string;
  "local.role"?: string;
  routerId?: string;
  "router-id"?: string;
};

export type RouterOSBgpTemplate = RouterOSRecord & {
  ".id"?: string;
  name?: string;
  as?: string;
  disabled?: string;
  vrf?: string;
  "routing-table"?: string;
  "router-id"?: string;
};

export type RouterOSLteMonitor = RouterOSRecord & {
  ".id"?: string;
  imei?: string;
  model?: string;
  manufacturer?: string;
  revision?: string;
  "current-operator"?: string;
  "access-technology"?: string;
  signal?: string;
  rssi?: string;
  rsrp?: string;
  rsrq?: string;
  sinr?: string;
  roaming?: string;
};

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
  ipv6: {
    neighbor: {
      list(options?: RouterOSPrintOptions): Promise<RouterOSIpv6Neighbor[]>;
    };
  };
};

function toPrintOptions(options: RouterOSPrintOptions = {}): RouterOSCommandOptions {
  const { proplist, queries, signal, timeoutMs } = options;
  return {
    attributes: proplist ? { ".proplist": proplist } : undefined,
    queries,
    signal,
    timeoutMs,
  };
}

function toMonitorResult<T extends RouterOSRecord>(
  result: Awaited<ReturnType<RouterOSClient["execute"]>>
): T | undefined {
  return (result.records[0] ?? result.done?.attributes) as T | undefined;
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
function createRouterOSHelpersInternal(client: RouterOSClient): RouterOSHelpers {
  return {
    system: {
      resource: {
        async get(options: RouterOSPrintOptions = {}): Promise<RouterOSSystemResource | undefined> {
          const records = await client.print("/system/resource", toPrintOptions(options));
          return records[0] as RouterOSSystemResource | undefined;
        },
      },
      identity: {
        async get(options: RouterOSPrintOptions = {}): Promise<RouterOSIdentity | undefined> {
          const records = await client.print("/system/identity", toPrintOptions(options));
          return records[0] as RouterOSIdentity | undefined;
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
            return (result.records[0] ?? result.done?.attributes) as
              | RouterOSPackageUpdateStatus
              | undefined;
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
          return records[0] as RouterOSRouterboard | undefined;
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
        return client.print("/interface", toPrintOptions(options)) as Promise<RouterOSInterface[]>;
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
            ) as Promise<RouterOSWirelessRegistration[]>;
          },
        },
      },
      wifi: {
        registrationTable: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSWirelessRegistration[]> {
            return client.print(
              "/interface/wifi/registration-table",
              toPrintOptions(options)
            ) as Promise<RouterOSWirelessRegistration[]>;
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
            signal,
            timeoutMs,
            attributes: {
              numbers: interfaceId,
              once: true,
            },
          });
          return toMonitorResult<RouterOSLteMonitor>(result);
        },
      },
      bonding: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSBonding[]> {
          return client.print("/interface/bonding", toPrintOptions(options)) as Promise<RouterOSBonding[]>;
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
        return client.print("/interface/bridge", toPrintOptions(options)) as Promise<RouterOSBridge[]>;
      },
      async monitor(
        bridgeId: string,
        options: RouterOSMonitorOptions = {}
      ): Promise<RouterOSBridgeMonitor | undefined> {
        const { signal, timeoutMs } = options;
        const result = await client.execute("/interface/bridge/monitor", {
          signal,
          timeoutMs,
          attributes: {
            numbers: bridgeId,
            once: true,
          },
        });
        return toMonitorResult<RouterOSBridgeMonitor>(result);
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
          return client.print("/interface/bridge/port", toPrintOptions(options)) as Promise<RouterOSBridgePort[]>;
        },
        async monitor(
          portId: string,
          options: RouterOSMonitorOptions = {}
        ): Promise<RouterOSBridgePortMonitor | undefined> {
          const { signal, timeoutMs } = options;
          const result = await client.execute("/interface/bridge/port/monitor", {
            signal,
            timeoutMs,
            attributes: {
              numbers: portId,
              once: true,
            },
          });
          return toMonitorResult<RouterOSBridgePortMonitor>(result);
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
          return client.print("/interface/bridge/vlan", toPrintOptions(options)) as Promise<RouterOSBridgeVlan[]>;
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
          return client.print("/ip/neighbor", toPrintOptions(options)) as Promise<RouterOSNeighbor[]>;
        },
      },
      ipsec: {
        peer: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpsecPeer[]> {
            return client.print("/ip/ipsec/peer", toPrintOptions(options)) as Promise<RouterOSIpsecPeer[]>;
          },
        },
      },
      route: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpRoute[]> {
          return client.print("/ip/route", toPrintOptions(options)) as Promise<RouterOSIpRoute[]>;
        },
      },
      dhcpServer: {
        lease: {
          list(options: RouterOSPrintOptions = {}): Promise<RouterOSDhcpLease[]> {
            return client.print(
              "/ip/dhcp-server/lease",
              toPrintOptions(options)
            ) as Promise<RouterOSDhcpLease[]>;
          },
        },
      },
      service: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpService[]> {
          return client.print("/ip/service", toPrintOptions(options)) as Promise<RouterOSIpService[]>;
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
          return client.print("/ip/address", toPrintOptions(options)) as Promise<RouterOSIpAddress[]>;
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
          attributes: Omit<
            {
              address?: string;
              interface?: string;
              network?: string;
              comment?: string;
              disabled?: boolean;
            },
            never
          >,
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
            ) as Promise<RouterOSFirewallFilterRule[]>;
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
          return client.print("/interface/wireguard", toPrintOptions(options)) as Promise<RouterOSWireGuardInterface[]>;
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
          return client.print("/interface/wireguard/peers", toPrintOptions(options)) as Promise<RouterOSWireGuardPeer[]>;
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
          return client.print("/ppp/secret", toPrintOptions(options)) as Promise<RouterOSPppSecret[]>;
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
            return client.print("/routing/bgp/connection", toPrintOptions(options)) as Promise<RouterOSBgpConnection[]>;
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
            return client.print("/routing/bgp/template", toPrintOptions(options)) as Promise<RouterOSBgpTemplate[]>;
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
          return client.print("/routing/rule", toPrintOptions(options)) as Promise<RouterOSRoutingRule[]>;
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
    ipv6: {
      neighbor: {
        list(options: RouterOSPrintOptions = {}): Promise<RouterOSIpv6Neighbor[]> {
          return client.print("/ipv6/neighbor", toPrintOptions(options)) as Promise<RouterOSIpv6Neighbor[]>;
        },
      },
    },
  };
}

export function createRouterOSHelpers(client: RouterOSClient): RouterOSHelpers {
  return createRouterOSHelpersInternal(client);
}
