import {
  createManagedDeviceClient,
  type DeviceOS,
  type DeviceSnapshot,
  type ManagedDeviceClient,
} from "../../device/index";
import { RouterOSClient } from "../../routeros/index";
import type { SwitchOSApiSchema } from "../../switchos/index";

export type DatacenterDeviceDefinition = {
  id: string;
  host: string;
  port?: number;
  tls?: boolean;
  username?: string;
  password?: string;
  site?: string;
  role?: string;
  tags?: readonly string[];
  meta?: Record<string, string>;
  name?: string;
  os?: DeviceOS;
  baseUrl?: string;
  schema?: SwitchOSApiSchema;
};

export type DatacenterDeviceSnapshot = DeviceSnapshot;

export type DatacenterDevice = DatacenterDeviceDefinition & {
  client: ManagedDeviceClient;
};

export type DatacenterDiscoveryCredentials = {
  username: string;
  password?: string;
};

export type DatacenterDiscoveryOptions = {
  subnets: readonly string[];
  credentials: DatacenterDiscoveryCredentials | readonly DatacenterDiscoveryCredentials[];
  ports?: readonly number[];
  tlsPorts?: readonly number[];
  timeoutMs?: number;
  concurrency?: number;
  defaultSite?: string;
  defaultRole?: string;
  tags?: readonly string[];
};

export type DatacenterDiscoveredDevice = DatacenterDeviceDefinition & {
  identity?: string;
  version?: string;
  boardName?: string;
  platform?: string;
};

type RunTarget =
  | string
  | {
      ids?: readonly string[];
      site?: string;
      role?: string;
      tags?: readonly string[];
    };

function normalizeTags(tags?: readonly string[]): string[] {
  return [...new Set((tags ?? []).filter(Boolean))];
}

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }

  return (((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)) >>> 0;
}

function intToIp(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function expandCidr(cidr: string): string[] {
  const [ip, maskText] = cidr.split("/");
  const mask = Number(maskText);
  if (!ip || !Number.isInteger(mask) || mask < 0 || mask > 32) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }

  const hostCount = 2 ** (32 - mask);
  if (hostCount > 65536) {
    throw new Error(`CIDR too large for discovery scan: ${cidr}`);
  }

  const base = ipToInt(ip);
  const networkMask = mask === 0 ? 0 : ((0xffffffff << (32 - mask)) >>> 0);
  const network = base & networkMask;
  const first = hostCount <= 2 ? network : network + 1;
  const last = hostCount <= 2 ? network + hostCount - 1 : network + hostCount - 2;
  const hosts: string[] = [];

  for (let current = first; current <= last; current += 1) {
    hosts.push(intToIp(current >>> 0));
  }

  return hosts;
}

