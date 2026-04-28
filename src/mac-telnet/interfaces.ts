import os from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Address family types for network interfaces.
 */
export type AddressFamily = "ipv4" | "ipv6";

/**
 * A network interface address entry.
 */
export interface NetworkInterfaceAddress {
    /** IP address (e.g., "192.168.88.1" or "fe80::1"). */
    address: string;
    /** IPv4 or IPv6. */
    family: AddressFamily;
    /** Network mask in CIDR notation (e.g., "255.255.255.0" or "ffff:ffff:ffff:ffff::"). */
    netmask: string;
    /** Whether the interface is up. */
    internal: boolean;
    /** MAC address of the interface. */
    mac: string;
}

/**
 * A local network interface suitable for MAC-Telnet communication.
 */
export interface NetworkInterface {
    /** Interface name (e.g., "en0", "eth0", "Wi-Fi"). */
    name: string;
    /** Interface type (e.g., "en0", "eth0"). */
    type: string;
    /** MAC address of the interface. */
    mac: string;
    /** List of IP addresses configured on this interface. */
    addresses: NetworkInterfaceAddress[];
    /** Whether the interface is currently up (has non-internal addresses). */
    isUp: boolean;
}

// ── Interface Enumeration ────────────────────────────────────────────────────

/**
 * Enumerate all local network interfaces.
 *
 * Filters out loopback and internal-only interfaces by default.
 *
 * @returns List of network interfaces suitable for MAC-Telnet.
 *
 * @example
 * ```ts
 * const interfaces = listNetworkInterfaces();
 * const wifi = interfaces.find((i) => i.name === "en0");
 * ```
 */
export function listNetworkInterfaces(): NetworkInterface[] {
    const rawInterfaces = os.networkInterfaces();
    const result: NetworkInterface[] = [];

    for (const [name, addrs] of Object.entries(rawInterfaces)) {
        if (!addrs || addrs.length === 0) continue;

        const addresses: NetworkInterfaceAddress[] = addrs.map((addr) => ({
            address: addr.address,
            family: addr.family as AddressFamily,
            netmask: addr.netmask ?? "",
            internal: addr.internal,
            mac: addr.mac,
        }));

        // Skip loopback interfaces
        if (name.includes("lo") || name.includes("Loopback")) continue;

        const isUp = addresses.some((a) => !a.internal);
        const mac = addresses.find((a) => a.mac && a.mac !== "00:00:00:00:00:00")?.mac ?? "unknown";

        result.push({
            name,
            type: name,
            mac,
            addresses,
            isUp,
        });
    }

    return result;
}

/**
 * Find a network interface by name.
 *
 * @param name - Interface name (e.g., "en0", "eth0").
 * @returns The interface, or undefined if not found.
 *
 * @example
 * ```ts
 * const eth0 = findInterface("eth0");
 * if (!eth0) throw new Error("Interface eth0 not found");
 * ```
 */
export function findInterface(name: string): NetworkInterface | undefined {
    return listNetworkInterfaces().find((iface) => iface.name === name);
}

/**
 * List only active (up, non-internal) interfaces with a valid MAC address.
 *
 * @returns List of interfaces suitable for MAC-Telnet communication.
 *
 * @example
 * ```ts
 * const active = listActiveInterfaces();
 * console.log("Active interfaces:", active.map((i) => i.name));
 * ```
 */
export function listActiveInterfaces(): NetworkInterface[] {
    return listNetworkInterfaces().filter(
        (iface) => iface.isUp && iface.mac !== "unknown" && iface.mac !== "00:00:00:00:00:00"
    );
}

/**
 * Validate that an interface name exists and is active.
 *
 * @param name - Interface name to validate.
 * @returns The interface if valid.
 * @throws If the interface is not found or is not active.
 *
 * @example
 * ```ts
 * const iface = validateInterface("en0");
 * console.log(`Using interface ${iface.name} (${iface.mac})`);
 * ```
 */
export function validateInterface(name: string): NetworkInterface {
    const iface = findInterface(name);
    if (!iface) {
        throw new Error(`Interface "${name}" not found`);
    }
    if (!iface.isUp) {
        throw new Error(`Interface "${name}" is not up`);
    }
    if (iface.mac === "unknown") {
        throw new Error(`Interface "${name}" has no valid MAC address`);
    }
    return iface;
}
