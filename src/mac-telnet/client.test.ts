import { describe, it, expect, vi, beforeEach } from "vitest";
import { MACTELNET_PORT } from "./packet";

// Mock crypto module - vi.mock is hoisted to top of file
vi.mock("node:crypto", () => ({
    createECDH: vi.fn(() => ({
        generateKeys: vi.fn(),
        getPublicKey: vi.fn(() => new Uint8Array(65).fill(0)),
        computeSecret: vi.fn(() => new Uint8Array(32).fill(1)),
    })),
    createHash: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn(() => new Uint8Array(16)),
    })),
    createHmac: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        digest: vi.fn(() => new Uint8Array(32)),
    })),
}));

// Mock dgram module
vi.mock("node:dgram", () => ({
    default: {
        createSocket: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            send: vi.fn((_buf, _port, _addr, cb) => cb(null)),
            bind: vi.fn().mockReturnThis(),
            close: vi.fn(),
        })),
    },
}));

// Mock interfaces module
vi.mock("./interfaces", () => ({
    validateInterface: vi.fn((name: string) => {
        if (name === "en0") {
            return { name: "en0", mac: "aa:bb:cc:dd:ee:ff", isUp: true, type: "en0", addresses: [] };
        }
        throw new Error(`Interface "${name}" not found`);
    }),
    listActiveInterfaces: vi.fn(() => [
        { name: "en0", mac: "aa:bb:cc:dd:ee:ff", isUp: true, type: "en0", addresses: [] },
    ]),
}));

// Dynamic import to get fresh mocks each test
async function importClient() {
    const mod = await import("./client");
    return mod.MacTelnetClient;
}

describe("MacTelnetClient", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("constructor", () => {
        it("creates client with required config", async () => {
            const MacTelnetClientCls = await importClient();
            const client = new MacTelnetClientCls({
                targetMac: "aa:bb:cc:dd:ee:ff",
                username: "admin",
                password: "password",
            });

            expect(client.targetMac).toBe("aa:bb:cc:dd:ee:ff");
            expect(client.username).toBe("admin");
            expect(client.authType).toBe("ec-srp");
            expect(client.timeoutMs).toBe(5000);
            expect(client.maxRetries).toBe(3);
        });

        it("accepts custom timeout", async () => {
            const MacTelnetClientCls = await importClient();
            const client = new MacTelnetClientCls({
                targetMac: "aa:bb:cc:dd:ee:ff",
                username: "admin",
                password: "password",
                timeoutMs: 10000,
            });

            expect(client.timeoutMs).toBe(10000);
        });

        it("accepts MD5 auth type", async () => {
            const MacTelnetClientCls = await importClient();
            const client = new MacTelnetClientCls({
                targetMac: "aa:bb:cc:dd:ee:ff",
                username: "admin",
                password: "password",
                authType: "md5",
            });

            expect(client.authType).toBe("md5");
        });
    });

    describe("state validation", () => {
        it("throws when sending command before connect", async () => {
            const MacTelnetClientCls = await importClient();
            const client = new MacTelnetClientCls({
                targetMac: "aa:bb:cc:dd:ee:ff",
                username: "admin",
                password: "password",
            });

            await expect(client.sendCommand("/test")).rejects.toThrow(/Not connected/);
        });

        it("allows disconnect when already disconnected", async () => {
            const MacTelnetClientCls = await importClient();
            const client = new MacTelnetClientCls({
                targetMac: "aa:bb:cc:dd:ee:ff",
                username: "admin",
                password: "password",
            });

            // Should not throw
            await client.disconnect();
        });
    });

    describe("destroy", () => {
        it("sets destroyed flag", async () => {
            const MacTelnetClientCls = await importClient();
            const client = new MacTelnetClientCls({
                targetMac: "aa:bb:cc:dd:ee:ff",
                username: "admin",
                password: "password",
            });

            client.destroy();

            // Verify destroyed state
            const destroyed = (client as any).destroyed;
            expect(destroyed).toBe(true);

            // Should throw on connect after destroy
            await expect(client.connect()).rejects.toThrow(/destroyed/);
        });
    });
});

describe("MACTELNET_PORT constant", () => {
    it("equals 20561", () => {
        expect(MACTELNET_PORT).toBe(20561);
    });
});

describe("MacTelnetClient interface wiring", () => {
    it("stores interfaceName from config", async () => {
        const MacTelnetClientCls = await importClient();
        const client = new MacTelnetClientCls({
            targetMac: "aa:bb:cc:dd:ee:ff",
            username: "admin",
            password: "password",
            interfaceName: "en0",
        });
        expect(client.interfaceName).toBe("en0");
    });

    it("defaults interfaceName to undefined when not set", async () => {
        const MacTelnetClientCls = await importClient();
        const client = new MacTelnetClientCls({
            targetMac: "aa:bb:cc:dd:ee:ff",
            username: "admin",
            password: "password",
        });
        expect(client.interfaceName).toBeUndefined();
    });

    it("sourceMac starts as zero MAC before connect", async () => {
        const MacTelnetClientCls = await importClient();
        const client = new MacTelnetClientCls({
            targetMac: "aa:bb:cc:dd:ee:ff",
            username: "admin",
            password: "password",
            interfaceName: "en0",
        });
        const mac = (client as any).sourceMac as Uint8Array;
        expect(Array.from(mac)).toEqual([0, 0, 0, 0, 0, 0]);
    });
});

describe("MacTelnetClient keep-alive config", () => {
    it("defaults keepAliveIntervalMs to 1000", async () => {
        const MacTelnetClientCls = await importClient();
        const client = new MacTelnetClientCls({
            targetMac: "aa:bb:cc:dd:ee:ff",
            username: "admin",
            password: "password",
        });
        expect(client.keepAliveIntervalMs).toBe(1000);
    });

    it("accepts custom keepAliveIntervalMs", async () => {
        const MacTelnetClientCls = await importClient();
        const client = new MacTelnetClientCls({
            targetMac: "aa:bb:cc:dd:ee:ff",
            username: "admin",
            password: "password",
            keepAliveIntervalMs: 5000,
        });
        expect(client.keepAliveIntervalMs).toBe(5000);
    });

    it("keepAliveTimer is null before connect", async () => {
        const MacTelnetClientCls = await importClient();
        const client = new MacTelnetClientCls({
            targetMac: "aa:bb:cc:dd:ee:ff",
            username: "admin",
            password: "password",
        });
        expect((client as any).keepAliveTimer).toBeNull();
    });
});
