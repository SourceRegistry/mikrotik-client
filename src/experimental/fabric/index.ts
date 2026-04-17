import {
  DatacenterManager,
  type DatacenterDevice,
  type DatacenterDeviceDefinition,
  type DatacenterDeviceSnapshot,
} from "../datacenter";
import type {
  DeviceCapabilities,
  DevicePlanItem,
  DevicePlanItemInspection,
  DevicePlanItemStatus,
} from "../../device";
import type { RouterOSPrimitive } from "../../routeros";

export type FabricNodeDefinition = {
  id: string;
  deviceId: string;
  site?: string;
  role?: string;
  fabric?: string;
  rack?: string;
  asn?: number;
  loopback?: string;
  bridgeName?: string;
  tags?: readonly string[];
  meta?: Record<string, string>;
};

export type FabricLinkEndpoint = {
  nodeId: string;
  members?: readonly string[];
  bondName?: string;
  bridge?: string;
  pvid?: number;
  taggedVlans?: readonly number[];
  untaggedVlans?: readonly number[];
  mlagId?: number;
  comment?: string;
};

export type FabricLinkDefinition = {
  id: string;
  kind: "p2p" | "lag" | "mlag" | "trunk" | "access";
  endpoints: readonly FabricLinkEndpoint[];
  mode?: "802.3ad" | "active-backup" | "balance-xor";
  lacpRate?: "30secs" | "1sec";
  hashPolicy?: string;
  vlanAware?: boolean;
  tags?: readonly string[];
  description?: string;
};

export type FabricSegmentAttachment = {
  nodeId: string;
  bridge?: string;
  tagged?: readonly string[];
  untagged?: readonly string[];
};

export type FabricSegmentDefinition = {
  id: string;
  name: string;
  vlanId?: number;
  vrf?: string;
  subnets?: readonly string[];
  attachments?: readonly FabricSegmentAttachment[];
  tags?: readonly string[];
  description?: string;
};

export type FabricBgpPeerDefinition = {
  id: string;
  nodeId: string;
  name: string;
  remoteAddress: string;
  remoteAs: number;
  localAddress?: string;
  localAs?: number;
  multihop?: boolean;
  templateName?: string;
  routingTable?: string;
  routerId?: string;
  role?: string;
  comment?: string;
};

export type FabricWireGuardTunnelDefinition = {
  id: string;
  nodeId: string;
  interfaceName: string;
  listenPort?: number;
  mtu?: number;
  privateKey?: string;
  peerPublicKey: string;
  allowedAddresses: readonly string[];
  endpointAddress?: string;
  endpointPort?: number;
  keepalive?: number;
  comment?: string;
};

export type FabricPlanItem = Omit<DevicePlanItem, "payload"> & {
  payload: Record<string, RouterOSPrimitive>;
};

export type FabricPlanValidationError = {
  item: FabricPlanItem;
  deviceId: string;
  os: string;
  reason: string;
};

export type FabricPlanDevicePreview = {
  deviceId: string;
  nodeIds: string[];
  os: string;
  supported: boolean;
  snapshot?: DatacenterDeviceSnapshot;
  items: Array<FabricPlanItem & { inspection: DevicePlanItemInspection }>;
  validationErrors: FabricPlanValidationError[];
};

export type FabricPlanPreview = {
  plan: FabricPlanItem[];
  errors: FabricPlanValidationError[];
  supported: FabricPlanItem[];
  unsupported: FabricPlanItem[];
  devices: FabricPlanDevicePreview[];
};

export type FabricPlanItemPreview = FabricPlanItem & {
  inspection: DevicePlanItemInspection;
};

export type FabricNodeFilter = {
  ids?: readonly string[];
  site?: string;
  role?: string;
  fabric?: string;
  tags?: readonly string[];
};

export type FabricManagerOptions = {
  inventory?: DatacenterManager;
  devices?: readonly DatacenterDeviceDefinition[];
  nodes?: readonly FabricNodeDefinition[];
  links?: readonly FabricLinkDefinition[];
  segments?: readonly FabricSegmentDefinition[];
  bgpPeers?: readonly FabricBgpPeerDefinition[];
  wireguardTunnels?: readonly FabricWireGuardTunnelDefinition[];
};

