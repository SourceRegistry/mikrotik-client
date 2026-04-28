import { describe, it, expect } from "vitest";
import {
    INTERFACE_KINDS,
    CERTS_KINDS,
    FIREWALL_FILTER_CHAINS,
    FIREWALL_FILTER_ACTIONS,
    parseInterfaceDiscriminated,
    type RouterOSInterfaceKind,
    type RouterOSInterfaceDiscriminated,
} from "./helpers";

describe("enum const arrays", () => {
    it("INTERFACE_KINDS contains expected values", () => {
        expect(INTERFACE_KINDS).toContain("ether");
        expect(INTERFACE_KINDS).toContain("bridge");
        expect(INTERFACE_KINDS).toContain("wireguard");
        expect(INTERFACE_KINDS).toContain("wifi");
        expect(INTERFACE_KINDS.length).toBeGreaterThan(50);
    });

    it("CERTS_KINDS contains expected values", () => {
        expect(CERTS_KINDS).toContain("imported");
        expect(CERTS_KINDS).toContain("rsasign");
        expect(CERTS_KINDS).toContain("ecsign");
        expect(CERTS_KINDS).toContain("ed25519sign");
        expect(CERTS_KINDS).toContain("unknown");
    });

    it("FIREWALL_FILTER_CHAINS contains expected values", () => {
        expect(FIREWALL_FILTER_CHAINS).toContain("forward");
        expect(FIREWALL_FILTER_CHAINS).toContain("input");
        expect(FIREWALL_FILTER_CHAINS).toContain("output");
    });

    it("FIREWALL_FILTER_ACTIONS contains expected values", () => {
        expect(FIREWALL_FILTER_ACTIONS).toContain("accept");
        expect(FIREWALL_FILTER_ACTIONS).toContain("drop");
        expect(FIREWALL_FILTER_ACTIONS).toContain("reject");
    });
});

describe("parseInterfaceDiscriminated", () => {
    it("returns kind='known' for recognized interface types", () => {
        const raw = { ".id": "*1", name: "ether1", type: "ether", disabled: "no" };
        const result = parseInterfaceDiscriminated(raw);
        expect(result.kind).toBe("known");
        expect(result.type).toBe("ether");
    });

    it.each(["bridge", "wireguard", "wifi", "vlan", "veth", "bonding", "pppoe-client"])(
        "returns kind='known' for type '%s'",
        (type) => {
            const raw = { ".id": "*1", name: "test", type };
            const result = parseInterfaceDiscriminated(raw);
            expect(result.kind).toBe("known");
            expect(result.type).toBe(type);
        }
    );

    it("returns kind='unknown' for unrecognized interface types", () => {
        const raw = { ".id": "*1", name: "custom1", type: "unknown-device-type" };
        const result = parseInterfaceDiscriminated(raw);
        expect(result.kind).toBe("unknown");
        expect(result.type).toBe("unknown-device-type");
    });

    it("returns kind='unknown' when type is missing", () => {
        const raw = { ".id": "*1", name: "test" };
        const result = parseInterfaceDiscriminated(raw);
        expect(result.kind).toBe("unknown");
        expect(result.type).toBeUndefined();
    });

    it("returns kind='unknown' when type is empty string", () => {
        const raw = { ".id": "*1", name: "test", type: "" };
        const result = parseInterfaceDiscriminated(raw);
        expect(result.kind).toBe("unknown");
    });

    it("preserves parsed fields (running, disabled, mtu) in known case", () => {
        const raw = {
            ".id": "*1",
            name: "ether1",
            type: "ether",
            running: "yes",
            disabled: "no",
            mtu: "1500",
        };
        const result = parseInterfaceDiscriminated(raw);
        expect(result.kind).toBe("known");
        expect(result.running).toBe(true);
        expect(result.disabled).toBe(false);
        expect(result.mtu).toBe(1500);
    });

    it("preserves parsed fields in unknown case", () => {
        const raw = {
            ".id": "*2",
            name: "custom1",
            type: "custom-type",
            running: "yes",
            disabled: "yes",
        };
        const result = parseInterfaceDiscriminated(raw);
        expect(result.kind).toBe("unknown");
        expect(result.running).toBe(true);
        expect(result.disabled).toBe(true);
    });

    it("can be narrowed via discriminated union check", () => {
        const raw = { ".id": "*1", name: "ether1", type: "ether", disabled: "no" };
        const result: RouterOSInterfaceDiscriminated = parseInterfaceDiscriminated(raw);

        if (result.kind === "known") {
            // Type should narrow to RouterOSInterfaceKnown
            const _type: RouterOSInterfaceKind = result.type;
            expect(_type).toBe("ether");
        } else {
            throw new Error("Expected kind to be 'known'");
        }
    });
});
