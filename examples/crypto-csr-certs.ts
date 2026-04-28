/**
 * Crypto helpers example.
 *
 * Demonstrates CSR (Certificate Signing Request) generation, X.509 certificate
 * parsing, and device certificate listing.
 *
 * CSR generation and cert parsing are SELF-CONTAINED — no device needed.
 * Certificate listing requires a live device connection.
 */

import { generateCsr, parseCertificate, listCertificates } from "../src/crypto";
import { RouterOSClient } from "../src/routeros";

async function main() {
    // ── Step 1: Generate a CSR (RSA) ──────────────────────────────────
    console.log("=== Step 1: Generate RSA CSR ===\n");

    const rsaCsr = generateCsr({
        commonName: "router.site-a.local",
        sans: ["router1.site-a.local", "192.168.88.1"],
        countryName: "NL",
        organizationName: "Example Corp",
        keyType: "rsa",
        keySize: 2048,
    });

    console.log(`CSR for: ${rsaCsr.commonName}`);
    console.log(`SANs: ${rsaCsr.sans.join(", ")}`);
    console.log(`Key type: RSA ${rsaCsr.keyPem.split("\n")[0]}`);
    console.log(`CSR (first 100 chars): ${rsaCsr.csrPem.slice(0, 100)}...\n`);

    // ── Step 2: Generate a CSR (ECDSA) ────────────────────────────────
    console.log("=== Step 2: Generate ECDSA CSR ===\n");

    const ecdsaCsr = generateCsr({
        commonName: "router.site-b.local",
        sans: ["router2.site-b.local", "10.0.0.1"],
        keyType: "ecdsa",
        namedCurve: "P-256",
    });

    console.log(`CSR for: ${ecdsaCsr.commonName}`);
    console.log(`Key type: ECDSA P-256`);
    console.log(`CSR (first 100 chars): ${ecdsaCsr.csrPem.slice(0, 100)}...\n`);

    // ── Step 3: Parse a certificate ───────────────────────────────────
    console.log("=== Step 3: Parse Certificate ===\n");

    // Self-signed cert for demonstration (generated from CSR + signed with own key)
    // In production, you'd receive this from your CA
    const sampleCert = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJALRBmGlC7L+EMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnJv
dXRlcjAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBaMBExDzANBgNVBAMM
BnJvdXRlcjBcMA0GCSqGSIb3DQEBAQUAA0sAMEgCQQC6wU4F+4kPRLMZ5R0S2yGq
CMrPBWBLmJkO5YtqhODSklYhU8LWdQHMDMUz4vFNiYUqMFSqMvKEENqyL3+hQ2Az
AgMBAAGjUzBRMB0GA1UdDgQWBBRBcInKZ0q8l2FjHqNuGMPyPfJR7zAfBgNVHSME
GDAWgBQBcInKZ0q8l2FjHqNuGMPyPfJR7zAPBgNVHRMBAf8EBTADAQH/MA0GCSqG
SIb3DQEBCwUAA0EAjSs0lBqMPiZnPYMUZ5JkNGGEBQFFDWrrGwr6EFgXPkp8RJ/C
6aKRv0Ej8tFetMFfRYrFP+lJT8KZ4MtlS9g2lg==
-----END CERTIFICATE-----`;

    try {
        const parsed = parseCertificate(sampleCert);
        console.log(`Subject: ${parsed.subject}`);
        console.log(`Issuer: ${parsed.issuer}`);
        console.log(`Serial: ${parsed.serialNumber}`);
        console.log(`Valid: ${parsed.validFrom} → ${parsed.validTo}`);
        console.log(`Fingerprint (SHA-256): ${parsed.fingerprint256}`);
        console.log(`SANs: ${parsed.subjectAltNames.join(", ") || "(none)"}`);
        console.log(`Key: ${parsed.publicKeySize}`);
    } catch (err) {
        console.log("Note: sample cert parsing may fail depending on format.");
        console.log("Use a real PEM certificate for testing.");
    }

    // ── Step 4: List device certificates (requires connection) ─────
    console.log("\n=== Step 4: Device Certificates ===\n");

    const host = process.env.MIKROTIK_HOST;
    if (!host) {
        console.log("Set MIKROTIK_HOST to list device certificates.");
        console.log("Skipping device connection.\n");
        return;
    }

    const client = new RouterOSClient({
        host,
        username: process.env.MIKROTIK_USERNAME ?? "admin",
        password: process.env.MIKROTIK_PASSWORD ?? "",
        tls: process.env.MIKROTIK_TLS === "true",
        ...(process.env.MIKROTIK_PORT ? { port: Number(process.env.MIKROTIK_PORT) } : {}),
    });

    try {
        const certs = await listCertificates(client);
        console.log(`Found ${certs.length} certificate(s) on device:\n`);

        for (const cert of certs) {
            console.log(`  Name: ${cert.name ?? "(unnamed)"}`);
            console.log(`  Fingerprint: ${cert.fingerprint ?? "?"}`);
            console.log(`  Kind: ${cert.kind ?? "?"}`);
            console.log(`  Trusted: ${cert.trusted ?? "?"}`);
            console.log(
                `  Expires: ${cert.remainingDays !== undefined ? `${cert.remainingDays}d remaining` : "?"}`
            );
            console.log("");
        }
    } finally {
        await client.close();
    }

    console.log("Done.");
}

void main();
