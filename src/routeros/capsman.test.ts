import { describe, expect, it, vi } from "vitest";
import type { DeviceTransport, RouterOSRecord } from "./index";
import { createCapsManHelpers } from "./capsman";

// ─── Mock transport ─────────────────────────────────────────────────────

function createMockTransport(): ReturnType<typeof vi.fn> & DeviceTransport {
    return {
        execute: vi.fn().mockResolvedValue({}),
        print: vi.fn().mockResolvedValue([] as RouterOSRecord[]),
        listen: vi.fn().mockResolvedValue({} as any),
    };
}

// ─── Fixtures ────────────────────────────────────────────────────────────

const rawConfig = [
    {
        ".id": "*1",
        name: "office-5ghz",
        ssid: "OfficeWiFi5",
        mode: "ap-bridge",
        hidden: "yes",
        "suppress-ssid": "no",
        "security-profile": "office-wpa2",
        datapath: "office-dp",
        channel: "office-ch",
        comment: "5GHz AP config",
    },
];

const rawDatapath = [
    {
        ".id": "*2",
        name: "office-dp",
        "use-ocb": "no",
        "ocb-id": "0",
        "bridge-mode": "hw",
        "use-radius": "no",
        "wmm-support": "yes",
        "isolate-caps": "no",
        comment: "office datapath",
    },
];

const rawSecurity = [
    {
        ".id": "*3",
        name: "office-wpa2",
        "wpa2-psk": "secret123",
        "wpa-psk": "",
        "dynamic-enabled": "yes",
        "authentication-types-only": "wpa2-psk",
        "use-radius": "no",
        comment: "office security",
    },
];

const rawChannel = [
    {
        ".id": "*4",
        name: "office-ch",
        band: "5ghz-a/n",
        "control-channel-width": "auto-20-40mhz",
        "disabled-default-frequency": "no",
        "default-frequency": "5180",
        comment: "5GHz channel",
    },
];

const rawProvisioning = [
    {
        ".id": "*5",
        name: "default-prov",
        mode: "profile",
        "idle-timeout": "1h",
        "online-timeout": "2m",
        profile: "office-5ghz",
        "use-default-profile-on-fallback": "yes",
        comment: "default provisioning",
    },
];

const rawAccessList = [
    {
        ".id": "*6",
        name: "allow-office",
        configuration: "office-5ghz",
        "mac-addresses": "00:11:22:33:44:55",
        action: "allow",
        comment: "allow office MAC",
    },
];

const rawInterface = [
    {
        ".id": "*7",
        name: "wlan1",
        master: "",
        slave: "",
        comment: "wlan interface",
    },
];

const rawRegistration = [
    {
        ".id": "*8",
        address: "192.168.88.1",
        "mac-address": "AA:BB:CC:DD:EE:FF",
        version: "v7.15",
        board: "RB5009UG+S+IN",
        uptime: "1w2d3h",
        "last-seen": "00:00:01",
        "managed-by": "office-5ghz",
        model: "CCR2004",
        "cap-version": "7.15",
    },
];

const rawManager = [
    {
        ".id": "*9",
        interface: "bridge-mgmt",
        "use-up-interface": "yes",
        "up-interface-expiry": "1m",
        comment: "manager interface",
    },
];