function normalizeTags(tags?: readonly string[]): string[] {
  return [...new Set((tags ?? []).filter(Boolean))];
}

function capabilityForPlanKind(
  kind: FabricPlanItem["kind"],
  capabilities: DeviceCapabilities
): boolean {
  switch (kind) {
    case "bond":
      return capabilities.bonding;
    case "bridge-port":
      return capabilities.bridgePort;
    case "bridge-vlan":
      return capabilities.bridgeVlan;
    case "bgp-template":
    case "bgp-connection":
      return capabilities.bgp;
    case "wireguard-interface":
    case "wireguard-peer":
      return capabilities.wireguard;
    default:
      return false;
  }
}

export class FabricManager {
  public readonly inventory: DatacenterManager;
  private readonly nodesMap = new Map<string, FabricNodeDefinition>();
  private readonly linksMap = new Map<string, FabricLinkDefinition>();
  private readonly segmentsMap = new Map<string, FabricSegmentDefinition>();
  private readonly bgpPeersMap = new Map<string, FabricBgpPeerDefinition>();
  private readonly wireGuardMap = new Map<string, FabricWireGuardTunnelDefinition>();

  public constructor(options: FabricManagerOptions = {}) {
    this.inventory = options.inventory ?? new DatacenterManager(options.devices ?? []);
    for (const item of options.nodes ?? []) this.addNode(item);
    for (const item of options.links ?? []) this.addLink(item);
    for (const item of options.segments ?? []) this.addSegment(item);
    for (const item of options.bgpPeers ?? []) this.addBgpPeer(item);
    for (const item of options.wireguardTunnels ?? []) this.addWireGuardTunnel(item);
  }

  addNode(node: FabricNodeDefinition): FabricNodeDefinition {
    const normalized = { ...node, tags: normalizeTags(node.tags) };
    this.nodesMap.set(node.id, normalized);
    return normalized;
  }

  addLink(link: FabricLinkDefinition): FabricLinkDefinition {
    const normalized = { ...link, tags: normalizeTags(link.tags) };
    this.linksMap.set(link.id, normalized);
    return normalized;
  }

  addSegment(segment: FabricSegmentDefinition): FabricSegmentDefinition {
    const normalized = { ...segment, tags: normalizeTags(segment.tags) };
    this.segmentsMap.set(segment.id, normalized);
    return normalized;
  }

  addBgpPeer(peer: FabricBgpPeerDefinition): FabricBgpPeerDefinition {
    this.bgpPeersMap.set(peer.id, peer);
    return peer;
  }

  addWireGuardTunnel(tunnel: FabricWireGuardTunnelDefinition): FabricWireGuardTunnelDefinition {
    this.wireGuardMap.set(tunnel.id, tunnel);
    return tunnel;
  }

  node(id: string): FabricNodeDefinition | undefined {
    return this.nodesMap.get(id);
  }

  nodes(filter: FabricNodeFilter = {}): FabricNodeDefinition[] {
    const ids = filter.ids ? new Set(filter.ids) : undefined;
    const tags = filter.tags ? new Set(filter.tags) : undefined;

    return [...this.nodesMap.values()].filter((node) => {
      if (ids && !ids.has(node.id)) return false;
      if (filter.site && node.site !== filter.site) return false;
      if (filter.role && node.role !== filter.role) return false;
      if (filter.fabric && node.fabric !== filter.fabric) return false;
      if (tags && ![...tags].every((tag) => node.tags?.includes(tag))) return false;
      return true;
    });
  }

  links(): FabricLinkDefinition[] {
    return [...this.linksMap.values()];
  }

  linksForNode(nodeId: string): FabricLinkDefinition[] {
    return this.links().filter((link) => link.endpoints.some((endpoint) => endpoint.nodeId === nodeId));
  }

  segments(): FabricSegmentDefinition[] {
    return [...this.segmentsMap.values()];
  }

  segmentsForNode(nodeId: string): FabricSegmentDefinition[] {
    return this.segments().filter((segment) =>
      segment.attachments?.some((attachment) => attachment.nodeId === nodeId)
    );
  }

  bgpPeersForNode(nodeId: string): FabricBgpPeerDefinition[] {
    return [...this.bgpPeersMap.values()].filter((peer) => peer.nodeId === nodeId);
  }