async function runLimited<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function probeDevice(
  host: string,
  options: {
    port: number;
    tls: boolean;
    timeoutMs: number;
    credentials: DatacenterDiscoveryCredentials;
    defaultSite?: string;
    defaultRole?: string;
    tags?: readonly string[];
  }
): Promise<DatacenterDiscoveredDevice | undefined> {
  const client = new RouterOSClient({
    host,
    port: options.port,
    tls: options.tls,
    username: options.credentials.username,
    password: options.credentials.password,
    timeoutMs: options.timeoutMs,
  });

  try {
    const [identity, resource] = await Promise.all([
      client.system.identity.get({ timeoutMs: options.timeoutMs }),
      client.system.resource.get({
        timeoutMs: options.timeoutMs,
        proplist: ["version", "board-name", "platform", "uptime"],
      }),
    ]);

    return {
      id: `${host}:${options.port}`,
      host,
      port: options.port,
      tls: options.tls,
      username: options.credentials.username,
      password: options.credentials.password,
      name: identity?.name ?? host,
      site: options.defaultSite,
      role: options.defaultRole,
      tags: normalizeTags(options.tags),
      identity: identity?.name,
      version: resource?.version,
      boardName: resource?.["board-name"] ?? resource?.boardName,
      platform: resource?.platform,
    };
  } catch {
    return undefined;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export class DatacenterManager {
  private readonly devices = new Map<string, DatacenterDevice>();

  public constructor(definitions: readonly DatacenterDeviceDefinition[] = []) {
    for (const definition of definitions) {
      this.add(definition);
    }
  }

  add(definition: DatacenterDeviceDefinition): DatacenterDevice {
    const existing = this.devices.get(definition.id);
    if (existing) {
      return existing;
    }

    const device: DatacenterDevice = {
      ...definition,
      os: definition.os ?? "routeros",
      tags: normalizeTags(definition.tags),
      client: createManagedDeviceClient(definition),
    };

    this.devices.set(device.id, device);
    return device;
  }

  list(): DatacenterDevice[] {
    return [...this.devices.values()];
  }

  get(id: string): DatacenterDevice | undefined {
    return this.devices.get(id);
  }

  bySite(site: string): DatacenterDevice[] {
    return this.list().filter((device) => device.site === site);
  }

  byRole(role: string): DatacenterDevice[] {
    return this.list().filter((device) => device.role === role);
  }

  byTag(tag: string): DatacenterDevice[] {
    return this.list().filter((device) => device.tags?.includes(tag));
  }

  select(target: RunTarget): DatacenterDevice[] {
    if (typeof target === "string") {
      const device = this.get(target);
      return device ? [device] : [];
    }

    const ids = target.ids ? new Set(target.ids) : undefined;
    const tags = target.tags ? new Set(target.tags) : undefined;

    return this.list().filter((device) => {
      if (ids && !ids.has(device.id)) return false;
      if (target.site && device.site !== target.site) return false;
      if (target.role && device.role !== target.role) return false;
      if (tags && ![...tags].every((tag) => device.tags?.includes(tag))) return false;
      return true;
    });
  }

  async snapshot(target?: RunTarget): Promise<DatacenterDeviceSnapshot[]> {
    const devices = target ? this.select(target) : this.list();
    return Promise.all(
      devices.map((device) => device.client.snapshot(device.id))
    );
  }

  async run<T>(
    target: RunTarget,
    action: (device: DatacenterDevice) => Promise<T>
  ): Promise<Array<{ device: DatacenterDevice; result: T }>> {
    const devices = this.select(target);
    return Promise.all(
      devices.map(async (device) => ({
        device,
        result: await action(device),
      }))
    );
  }

  async close(): Promise<void> {
    await Promise.all(
      this.list().map((device) => device.client.close().catch(() => undefined))
    );
  }

  static async discover(
    options: DatacenterDiscoveryOptions
  ): Promise<DatacenterDiscoveredDevice[]> {
    const credentials = Array.isArray(options.credentials)
      ? options.credentials
      : [options.credentials];
    const ports = options.ports ?? [8728];
    const tlsPorts = options.tlsPorts ?? [8729];
    const timeoutMs = options.timeoutMs ?? 1500;
    const concurrency = options.concurrency ?? 64;
    const hosts = [...new Set(options.subnets.flatMap((subnet) => expandCidr(subnet)))];

    const probes = hosts.flatMap((host) => [
      ...ports.flatMap((port) =>
        credentials.map((credential) => ({
          host,
          port,
          tls: false,
          credential,
        }))
      ),
      ...tlsPorts.flatMap((port) =>
        credentials.map((credential) => ({
          host,
          port,
          tls: true,
          credential,
        }))
      ),
    ]);

    const found = await runLimited(probes, concurrency, async (probe) =>
      probeDevice(probe.host, {
        port: probe.port,
        tls: probe.tls,
        timeoutMs,
        credentials: probe.credential,
        defaultSite: options.defaultSite,
        defaultRole: options.defaultRole,
        tags: options.tags,
      })
    );

    const deduped = new Map<string, DatacenterDiscoveredDevice>();
    for (const device of found) {
      if (!device) continue;
      const key = `${device.host}:${device.port}:${device.username ?? ""}`;
      if (!deduped.has(key)) {
        deduped.set(key, device);
      }
    }

    return [...deduped.values()];
  }
}
