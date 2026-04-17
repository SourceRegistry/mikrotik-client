import {
  RouterOSClient,
  type RouterOSClientOptions,
} from "../routeros/index";
import {
  SwitchOSClient,
  encodeSwitchOSBitmask,
  decodeSwitchOSHexString,
  type SwitchOSApiSchema,
  type SwitchOSClientOptions,
} from "../switchos/index";

export type DeviceOS = "routeros" | "switchos" | "switchos-lite";

export type DeviceCapabilities = {
  switching: boolean;
  bonding: boolean;
  bridgePort: boolean;
  bridgeVlan: boolean;
  bgp: boolean;
  wireguard: boolean;
};

export type DeviceSnapshot = {
  id: string;
  os: DeviceOS;
  capabilities: DeviceCapabilities;
  identity?: string;
  version?: string;
  boardName?: string;
  platform?: string;
  cpuLoad?: string;
  uptime?: string;
};

export type DevicePlanItemKind =
  | "bond"
  | "bridge-port"
  | "bridge-vlan"
  | "bgp-template"
  | "bgp-connection"
  | "wireguard-interface"
  | "wireguard-peer";

export type DevicePlanItem = {
  id: string;
  nodeId: string;
  deviceId: string;
  kind: DevicePlanItemKind;
  summary: string;
  payload: Record<string, unknown>;
};

export type DevicePlanItemStatus =
  | "create"
  | "update"
  | "noop"
  | "unsupported";

export type DevicePlanItemInspection = {
  status: DevicePlanItemStatus;
  reason?: string;
};

export type ManagedDeviceClient = {
  os: DeviceOS;
  capabilities: DeviceCapabilities;
  raw: RouterOSClient | SwitchOSClient;
  snapshot(deviceId: string): Promise<DeviceSnapshot>;
  inspectPlanItem(item: DevicePlanItem): Promise<DevicePlanItemInspection>;
  applyPlanItem(item: DevicePlanItem): Promise<void>;
  close(): Promise<void>;
};

export const ROUTEROS_CAPABILITIES: DeviceCapabilities = {
  switching: true,
  bonding: true,
  bridgePort: true,
  bridgeVlan: true,
  bgp: true,
  wireguard: true,
};

export const SWITCHOS_CAPABILITIES: DeviceCapabilities = {
  switching: true,
  bonding: true,
  bridgePort: true,
  bridgeVlan: true,
  bgp: false,
  wireguard: false,
};

export type ManagedDeviceDefinition = {
  host: string;
  port?: number;
  tls?: boolean;
  username?: string;
  password?: string;
  os?: DeviceOS;
  baseUrl?: string;
  schema?: SwitchOSApiSchema;
  fetch?: SwitchOSClientOptions["fetch"];
};

function normalizeSwitchOSBaseUrl(definition: ManagedDeviceDefinition): string {
  if (definition.baseUrl) {
    return definition.baseUrl;
  }

  const protocol = definition.tls ? "https" : "http";
  const port =
    definition.port ??
    (definition.os === "routeros" ? undefined : definition.tls ? 443 : 80);

  return port ? `${protocol}://${definition.host}:${port}` : `${protocol}://${definition.host}`;
}

function decodeMaybeHexString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return value === undefined || value === null ? undefined : String(value);
  }

  if (value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)) {
    try {
      return decodeSwitchOSHexString(value);
    } catch {
      return value;
    }
  }

  return value;
}

function toText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function pickFirst(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }
  return undefined;
}

function toArray<T>(value: T | T[] | undefined, size: number, fallback: T): T[] {
  if (Array.isArray(value)) {
    const clone = value.slice(0, size);
    while (clone.length < size) clone.push(fallback);
    return clone;
  }

  return Array.from({ length: size }, (_unused, index) =>
    index === 0 && value !== undefined ? value : fallback
  );
}

function normalizePortName(value: unknown): string | undefined {
  const decoded = decodeMaybeHexString(value);
  return decoded ? decoded.trim() : undefined;
}

function hashGroupId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 15;
  }
  return hash + 1;
}

function extractGroupId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 15) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 15) {
        return parsed;
      }
    }
  }

  return undefined;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean).sort();
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .sort();
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [String(value)].sort();
}