  wireGuardTunnelsForNode(nodeId: string): FabricWireGuardTunnelDefinition[] {
    return [...this.wireGuardMap.values()].filter((tunnel) => tunnel.nodeId === nodeId);
  }

  async snapshot(filter: FabricNodeFilter = {}): Promise<DatacenterDeviceSnapshot[]> {
    const deviceIds = this.nodes(filter).map((node) => node.deviceId);
    return this.inventory.snapshot({ ids: deviceIds });
  }

  plan(filter: FabricNodeFilter = {}): FabricPlanItem[] {
    const items: FabricPlanItem[] = [];

    for (const node of this.nodes(filter)) {
      const device = this.inventory.get(node.deviceId);
      if (!device) continue;

      for (const link of this.linksForNode(node.id)) {
        const endpoint = link.endpoints.find((item) => item.nodeId === node.id);
        if (!endpoint) continue;

        const members = endpoint.members ?? [];
        if ((link.kind === "lag" || link.kind === "mlag") && members.length > 0) {
          const bondName = endpoint.bondName ?? `${link.kind}-${link.id}`;
          items.push({
            id: `bond:${node.id}:${link.id}`,
            nodeId: node.id,
            deviceId: device.id,
            kind: "bond",
            summary: `Ensure bond ${bondName} on ${node.id}`,
            payload: {
              name: bondName,
              slaves: members,
              mode: link.mode ?? "802.3ad",
              "lacp-rate": link.lacpRate,
              "transmit-hash-policy": link.hashPolicy,
              "mlag-id": link.kind === "mlag" ? endpoint.mlagId : undefined,
              comment: link.description ?? endpoint.comment,
            },
          });

          if (endpoint.bridge ?? node.bridgeName) {
            items.push({
              id: `bridge-port:${node.id}:${link.id}`,
              nodeId: node.id,
              deviceId: device.id,
              kind: "bridge-port",
              summary: `Attach ${bondName} to bridge on ${node.id}`,
              payload: {
                bridge: endpoint.bridge ?? node.bridgeName,
                interface: bondName,
                pvid: endpoint.pvid,
                comment: endpoint.comment,
              },
            });
          }
        }
      }

      for (const segment of this.segmentsForNode(node.id)) {
        const attachment = segment.attachments?.find((item) => item.nodeId === node.id);
        if (!attachment || segment.vlanId === undefined) continue;
        items.push({
          id: `bridge-vlan:${node.id}:${segment.id}`,
          nodeId: node.id,
          deviceId: device.id,
          kind: "bridge-vlan",
          summary: `Ensure VLAN ${segment.vlanId} on ${node.id}`,
          payload: {
            bridge: attachment.bridge ?? node.bridgeName,
            "vlan-ids": segment.vlanId,
            tagged: attachment.tagged,
            untagged: attachment.untagged,
            comment: segment.description ?? segment.name,
          },
        });
      }

      for (const peer of this.bgpPeersForNode(node.id)) {
        if (peer.templateName) {
          items.push({
            id: `bgp-template:${node.id}:${peer.id}`,
            nodeId: node.id,
            deviceId: device.id,
            kind: "bgp-template",
            summary: `Ensure BGP template ${peer.templateName} on ${node.id}`,
            payload: {
              name: peer.templateName,
              as: peer.localAs ?? node.asn,
              "router-id": peer.routerId ?? node.loopback,
              "routing-table": peer.routingTable,
            },
          });
        }

        items.push({
          id: `bgp-connection:${node.id}:${peer.id}`,
          nodeId: node.id,
          deviceId: device.id,
          kind: "bgp-connection",
          summary: `Ensure BGP peer ${peer.name} on ${node.id}`,
          payload: {
            name: peer.name,
            as: peer.localAs ?? node.asn,
            "local.address": peer.localAddress ?? node.loopback,
            "remote.address": peer.remoteAddress,
            "remote.as": peer.remoteAs,
            multihop: peer.multihop,
            templates: peer.templateName,
            comment: peer.comment,
          },
        });
      }

      for (const tunnel of this.wireGuardTunnelsForNode(node.id)) {
        items.push({
          id: `wireguard-interface:${node.id}:${tunnel.id}`,
          nodeId: node.id,
          deviceId: device.id,
          kind: "wireguard-interface",
          summary: `Ensure WireGuard interface ${tunnel.interfaceName} on ${node.id}`,
          payload: {
            name: tunnel.interfaceName,
            "listen-port": tunnel.listenPort,
            mtu: tunnel.mtu,
            "private-key": tunnel.privateKey,
            comment: tunnel.comment,
          },
        });

        items.push({
          id: `wireguard-peer:${node.id}:${tunnel.id}`,
          nodeId: node.id,
          deviceId: device.id,
          kind: "wireguard-peer",
          summary: `Ensure WireGuard peer on ${node.id}`,
          payload: {
            interface: tunnel.interfaceName,
            "public-key": tunnel.peerPublicKey,
            "allowed-address": tunnel.allowedAddresses,
            "endpoint-address": tunnel.endpointAddress,
            "endpoint-port": tunnel.endpointPort,
            "persistent-keepalive": tunnel.keepalive,
            comment: tunnel.comment,
          },
        });
      }
    }

    return items;
  }

