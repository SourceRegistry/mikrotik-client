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

export type RouterOSHelpers = ReturnType<typeof createRouterOSHelpers>;

function toPrintOptions(options: RouterOSPrintOptions = {}): RouterOSCommandOptions {
  const { proplist, queries, signal, timeoutMs } = options;
  return {
    attributes: proplist ? { ".proplist": proplist } : undefined,
    queries,
    signal,
    timeoutMs,
  };
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

export function createRouterOSHelpers(client: RouterOSClient) {
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
  };
}