function sameList(left: unknown, right: unknown): boolean {
  const a = normalizeList(left);
  const b = normalizeList(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameScalar(left: unknown, right: unknown): boolean {
  if (left === undefined || left === null || left === "") {
    return right === undefined || right === null || right === "";
  }
  if (right === undefined || right === null || right === "") {
    return false;
  }
  return String(left) === String(right);
}

class RouterOSManagedClient implements ManagedDeviceClient {
  public readonly os: DeviceOS = "routeros";
  public readonly capabilities = ROUTEROS_CAPABILITIES;
  public readonly raw: RouterOSClient;

  public constructor(options: RouterOSClientOptions) {
    this.raw = new RouterOSClient(options);
  }

  public async snapshot(deviceId: string): Promise<DeviceSnapshot> {
    const [identity, resource] = await Promise.all([
      this.raw.system.identity.get(),
      this.raw.system.resource.get({
        proplist: ["version", "board-name", "platform", "cpu-load", "uptime"],
      }),
    ]);

    return {
      id: deviceId,
      os: this.os,
      capabilities: this.capabilities,
      identity: identity?.name,
      version: resource?.version,
      boardName: resource?.["board-name"] ?? resource?.boardName,
      platform: resource?.platform,
      cpuLoad: resource?.["cpu-load"],
      uptime: resource?.uptime,
    };
  }

  public async applyPlanItem(item: DevicePlanItem): Promise<void> {
    switch (item.kind) {
      case "bond":
        await this.raw.interface.bonding.add(item.payload as any);
        return;
      case "bridge-port":
        await this.raw.bridge.port.add(item.payload as any);
        return;
      case "bridge-vlan":
        await this.raw.bridge.vlan.add(item.payload as any);
        return;
      case "bgp-template":
        await this.raw.routing.bgp.template.add(item.payload as any);
        return;
      case "bgp-connection":
        await this.raw.routing.bgp.connection.add(item.payload as any);
        return;
      case "wireguard-interface":
        await this.raw.wireguard.interface.add(item.payload as any);
        return;
      case "wireguard-peer":
        await this.raw.wireguard.peer.add(item.payload as any);
        return;
      default:
        throw new Error(`Unsupported device plan item kind: ${item.kind}`);
    }
  }

  public async close(): Promise<void> {
    await this.raw.close();
  }

  public async inspectPlanItem(item: DevicePlanItem): Promise<DevicePlanItemInspection> {
    switch (item.kind) {
      case "bond": {
        const bonds = await this.raw.interface.bonding.list();
        const existing = bonds.find((bond) => bond.name === String(item.payload.name));
        if (!existing) {
          return { status: "create" };
        }
        const matches =
          sameList(existing.slaves, item.payload.slaves) &&
          sameScalar(existing.mode, item.payload.mode) &&
          sameScalar(existing["lacp-rate"], item.payload["lacp-rate"]) &&
          sameScalar(existing["mlag-id"], item.payload["mlag-id"]) &&
          sameScalar(existing.comment, item.payload.comment);
        return { status: matches ? "noop" : "update" };
      }
      case "bridge-port": {
        const ports = await this.raw.bridge.port.list();
        const existing = ports.find(
          (port) =>
            port.bridge === String(item.payload.bridge ?? "") &&
            port.interface === String(item.payload.interface ?? "")
        );
        if (!existing) return { status: "create" };
        const matches =
          sameScalar(existing.pvid, item.payload.pvid) &&
          sameScalar(existing.comment, item.payload.comment);
        return { status: matches ? "noop" : "update" };
      }
      case "bridge-vlan": {
        const vlans = await this.raw.bridge.vlan.list();
        const existing = vlans.find(
          (vlan) =>
            vlan.bridge === String(item.payload.bridge ?? "") &&
            vlan["vlan-ids"] === String(item.payload["vlan-ids"] ?? "")
        );
        if (!existing) return { status: "create" };
        const matches =
          sameList(existing.tagged, item.payload.tagged) &&
          sameList(existing.untagged, item.payload.untagged) &&
          sameScalar(existing.comment, item.payload.comment);
        return { status: matches ? "noop" : "update" };
      }
      case "bgp-template": {
        const templates = await this.raw.routing.bgp.template.list();
        const existing = templates.find((template) => template.name === String(item.payload.name));
        if (!existing) return { status: "create" };
        const matches =
          sameScalar(existing.as, item.payload.as) &&
          sameScalar(existing["router-id"], item.payload["router-id"]) &&
          sameScalar(existing["routing-table"], item.payload["routing-table"]);
        return { status: matches ? "noop" : "update" };
      }
      case "bgp-connection": {
        const peers = await this.raw.routing.bgp.connection.list();
        const existing = peers.find((peer) => peer.name === String(item.payload.name));
        if (!existing) return { status: "create" };
        const matches =
          sameScalar(existing.as, item.payload.as) &&
          sameScalar(existing["local.address"], item.payload["local.address"]) &&
          sameScalar(existing["remote.address"], item.payload["remote.address"]) &&
          sameScalar(existing["remote.as"], item.payload["remote.as"]);
        return { status: matches ? "noop" : "update" };
      }
      case "wireguard-interface": {
        const interfaces = await this.raw.wireguard.interface.list();
        const existing = interfaces.find((entry) => entry.name === String(item.payload.name));
        if (!existing) return { status: "create" };
        const matches =
          sameScalar(existing["listen-port"], item.payload["listen-port"]) &&
          sameScalar(existing.mtu, item.payload.mtu) &&
          sameScalar(existing["private-key"], item.payload["private-key"]);
        return { status: matches ? "noop" : "update" };
      }
      case "wireguard-peer": {
        const peers = await this.raw.wireguard.peer.list();
        const existing = peers.find(
          (peer) =>
            peer.interface === String(item.payload.interface ?? "") &&
            peer["public-key"] === String(item.payload["public-key"] ?? "")
        );
        if (!existing) return { status: "create" };
        const matches =
          sameList(existing["allowed-address"], item.payload["allowed-address"]) &&
          sameScalar(existing["endpoint-address"], item.payload["endpoint-address"]) &&
          sameScalar(existing["endpoint-port"], item.payload["endpoint-port"]) &&
          sameScalar(existing["persistent-keepalive"], item.payload["persistent-keepalive"]);
        return { status: matches ? "noop" : "update" };
      }
      default:
        return { status: "unsupported", reason: `Unsupported device plan item kind: ${item.kind}` };
    }
  }
}

class SwitchOSManagedClient implements ManagedDeviceClient {
  public readonly os: DeviceOS;
  public readonly capabilities = SWITCHOS_CAPABILITIES;
  public readonly raw: SwitchOSClient;
  private readonly lagMembers = new Map<string, string[]>();
  private readonly lagGroups = new Map<string, number>();

  public constructor(os: DeviceOS, options: SwitchOSClientOptions) {
    this.os = os;
    this.raw = new SwitchOSClient(options);
  }

  public async snapshot(deviceId: string): Promise<DeviceSnapshot> {
    const sys = (await this.raw.read("/sys.b")) as Record<string, unknown>;

    return {
      id: deviceId,
      os: this.os,
      capabilities: this.capabilities,
      identity: decodeMaybeHexString(pickFirst(sys, ["id", "i05"])),
      version: decodeMaybeHexString(pickFirst(sys, ["ver", "i06", "fw", "firmware"])),
      boardName: decodeMaybeHexString(pickFirst(sys, ["brd", "i07", "model"])),
      platform: this.os,
      cpuLoad: toText(pickFirst(sys, ["cpu", "cpu-load"])),
      uptime: toText(pickFirst(sys, ["upt", "i01"])),
    };
  }

  public async applyPlanItem(item: DevicePlanItem): Promise<void> {
    switch (item.kind) {
      case "bridge-port":
        if (!this.capabilities.bridgePort) {
          throw new Error(`${this.os} does not support bridge-port operations.`);
        }
        return;
      case "bridge-vlan":
        await this.applyBridgeVlan(item);
        return;
      case "bond":
        await this.applyBond(item);
        return;
      default:
        throw new Error(
          `Fabric apply for ${this.os} not implemented for plan item ${item.kind}.`
        );
    }
  }

  public async close(): Promise<void> {
    return;
  }

  public async inspectPlanItem(item: DevicePlanItem): Promise<DevicePlanItemInspection> {
    switch (item.kind) {
      case "bridge-port":
        return { status: "noop", reason: "SwOS bridge-port modeled through VLAN/LAG state." };
      case "bridge-vlan": {
        const rows = (await this.raw.read("/vlan.b")) as Array<Record<string, unknown>>;
        const portMap = await this.getPortMap();
        const vidKey = this.getWireKey(
          "/vlan.b",
          "VLAN ID",
          this.os === "switchos-lite" ? "i01" : "vid"
        );
        const membersKey = this.getWireKey(
          "/vlan.b",
          "Members",
          this.os === "switchos-lite" ? "i02" : "mbr"
        );
        const vlanId = Number(item.payload["vlan-ids"]);
        const interfaceNames = this.expandInterfaceNames([
          ...(((item.payload.tagged as readonly string[] | undefined) ?? [])),
          ...(((item.payload.untagged as readonly string[] | undefined) ?? [])),
        ]);
        const desiredMask = encodeSwitchOSBitmask(
          interfaceNames.map((name) => {
            const index = portMap.get(name);
            if (!index) {
              throw new Error(`Unknown SwOS port '${name}' for ${item.id}`);
            }
            return index - 1;
          })
        );
        const existing = rows.find((row) => Number(row[vidKey]) === vlanId);
        if (!existing) return { status: "create" };
        return {
          status: Number(existing[membersKey]) === desiredMask ? "noop" : "update",
        };
      }
      case "bond": {
        const portMap = await this.getPortMap();
        const current = (await this.raw.read("/lacp.b")) as Record<string, unknown>;
        const modeKey = this.getWireKey(
          "/lacp.b",
          "Mode",
          this.os === "switchos-lite" ? "i01" : "mode"
        );
        const groupKey = this.getWireKey(
          "/lacp.b",
          "Group",
          this.os === "switchos-lite" ? "i03" : "sgrp"
        );
        const members = (item.payload.slaves as readonly string[] | undefined) ?? [];
        const bondName = String(item.payload.name ?? item.id);
        const desiredGroup =
          extractGroupId(item.payload["mlag-id"]) ??
          this.lagGroups.get(bondName) ??
          hashGroupId(bondName);
        const modeValues = toArray<number>(current[modeKey] as number | number[] | undefined, portMap.size, 0);
        const groupValues = toArray<number>(current[groupKey] as number | number[] | undefined, portMap.size, 0);
        const desiredPorts = new Set(
          members.map((name) => {
            const index = portMap.get(name);
            if (!index) {
              throw new Error(`Unknown SwOS port '${name}' for bond ${bondName}`);
            }
            return index - 1;
          })
        );
        const matchingPorts = new Set<number>();
        groupValues.forEach((value, index) => {
          if (Number(value) === desiredGroup && Number(modeValues[index]) === 1) {
            matchingPorts.add(index);
          }
        });
        if (matchingPorts.size === 0) {
          return { status: "create" };
        }
        const same =
          desiredPorts.size === matchingPorts.size &&
          [...desiredPorts].every((index) => matchingPorts.has(index));
        return { status: same ? "noop" : "update" };
      }
      default:
        return {
          status: "unsupported",
          reason: `Fabric preview for ${this.os} does not support ${item.kind}.`,
        };
    }
  }

  private getWireKey(endpoint: string, label: string, fallback: string): string {
    const section = this.raw.getEndpointSchema(endpoint)?.sections ?? [];
    for (const group of section) {
      for (const control of group.controls) {
        if (control.label === label && control.wire_keys[0]) {
          return control.wire_keys[0];
        }
      }
    }
    return fallback;
  }

  private async getPortMap(): Promise<Map<string, number>> {
    const link = (await this.raw.read("/link.b")) as Record<string, unknown>;
    const nameKey = this.getWireKey(
      "/link.b",
      "Name",
      this.os === "switchos-lite" ? "i0a" : "nm"
    );
    const values = Array.isArray(link[nameKey]) ? link[nameKey] : [link[nameKey]];
    const ports = new Map<string, number>();

    values.forEach((value, index) => {
      const name = normalizePortName(value);
      if (name) {
        ports.set(name, index + 1);
      }
    });

    return ports;
  }

  private expandInterfaceNames(values: readonly string[]): string[] {
    const expanded = new Set<string>();

    for (const value of values) {
      const members = this.lagMembers.get(value);
      if (members) {
        for (const member of members) expanded.add(member);
        continue;
      }
      expanded.add(value);
    }

    return [...expanded];
  }

  private async applyBridgeVlan(item: DevicePlanItem): Promise<void> {
    const rows = (await this.raw.read("/vlan.b")) as Array<Record<string, unknown>>;
    const portMap = await this.getPortMap();
    const vidKey = this.getWireKey(
      "/vlan.b",
      "VLAN ID",
      this.os === "switchos-lite" ? "i01" : "vid"
    );
    const membersKey = this.getWireKey(
      "/vlan.b",
      "Members",
      this.os === "switchos-lite" ? "i02" : "mbr"
    );
    const igmpKey = this.getWireKey(
      "/vlan.b",
      "IGMP Snooping",
      this.os === "switchos-lite" ? "i03" : "igmp"
    );

    const vlanId = Number(item.payload["vlan-ids"]);
    if (!Number.isInteger(vlanId) || vlanId <= 0) {
      throw new Error(`Invalid SwOS VLAN id for ${item.id}`);
    }

    const interfaceNames = this.expandInterfaceNames([
      ...(((item.payload.tagged as readonly string[] | undefined) ?? [])),
      ...(((item.payload.untagged as readonly string[] | undefined) ?? [])),
    ]);

    const memberIndices = interfaceNames.map((name) => {
      const index = portMap.get(name);
      if (!index) {
        throw new Error(`Unknown SwOS port '${name}' for ${item.id}`);
      }
      return index - 1;
    });

    const memberMask = encodeSwitchOSBitmask(memberIndices);
    const existingIndex = rows.findIndex((row) => Number(row[vidKey]) === vlanId);
    const row =
      existingIndex === -1
        ? {}
        : { ...rows[existingIndex] };

    row[vidKey] = vlanId;
    row[membersKey] = memberMask;
    if (igmpKey && !(igmpKey in row)) {
      row[igmpKey] = 0;
    }

    if (existingIndex === -1) {
      rows.push(row);
    } else {
      rows[existingIndex] = row;
    }

    await this.raw.write("/vlan.b", rows as unknown as Parameters<SwitchOSClient["write"]>[1]);
  }

  private async applyBond(item: DevicePlanItem): Promise<void> {
    const modeText = String(item.payload.mode ?? "802.3ad");
    const bondName = String(item.payload.name ?? item.id);
    if (modeText !== "802.3ad") {
      throw new Error(`SwOS LAG only supports 802.3ad/static style grouping. Got ${modeText}`);
    }

    const members = (item.payload.slaves as readonly string[] | undefined) ?? [];
    if (members.length === 0) {
      throw new Error(`SwOS bond ${bondName} has no member ports.`);
    }

    const portMap = await this.getPortMap();
    const portNumbers = members.map((name) => {
      const index = portMap.get(name);
      if (!index) {
        throw new Error(`Unknown SwOS port '${name}' for bond ${bondName}`);
      }
      return index;
    });

    const current = (await this.raw.read("/lacp.b")) as Record<string, unknown>;
    const modeKey = this.getWireKey(
      "/lacp.b",
      "Mode",
      this.os === "switchos-lite" ? "i01" : "mode"
    );
    const groupKey = this.getWireKey(
      "/lacp.b",
      "Group",
      this.os === "switchos-lite" ? "i03" : "sgrp"
    );

    const groupId =
      extractGroupId(item.payload["mlag-id"]) ??
      this.lagGroups.get(bondName) ??
      hashGroupId(bondName);
    const modeValues = toArray<number>(current[modeKey] as number | number[] | undefined, portMap.size, 0);
    const groupValues = toArray<number>(current[groupKey] as number | number[] | undefined, portMap.size, 0);

    for (const previous of this.lagMembers.get(bondName) ?? []) {
      const port = portMap.get(previous);
      if (port) {
        modeValues[port - 1] = 0;
        groupValues[port - 1] = 0;
      }
    }

    for (const port of portNumbers) {
      modeValues[port - 1] = 1;
      groupValues[port - 1] = groupId;
    }

    current[modeKey] = modeValues;
    current[groupKey] = groupValues;

    await this.raw.write("/lacp.b", current as unknown as Parameters<SwitchOSClient["write"]>[1]);
    this.lagGroups.set(bondName, groupId);
    this.lagMembers.set(bondName, [...members]);
  }
}

export function createManagedDeviceClient(
  definition: ManagedDeviceDefinition
): ManagedDeviceClient {
  const os = definition.os ?? "routeros";

  if (os === "routeros") {
    return new RouterOSManagedClient({
      host: definition.host,
      port: definition.port,
      tls: definition.tls,
      username: definition.username,
      password: definition.password,
    });
  }

  return new SwitchOSManagedClient(os, {
    baseUrl: normalizeSwitchOSBaseUrl(definition),
    username: definition.username,
    password: definition.password,
    schema: definition.schema,
    fetch: definition.fetch,
  });
}