  async preview(filter: FabricNodeFilter = {}): Promise<FabricPlanPreview> {
    return this.previewPlan(this.plan(filter));
  }

  async previewPlan(plan: readonly FabricPlanItem[]): Promise<FabricPlanPreview> {
    const errors = this.validatePlan(plan);
    const errorIds = new Set(errors.map((error) => error.item.id));
    const deviceIds = [...new Set(plan.map((item) => item.deviceId))];
    const snapshots = await this.inventory.snapshot({ ids: deviceIds });
    const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const inspections = new Map<string, DevicePlanItemInspection>();

    await Promise.all(
      plan.map(async (item) => {
        const device = this.inventory.get(item.deviceId);
        if (!device) {
          inspections.set(item.id, {
            status: "unsupported",
            reason: `unknown device ${item.deviceId}`,
          });
          return;
        }
        inspections.set(item.id, await device.client.inspectPlanItem(item));
      })
    );

    const devices = deviceIds.map((deviceId) => {
      const device = this.inventory.get(deviceId);
      const items = plan
        .filter((item) => item.deviceId === deviceId)
        .map((item) => ({
          ...item,
          inspection: inspections.get(item.id) ?? { status: "unsupported" as DevicePlanItemStatus },
        }));
      const validationErrors = errors.filter((error) => error.deviceId === deviceId);
      return {
        deviceId,
        nodeIds: [...new Set(items.map((item) => item.nodeId))],
        os: device?.client.os ?? "unknown",
        supported: validationErrors.length === 0,
        snapshot: snapshotMap.get(deviceId),
        items,
        validationErrors,
      } satisfies FabricPlanDevicePreview;
    });

    return {
      plan: [...plan],
      errors,
      supported: plan.filter((item) => !errorIds.has(item.id)),
      unsupported: plan.filter((item) => errorIds.has(item.id)),
      devices,
    };
  }

  async apply(plan: readonly FabricPlanItem[]): Promise<void> {
    const validationErrors = this.validatePlan(plan);
    if (validationErrors.length > 0) {
      const first = validationErrors[0];
      throw new Error(
        `Invalid fabric plan for ${first.deviceId} (${first.os}): ${first.reason}`
      );
    }

    for (const item of plan) {
      const device = this.inventory.get(item.deviceId);
      if (!device) {
        throw new Error(`Unknown device for plan item ${item.id}: ${item.deviceId}`);
      }

      await this.applyItem(device, item);
    }
  }

  async close(): Promise<void> {
    await this.inventory.close();
  }

  validatePlan(plan: readonly FabricPlanItem[]): FabricPlanValidationError[] {
    const errors: FabricPlanValidationError[] = [];

    for (const item of plan) {
      const device = this.inventory.get(item.deviceId);
      if (!device) {
        errors.push({
          item,
          deviceId: item.deviceId,
          os: "unknown",
          reason: `unknown device ${item.deviceId}`,
        });
        continue;
      }

      if (!capabilityForPlanKind(item.kind, device.client.capabilities)) {
        errors.push({
          item,
          deviceId: device.id,
          os: device.client.os,
          reason: `${item.kind} not supported by ${device.client.os}`,
        });
      }
    }

    return errors;
  }

  private async applyItem(device: DatacenterDevice, item: FabricPlanItem): Promise<void> {
    await device.client.applyPlanItem(item);
  }
}
