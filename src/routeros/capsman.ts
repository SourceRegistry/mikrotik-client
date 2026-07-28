/**
 * @module routeros/capsman
 *
 * CAPsMan (Controlled Access Point System Manager) resource helpers.
 *
 * @example
 * ```ts
 * const { capsman } = createRouterOSHelpers(transport);
 * const configs = await capsman.configuration.list();
 * ```
 */

import type { RouterOSCommandOptions, RouterOSPrimitive, RouterOSRecord } from "./index";
import type { DeviceTransport } from "./transport";
import { parseBool, parseInteger } from "../utils/codecs";
import { createWatch } from "./typed-stream";
import type { WatchFactory } from "./typed-stream";

// ─── Enums ──────────────────────────────────────────────────────────────────

export type CapsManWirelessMode =
  | "ap-bridge"
  | "ap-bridge-network-aware"
  | "ap-client"
  | "client"
  | "station"
  | "station-list"
  | "monitor"
  | "tap"
  | "tap5g"
  | "nstd"
  | "sniffer"
  | "apk-bridge"
  | "apk-client";

export const CAPS_MAN_WIRELESS_MODES: readonly CapsManWirelessMode[] = [
  "ap-bridge",
  "ap-bridge-network-aware",
  "ap-client",
  "client",
  "station",
  "station-list",
  "monitor",
  "tap",
  "tap5g",
  "nstd",
  "sniffer",
  "apk-bridge",
  "apk-client",
] as const;

// ─── DTOs ──────────────────────────────────────────────────────────────────

export type CapsManConfiguration = {
  ".id"?: string;
  name?: string;
  ssid?: string;
  mode?: CapsManWirelessMode;
  hidden?: boolean;
  "suppress-ssid"?: boolean;
  "security-profile"?: string;
  datapath?: string;
  channel?: string;
  comment?: string;
};

export type CapsManDatapath = {
  ".id"?: string;
  name?: string;
  "use-ocb"?: boolean;
  "ocb-id"?: number;
  "bridge-mode"?: "hw" | "sw" | "disabled";
  "use-radius"?: boolean;
  "wmm-support"?: boolean;
  "isolate-caps"?: boolean;
  comment?: string;
};

export type CapsManSecurity = {
  ".id"?: string;
  name?: string;
  "wpa2-psk"?: string;
  "wpa-psk"?: string;
  "dynamic-enabled"?: boolean;
  "authentication-types-only"?: string;
  "use-radius"?: boolean;
  comment?: string;
};

export type CapsManChannel = {
  ".id"?: string;
  name?: string;
  band?: "2ghz-b/g" | "2ghz-b/g/n" | "5ghz-a" | "5ghz-a/n" | "60ghz";
  "control-channel-width"?: "20mhz" | "40mhz" | "80mhz" | "auto-20-40mhz";
  "disabled-default-frequency"?: boolean;
  "default-frequency"?: number;
  comment?: string;
};

export type CapsManProvisioning = {
  ".id"?: string;
  name?: string;
  mode?: "manual" | "none" | "profile" | "use-radio-data" | "use-ap-names";
  "idle-timeout"?: string;
  "online-timeout"?: string;
  profile?: string;
  "use-default-profile-on-fallback"?: boolean;
  comment?: string;
};

export type CapsManAccessList = {
  ".id"?: string;
  name?: string;
  configuration?: string;
  "mac-addresses"?: string | readonly string[];
  action?: "allow" | "deny";
  comment?: string;
};

export type CapsManInterface = {
  ".id"?: string;
  name?: string;
  master?: string;
  slave?: string;
  comment?: string;
};

export type CapsManRegistration = {
  ".id"?: string;
  address?: string;
  "mac-address"?: string;
  version?: string;
  board?: string;
  uptime?: string;
  "last-seen"?: string;
  "managed-by"?: string;
  model?: string;
  "cap-version"?: string;
};

export type CapsManManagerInterface = {
  ".id"?: string;
  interface?: string;
  "use-up-interface"?: boolean;
  "up-interface-expiry"?: string;
  comment?: string;
};

// ─── Helpers type ──────────────────────────────────────────────────────────

