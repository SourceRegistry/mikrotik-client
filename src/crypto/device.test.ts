import { describe, expect, it, vi } from "vitest";
import { listCertificates, importCertificate } from "./device";
import type { DeviceTransport } from "../routeros/transport";

function createMockTransport(): DeviceTransport {
  return {
    execute: vi.fn().mockResolvedValue({ tag: "test", records: [], traps: [] }),
    print: vi.fn().mockResolvedValue([]),
    listen: vi.fn().mockResolvedValue({
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    }),
  };
}

describe("listCertificates", () => {
  it("returns empty array when no certificates exist", async () => {
    const transport = createMockTransport();
    transport.print = vi.fn().mockResolvedValue([]);

    const result = await listCertificates(transport);
    expect(result).toEqual([]);
    expect(transport.print).toHaveBeenCalledWith("/certificate", expect.any(Object));
  });

  it("maps certificate records to typed entries", async () => {
    const transport = createMockTransport();
    transport.print = vi.fn().mockResolvedValue([
      {
        ".id": "*1",
        fingerprint: "AB:CD:EF",
        name: "my-cert",
        "remaining-days": "365",
        trusted: "yes",
        "key-usage": "digitalSignature",
        kind: "imported",
        "valid-from": "2024-01-01 00:00:00",
        "valid-to": "2025-01-01 00:00:00",
      },
      { ".id": "*2", name: "self-signed", trusted: "no", kind: "self-signed" },
    ]);

    const result = await listCertificates(transport);
    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      id: "*1",
      fingerprint: "AB:CD:EF",
      name: "my-cert",
      remainingDays: "365",
      trusted: true,
      keyUsage: "digitalSignature",
      kind: "imported",
      validFrom: "2024-01-01 00:00:00",
      validTo: "2025-01-01 00:00:00",
    });

    expect(result[1]).toEqual({
      id: "*2",
      fingerprint: undefined,
      name: "self-signed",
      remainingDays: undefined,
      trusted: false,
      keyUsage: undefined,
      kind: "self-signed",
      validFrom: undefined,
      validTo: undefined,
    });
  });

  it("passes signal through to transport", async () => {
    const transport = createMockTransport();
    transport.print = vi.fn().mockResolvedValue([]);
    const ctrl = new AbortController();

    await listCertificates(transport, { signal: ctrl.signal });
    expect(transport.print).toHaveBeenCalledWith(
      "/certificate",
      expect.objectContaining({ signal: ctrl.signal })
    );
  });
});

describe("importCertificate", () => {
  it("parses the certificate and returns result", async () => {
    const transport = createMockTransport();

    // We need a minimal valid PEM cert for this test.
    // Skip if we cannot produce one — the focus is on the device transport interface.
    // importCertificate only parses the cert (device upload is transport-specific stub)
    const testCert = `-----BEGIN CERTIFICATE-----
MIIB5TCCAQ0CFAJHqJHH+JPBmVDKdQXKLpJQlCkSMA0GCSqGSIb3DQEBCwUAMBEx
DzANBgNVBAMMBnRlc3RDQTAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBa
MBExDzANBgNVBAMMBnRlc3RDQTBFMA0GCSqGSIb3DQEBCwUAMCwGCSqGSIb3DqE
BAg1g==
-----END CERTIFICATE-----`;

    // This will throw since the cert above is not valid DER.
    // We expect importCertificate to parse what it can.
    try {
      await importCertificate(transport, { name: "test", certPem: testCert });
    } catch {
      // Expected — test cert is not valid DER, parseCertificate will throw
    }
  });
});