describe("capsman helpers", () => {
    describe("configuration", () => {
        it("lists configurations", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawConfig);
            const capsman = createCapsManHelpers(client);
            const configs = await capsman.configuration.list();
            expect(configs).toHaveLength(1);
            expect(configs[0]).toMatchObject({
                ".id": "*1",
                name: "office-5ghz",
                ssid: "OfficeWiFi5",
                mode: "ap-bridge",
                hidden: true,
                "suppress-ssid": false,
                "security-profile": "office-wpa2",
                datapath: "office-dp",
                channel: "office-ch",
                comment: "5GHz AP config",
            });
        });

        it("adds a configuration", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.add({ name: "test", ssid: "TestSSID" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/configuration/add", {
                attributes: { name: "test", ssid: "TestSSID" },
            });
        });

        it("sets a configuration", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.set("*1", { ssid: "NewSSID" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/configuration/set", {
                attributes: { ".id": "*1", ssid: "NewSSID" },
            });
        });

        it("removes a configuration", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.remove("*1");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/configuration/remove", {
                attributes: { ".id": "*1" },
            });
        });

        it("ensures configuration - creates when missing", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce([]);
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.ensure({ name: "new-config", ssid: "NewSSID" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/configuration/add", {
                attributes: { name: "new-config", ssid: "NewSSID" },
            });
        });

        it("ensures configuration - updates when exists", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce([{ ".id": "*1", name: "existing", ssid: "Old" }]);
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.ensure({ name: "existing", ssid: "New" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/configuration/set", {
                attributes: { ".id": "*1", ssid: "New" },
            });
        });

        it("ensures configuration - no-op when no updates needed", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce([{ ".id": "*1", name: "existing" }]);
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.ensure({ name: "existing" });
            expect(client.execute).not.toHaveBeenCalled();
        });
    });

    describe("datapath", () => {
        it("lists datapaths", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawDatapath);
            const capsman = createCapsManHelpers(client);
            const dps = await capsman.datapath.list();
            expect(dps).toHaveLength(1);
            expect(dps[0]).toMatchObject({
                ".id": "*2",
                name: "office-dp",
                "use-ocb": false,
                "ocb-id": 0,
                "bridge-mode": "hw",
                "use-radius": false,
                "wmm-support": true,
                "isolate-caps": false,
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.datapath.add({ name: "test" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/datapath/add", {
                attributes: { name: "test" },
            });
            await capsman.datapath.set("*1", { "bridge-mode": "sw" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/datapath/set", {
                attributes: { ".id": "*1", "bridge-mode": "sw" },
            });
            await capsman.datapath.remove("*1");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/datapath/remove", {
                attributes: { ".id": "*1" },
            });
        });
    });

    describe("security", () => {
        it("lists security profiles", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawSecurity);
            const capsman = createCapsManHelpers(client);
            const secs = await capsman.security.list();
            expect(secs).toHaveLength(1);
            expect(secs[0]).toMatchObject({
                ".id": "*3",
                name: "office-wpa2",
                "wpa2-psk": "secret123",
                "dynamic-enabled": true,
                "authentication-types-only": "wpa2-psk",
                "use-radius": false,
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.security.add({ name: "test", "wpa2-psk": "secret" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/security/add", {
                attributes: { name: "test", "wpa2-psk": "secret" },
            });
            await capsman.security.set("*3", { "wpa2-psk": "new" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/security/set", {
                attributes: { ".id": "*3", "wpa2-psk": "new" },
            });
            await capsman.security.remove("*3");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/security/remove", {
                attributes: { ".id": "*3" },
            });
        });
    });

    describe("channel", () => {
        it("lists channels", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawChannel);
            const capsman = createCapsManHelpers(client);
            const chans = await capsman.channel.list();
            expect(chans).toHaveLength(1);
            expect(chans[0]).toMatchObject({
                ".id": "*4",
                name: "office-ch",
                band: "5ghz-a/n",
                "control-channel-width": "auto-20-40mhz",
                "disabled-default-frequency": false,
                "default-frequency": 5180,
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.channel.add({ name: "test", band: "2ghz-b/g" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/channel/add", {
                attributes: { name: "test", band: "2ghz-b/g" },
            });
            await capsman.channel.set("*4", { "default-frequency": "5200" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/channel/set", {
                attributes: { ".id": "*4", "default-frequency": "5200" },
            });
            await capsman.channel.remove("*4");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/channel/remove", {
                attributes: { ".id": "*4" },
            });
        });
    });

    describe("provisioning", () => {
        it("lists provisioning rules", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawProvisioning);
            const capsman = createCapsManHelpers(client);
            const provs = await capsman.provisioning.list();
            expect(provs).toHaveLength(1);
            expect(provs[0]).toMatchObject({
                ".id": "*5",
                name: "default-prov",
                mode: "profile",
                "idle-timeout": "1h",
                "online-timeout": "2m",
                profile: "office-5ghz",
                "use-default-profile-on-fallback": true,
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.provisioning.add({ name: "test" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/provisioning/add", {
                attributes: { name: "test" },
            });
            await capsman.provisioning.set("*5", { mode: "manual" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/provisioning/set", {
                attributes: { ".id": "*5", mode: "manual" },
            });
            await capsman.provisioning.remove("*5");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/provisioning/remove", {
                attributes: { ".id": "*5" },
            });
        });
    });

    describe("accessList", () => {
        it("lists access list rules", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawAccessList);
            const capsman = createCapsManHelpers(client);
            const acls = await capsman.accessList.list();
            expect(acls).toHaveLength(1);
            expect(acls[0]).toMatchObject({
                ".id": "*6",
                name: "allow-office",
                configuration: "office-5ghz",
                "mac-addresses": "00:11:22:33:44:55",
                action: "allow",
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.accessList.add({ name: "block", action: "deny" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/access-list/add", {
                attributes: { name: "block", action: "deny" },
            });
            await capsman.accessList.set("*6", { action: "deny" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/access-list/set", {
                attributes: { ".id": "*6", action: "deny" },
            });
            await capsman.accessList.remove("*6");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/access-list/remove", {
                attributes: { ".id": "*6" },
            });
        });
    });

    describe("interface", () => {
        it("lists CAPsMan interfaces", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawInterface);
            const capsman = createCapsManHelpers(client);
            const ifaces = await capsman.interface.list();
            expect(ifaces).toHaveLength(1);
            expect(ifaces[0]).toMatchObject({
                ".id": "*7",
                name: "wlan1",
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.interface.add({ name: "wlan2", master: "bridge1" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/interface/add", {
                attributes: { name: "wlan2", master: "bridge1" },
            });
            await capsman.interface.set("*7", { master: "bridge2" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/interface/set", {
                attributes: { ".id": "*7", master: "bridge2" },
            });
            await capsman.interface.remove("*7");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/interface/remove", {
                attributes: { ".id": "*7" },
            });
        });
    });

    describe("manager", () => {
        it("lists manager interfaces", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawManager);
            const capsman = createCapsManHelpers(client);
            const mgrs = await capsman.manager.list();
            expect(mgrs).toHaveLength(1);
            expect(mgrs[0]).toMatchObject({
                ".id": "*9",
                interface: "bridge-mgmt",
                "use-up-interface": true,
                "up-interface-expiry": "1m",
            });
        });

        it("CRUD operations use correct paths", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.manager.add({ interface: "ether1" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/manager/add", {
                attributes: { interface: "ether1" },
            });
            await capsman.manager.set("*9", { "use-up-interface": "no" });
            expect(client.execute).toHaveBeenCalledWith("/caps-man/manager/set", {
                attributes: { ".id": "*9", "use-up-interface": "no" },
            });
            await capsman.manager.remove("*9");
            expect(client.execute).toHaveBeenCalledWith("/caps-man/manager/remove", {
                attributes: { ".id": "*9" },
            });
        });
    });

    describe("registration", () => {
        it("lists registration entries", async () => {
            const client = createMockTransport();
            client.print.mockResolvedValueOnce(rawRegistration);
            const capsman = createCapsManHelpers(client);
            const regs = await capsman.registration.list();
            expect(regs).toHaveLength(1);
            expect(regs[0]).toMatchObject({
                ".id": "*8",
                address: "192.168.88.1",
                "mac-address": "AA:BB:CC:DD:EE:FF",
                version: "v7.15",
                board: "RB5009UG+S+IN",
                "managed-by": "office-5ghz",
                "cap-version": "7.15",
            });
        });

        it("registration only has list method", () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            expect(typeof capsman.registration.list).toBe("function");
            expect((capsman.registration as any).add).toBeUndefined();
            expect((capsman.registration as any).set).toBeUndefined();
            expect((capsman.registration as any).remove).toBeUndefined();
        });
    });

    describe("print options", () => {
        it("passes proplist", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.list({ proplist: ["name", "ssid"] });
            expect(client.print).toHaveBeenCalledWith(
                "/caps-man/configuration",
                expect.objectContaining({ attributes: { ".proplist": ["name", "ssid"] } })
            );
        });

        it("passes queries", async () => {
            const client = createMockTransport();
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.list({ queries: ["name=office*"] });
            expect(client.print).toHaveBeenCalledWith(
                "/caps-man/configuration",
                expect.objectContaining({ queries: ["name=office*"] })
            );
        });

        it("passes signal and timeout", async () => {
            const client = createMockTransport();
            const signal = new AbortController().signal;
            const capsman = createCapsManHelpers(client);
            await capsman.configuration.list({ signal, timeoutMs: 5000 });
            expect(client.print).toHaveBeenCalledWith(
                "/caps-man/configuration",
                expect.objectContaining({ signal, timeoutMs: 5000 })
            );
        });
    });
});