export type CapsManHelpers = {
  configuration: {
    list(options?: RouterOSPrintOptions): Promise<CapsManConfiguration[]>;
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
    ensure(
      attrs: { name: string; ssid?: string },
      options?: Omit<RouterOSCommandOptions, "attributes">
    ): Promise<void>;
  };
  datapath: {
    list(options?: RouterOSPrintOptions): Promise<CapsManDatapath[]>;
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
  security: {
    list(options?: RouterOSPrintOptions): Promise<CapsManSecurity[]>;
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
  channel: {
    list(options?: RouterOSPrintOptions): Promise<CapsManChannel[]>;
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
  provisioning: {
    list(options?: RouterOSPrintOptions): Promise<CapsManProvisioning[]>;
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
  accessList: {
    list(options?: RouterOSPrintOptions): Promise<CapsManAccessList[]>;
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
  interface: {
    list(options?: RouterOSPrintOptions): Promise<CapsManInterface[]>;
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
  manager: {
    list(options?: RouterOSPrintOptions): Promise<CapsManManagerInterface[]>;
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
  registration: {
    list(options?: RouterOSPrintOptions): Promise<CapsManRegistration[]>;
    /** Watch live AP registrations. Emits added/updated/removed events as CAPs connect and disconnect. */
    watch: WatchFactory<CapsManRegistration>["watch"];
  };
};

// ─── Exported option types ─────────────────────────────────────────────────

export type RouterOSPrintOptions = {
  proplist?: readonly string[];
  queries?: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

// ─── Parse functions ──────────────────────────────────────────────────────

function parseCapsManConfiguration(raw: RouterOSRecord): CapsManConfiguration {
  const id = raw[".id"];
  const name = raw["name"];
  const ssid = raw["ssid"];
  const mode = raw["mode"] as CapsManWirelessMode | undefined;
  const hidden = raw["hidden"];
  const suppressSsid = raw["suppress-ssid"];
  const securityProfile = raw["security-profile"];
  const datapath = raw["datapath"];
  const channel = raw["channel"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(ssid !== undefined && { ssid }),
    ...(mode !== undefined && { mode }),
    ...(hidden !== undefined && { hidden: parseBool(hidden) }),
    ...(suppressSsid !== undefined && { "suppress-ssid": parseBool(suppressSsid) }),
    ...(securityProfile !== undefined && { "security-profile": securityProfile }),
    ...(datapath !== undefined && { datapath }),
    ...(channel !== undefined && { channel }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManDatapath(raw: RouterOSRecord): CapsManDatapath {
  const id = raw[".id"];
  const name = raw["name"];
  const useOcb = raw["use-ocb"];
  const ocbId = raw["ocb-id"];
  const bridgeMode = raw["bridge-mode"] as "hw" | "sw" | "disabled" | undefined;
  const useRadius = raw["use-radius"];
  const wmmSupport = raw["wmm-support"];
  const isolateCaps = raw["isolate-caps"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(useOcb !== undefined && { "use-ocb": parseBool(useOcb) }),
    ...(ocbId !== undefined && { "ocb-id": parseInteger(ocbId) }),
    ...(bridgeMode !== undefined && { "bridge-mode": bridgeMode }),
    ...(useRadius !== undefined && { "use-radius": parseBool(useRadius) }),
    ...(wmmSupport !== undefined && { "wmm-support": parseBool(wmmSupport) }),
    ...(isolateCaps !== undefined && { "isolate-caps": parseBool(isolateCaps) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManSecurity(raw: RouterOSRecord): CapsManSecurity {
  const id = raw[".id"];
  const name = raw["name"];
  const wpa2Psk = raw["wpa2-psk"];
  const wpaPsk = raw["wpa-psk"];
  const dynamicEnabled = raw["dynamic-enabled"];
  const authTypes = raw["authentication-types-only"];
  const useRadius = raw["use-radius"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(wpa2Psk !== undefined && { "wpa2-psk": wpa2Psk }),
    ...(wpaPsk !== undefined && { "wpa-psk": wpaPsk }),
    ...(dynamicEnabled !== undefined && { "dynamic-enabled": parseBool(dynamicEnabled) }),
    ...(authTypes !== undefined && { "authentication-types-only": authTypes }),
    ...(useRadius !== undefined && { "use-radius": parseBool(useRadius) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManChannel(raw: RouterOSRecord): CapsManChannel {
  const id = raw[".id"];
  const name = raw["name"];
  const band = raw["band"] as
    | "2ghz-b/g"
    | "2ghz-b/g/n"
    | "5ghz-a"
    | "5ghz-a/n"
    | "60ghz"
    | undefined;
  const controlWidth = raw["control-channel-width"] as
    | "20mhz"
    | "40mhz"
    | "80mhz"
    | "auto-20-40mhz"
    | undefined;
  const disabledFreq = raw["disabled-default-frequency"];
  const defaultFreq = raw["default-frequency"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(band !== undefined && { band }),
    ...(controlWidth !== undefined && { "control-channel-width": controlWidth }),
    ...(disabledFreq !== undefined && { "disabled-default-frequency": parseBool(disabledFreq) }),
    ...(defaultFreq !== undefined && { "default-frequency": parseInteger(defaultFreq) }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManProvisioning(raw: RouterOSRecord): CapsManProvisioning {
  const id = raw[".id"];
  const name = raw["name"];
  const mode = raw["mode"] as
    | "manual"
    | "none"
    | "profile"
    | "use-radio-data"
    | "use-ap-names"
    | undefined;
  const idleTimeout = raw["idle-timeout"];
  const onlineTimeout = raw["online-timeout"];
  const profile = raw["profile"];
  const useDefaultOnFallback = raw["use-default-profile-on-fallback"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(mode !== undefined && { mode }),
    ...(idleTimeout !== undefined && { "idle-timeout": idleTimeout }),
    ...(onlineTimeout !== undefined && { "online-timeout": onlineTimeout }),
    ...(profile !== undefined && { profile }),
    ...(useDefaultOnFallback !== undefined && {
      "use-default-profile-on-fallback": parseBool(useDefaultOnFallback),
    }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManAccessList(raw: RouterOSRecord): CapsManAccessList {
  const id = raw[".id"];
  const name = raw["name"];
  const configuration = raw["configuration"];
  const macAddresses = raw["mac-addresses"];
  const action = raw["action"] as "allow" | "deny" | undefined;
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(configuration !== undefined && { configuration }),
    ...(macAddresses !== undefined && { "mac-addresses": macAddresses }),
    ...(action !== undefined && { action }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManInterface(raw: RouterOSRecord): CapsManInterface {
  const id = raw[".id"];
  const name = raw["name"];
  const master = raw["master"];
  const slave = raw["slave"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(name !== undefined && { name }),
    ...(master !== undefined && { master }),
    ...(slave !== undefined && { slave }),
    ...(comment !== undefined && { comment }),
  };
}

function parseCapsManRegistration(raw: RouterOSRecord): CapsManRegistration {
  const id = raw[".id"];
  const address = raw["address"];
  const mac = raw["mac-address"];
  const version = raw["version"];
  const board = raw["board"];
  const uptime = raw["uptime"];
  const lastSeen = raw["last-seen"];
  const managedBy = raw["managed-by"];
  const model = raw["model"];
  const capVersion = raw["cap-version"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(address !== undefined && { address }),
    ...(mac !== undefined && { "mac-address": mac }),
    ...(version !== undefined && { version }),
    ...(board !== undefined && { board }),
    ...(uptime !== undefined && { uptime }),
    ...(lastSeen !== undefined && { "last-seen": lastSeen }),
    ...(managedBy !== undefined && { "managed-by": managedBy }),
    ...(model !== undefined && { model }),
    ...(capVersion !== undefined && { "cap-version": capVersion }),
  };
}

function parseCapsManManagerInterface(raw: RouterOSRecord): CapsManManagerInterface {
  const id = raw[".id"];
  const iface = raw["interface"];
  const useUpInterface = raw["use-up-interface"];
  const upInterfaceExpiry = raw["up-interface-expiry"];
  const comment = raw["comment"];
  return {
    ...(id !== undefined && { ".id": id }),
    ...(iface !== undefined && { interface: iface }),
    ...(useUpInterface !== undefined && { "use-up-interface": parseBool(useUpInterface) }),
    ...(upInterfaceExpiry !== undefined && { "up-interface-expiry": upInterfaceExpiry }),
    ...(comment !== undefined && { comment }),
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────

function toPrintOptions(options: RouterOSPrintOptions = {}): RouterOSCommandOptions {
  const { proplist, queries, signal, timeoutMs } = options;
  const result: RouterOSCommandOptions = {};
  if (proplist !== undefined) result.attributes = { ...result.attributes, ".proplist": proplist };
  if (queries !== undefined) result.queries = queries;
  if (signal !== undefined) result.signal = signal;
  if (timeoutMs !== undefined) result.timeoutMs = timeoutMs;
  return result;
}

function withId(
  id: string,
  attrs?: Record<string, RouterOSPrimitive>
): Record<string, RouterOSPrimitive> {
  return { ".id": id, ...attrs };
}

// ─── Factory ──────────────────────────────────────────────────────────────

/**
 * Create typed CAPsMan helper namespace.
 * Returns `CapsManHelpers` object bound to a transport.
 *
 * NOTE: Not exported as a standalone function. CAPsMan helpers are accessed
 * through the `capsman` property on {@link RouterOSHelpers} via
 * {@link createRouterOSHelpers}.
 *
 * @internal
 */
export function createCapsManHelpers(client: DeviceTransport): CapsManHelpers {
  return {
    configuration: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManConfiguration[]> {
        return client
          .print("/caps-man/configuration", toPrintOptions(options))
          .then((r) => r.map(parseCapsManConfiguration));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/configuration/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/configuration/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/configuration/remove", {
          ...options,
          attributes: withId(id),
        });
      },
      async ensure(
        attrs: { name: string; ssid?: string },
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        const entities = await client.print(
          "/caps-man/configuration",
          toPrintOptions({ queries: [`?name=${attrs.name}`] })
        );
        const parsed = entities.map(parseCapsManConfiguration);
        const existing = parsed.find((e) => e.name === attrs.name);
        if (existing?.[".id"]) {
          const updates: Record<string, RouterOSPrimitive> = {};
          if (attrs.ssid !== undefined) updates.ssid = attrs.ssid;
          if (Object.keys(updates).length > 0) {
            await client.execute("/caps-man/configuration/set", {
              ...options,
              attributes: withId(existing[".id"], updates),
            });
          }
        } else {
          await client.execute("/caps-man/configuration/add", { ...options, attributes: attrs });
        }
      },
    },
    datapath: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManDatapath[]> {
        return client
          .print("/caps-man/datapath", toPrintOptions(options))
          .then((r) => r.map(parseCapsManDatapath));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/datapath/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/datapath/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/datapath/remove", { ...options, attributes: withId(id) });
      },
    },
    security: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManSecurity[]> {
        return client
          .print("/caps-man/security", toPrintOptions(options))
          .then((r) => r.map(parseCapsManSecurity));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/security/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/security/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/security/remove", { ...options, attributes: withId(id) });
      },
    },
    channel: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManChannel[]> {
        return client
          .print("/caps-man/channel", toPrintOptions(options))
          .then((r) => r.map(parseCapsManChannel));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/channel/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/channel/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/channel/remove", { ...options, attributes: withId(id) });
      },
    },
    provisioning: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManProvisioning[]> {
        return client
          .print("/caps-man/provisioning", toPrintOptions(options))
          .then((r) => r.map(parseCapsManProvisioning));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/provisioning/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/provisioning/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/provisioning/remove", {
          ...options,
          attributes: withId(id),
        });
      },
    },
    accessList: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManAccessList[]> {
        return client
          .print("/caps-man/access-list", toPrintOptions(options))
          .then((r) => r.map(parseCapsManAccessList));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/access-list/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/access-list/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/access-list/remove", {
          ...options,
          attributes: withId(id),
        });
      },
    },
    interface: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManInterface[]> {
        return client
          .print("/caps-man/interface", toPrintOptions(options))
          .then((r) => r.map(parseCapsManInterface));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/interface/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/interface/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/interface/remove", { ...options, attributes: withId(id) });
      },
    },
    manager: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManManagerInterface[]> {
        return client
          .print("/caps-man/manager", toPrintOptions(options))
          .then((r) => r.map(parseCapsManManagerInterface));
      },
      async add(
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/manager/add", { ...options, attributes });
      },
      async set(
        id: string,
        attributes: Record<string, RouterOSPrimitive>,
        options: Omit<RouterOSCommandOptions, "attributes"> = {}
      ) {
        await client.execute("/caps-man/manager/set", {
          ...options,
          attributes: withId(id, attributes),
        });
      },
      async remove(id: string, options: Omit<RouterOSCommandOptions, "attributes"> = {}) {
        await client.execute("/caps-man/manager/remove", { ...options, attributes: withId(id) });
      },
    },
    registration: {
      list(options: RouterOSPrintOptions = {}): Promise<CapsManRegistration[]> {
        return client
          .print("/caps-man/registration", toPrintOptions(options))
          .then((r) => r.map(parseCapsManRegistration));
      },
      watch: createWatch({
        transport: client,
        printPath: "/caps-man/registration",
        listenPath: "/caps-man/registration/listen",
        parseFn: parseCapsManRegistration,
      }).watch,
    },
  };
}
