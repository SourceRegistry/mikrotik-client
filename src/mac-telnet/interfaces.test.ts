import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    listNetworkInterfaces,
    findInterface,
    listActiveInterfaces,
    validateInterface,
} from "./interfaces";

// Mock os.networkInterfaces - vi.mock is hoisted to top of file
vi.mock("node:os", () => ({
    default: {
        networkInterfaces: vi.fn(),
    },
}));

// Get the mocked function after imports
import os from "node:os";

// Helper to set mock return value
function setMockInterfaces(mockData: Record<string, os.NetworkInterfaceInfo[]>) {
    (os.networkInterfaces as vi.Mock).mockReturnValue(mockData);
}

describe("listNetworkInterfaces", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns list of non-loopback interfaces", () => {
        setMockInterfaces({
            lo0: [
                {
                    address: "127.0.0.1",
                    family: "ipv4",
                    netmask: "255.0.0.0",
                    mac: "00:00:00:00:00:00",
                    internal: true,
                },
            ],
            en0: [
                {
                    address: "192.168.1.100",
                    family: "ipv4",
                    netmask: "255.255.255.0",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                },
            ],
        });

        const ifaces = listNetworkInterfaces();

        expect(ifaces).toHaveLength(1);
        expect(ifaces[0].name).toBe("en0");
        expect(ifaces[0].mac).toBe("aa:bb:cc:dd:ee:ff");
        expect(ifaces[0].isUp).toBe(true);
    });

    it("skips loopback interfaces", () => {
        setMockInterfaces({
            lo0: [{ address: "127.0.0.1", family: "ipv4", netmask: "255.0.0.0", mac: "00:00:00:00:00:00", internal: true }],
            Loopback: [{ address: "::1", family: "ipv6", netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", internal: true }],
        });

        const ifaces = listNetworkInterfaces();

        expect(ifaces).toHaveLength(0);
    });

    it("marks interface as up when it has non-internal addresses", () => {
        setMockInterfaces({
            eth0: [
                {
                    address: "10.0.0.5",
                    family: "ipv4",
                    netmask: "255.255.255.0",
                    mac: "11:22:33:44:55:66",
                    internal: false,
                },
            ],
        });

        const ifaces = listNetworkInterfaces();

        expect(ifaces[0].isUp).toBe(true);
    });

    it("marks interface as down when all addresses are internal", () => {
        setMockInterfaces({
            dummy0: [
                {
                    address: "169.254.0.1",
                    family: "ipv4",
                    netmask: "255.255.0.0",
                    mac: "aa:bb:cc:dd:ee:00",
                    internal: true,
                },
            ],
        });

        const ifaces = listNetworkInterfaces();

        expect(ifaces[0].isUp).toBe(false);
    });
});

describe("findInterface", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("finds interface by name", () => {
        setMockInterfaces({
            en0: [
                {
                    address: "192.168.1.1",
                    family: "ipv4",
                    netmask: "255.255.255.0",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                },
            ],
        });

        const iface = findInterface("en0");

        expect(iface).toBeDefined();
        expect(iface?.name).toBe("en0");
    });

    it("returns undefined for non-existent interface", () => {
        setMockInterfaces({});

        const iface = findInterface("nonexistent");

        expect(iface).toBeUndefined();
    });
});

describe("listActiveInterfaces", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns only interfaces with valid MAC and up status", () => {
        setMockInterfaces({
            en0: [
                {
                    address: "192.168.1.1",
                    family: "ipv4",
                    netmask: "255.255.255.0",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                },
            ],
            dummy0: [
                {
                    address: "169.254.0.1",
                    family: "ipv4",
                    netmask: "255.255.0.0",
                    mac: "00:00:00:00:00:00",
                    internal: false,
                },
            ],
        });

        const active = listActiveInterfaces();

        expect(active).toHaveLength(1);
        expect(active[0].name).toBe("en0");
    });
});

describe("validateInterface", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns interface when valid", () => {
        setMockInterfaces({
            en0: [
                {
                    address: "192.168.1.1",
                    family: "ipv4",
                    netmask: "255.255.255.0",
                    mac: "aa:bb:cc:dd:ee:ff",
                    internal: false,
                },
            ],
        });

        const iface = validateInterface("en0");

        expect(iface.name).toBe("en0");
    });

    it("throws when interface not found", () => {
        setMockInterfaces({});

        expect(() => validateInterface("nonexistent")).toThrow(/not found/);
    });

    it("throws when interface is not up", () => {
        setMockInterfaces({
            dummy0: [
                {
                    address: "169.254.0.1",
                    family: "ipv4",
                    netmask: "255.255.0.0",
                    mac: "aa:bb:cc:dd:ee:00",
                    internal: true,
                },
            ],
        });

        expect(() => validateInterface("dummy0")).toThrow(/not up/);
    });

    it("throws when interface has no valid MAC", () => {
        setMockInterfaces({
            unknown0: [
                {
                    address: "10.0.0.1",
                    family: "ipv4",
                    netmask: "255.255.255.0",
                    mac: "",
                    internal: false,
                },
            ],
        });

        expect(() => validateInterface("unknown0")).toThrow(/MAC address/);
    });
});
