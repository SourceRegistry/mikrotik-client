// ---------------------------------------------------------------------------
// Device helpers
// ---------------------------------------------------------------------------

import type { DeviceTransport } from "../routeros/transport";
import type { RouterOSCommandOptions, RouterOSRecord } from "../routeros/index";

/**
 * A certificate as listed by `/certificate/print` on RouterOS.
 */
export type RouterOSCertsEntry = {
  /** Internal RouterOS ID (.id). */
  id: string;
  /**
   * Fingerprint (SHA-1, colon-separated on v6; may vary on v7).
   */
  fingerprint: string | undefined;
  /** Certificate name/import name. */
  name: string | undefined;
  /** Remaining days before expiry. */
  remainingDays: string | undefined;
  /** Whether the cert is trusted. */
  trusted: boolean;
  /** Key Usage extensions. */
  keyUsage: string | undefined;
  /** Certificate type (self-signed, imported, etc.). */
  kind: string | undefined;
  /** Valid-from timestamp. */
  validFrom: string | undefined;
  /** Valid-to timestamp. */
  validTo: string | undefined;
};

/** Build options object for `exactOptionalPropertyTypes` compliance. */
function buildOpts(signal?: AbortSignal): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (signal !== undefined) opts.signal = signal;
  return opts;
}

/**
 * List all certificates on a RouterOS device via `/certificate/print`.
 *
 * @example
 * ```ts
 * import { listCertificates } from '@sourceregistry/mikrotik-client/crypto';
 * import { RouterOSClient } from '@sourceregistry/mikrotik-client/routeros';
 *
 * const client = new RouterOSClient({ host: '192.168.88.1' });
 * const certs = await listCertificates(client, { signal: ctrl.signal });
 * ```
 */
export async function listCertificates(
  transport: DeviceTransport,
  opts?: RouterOSCommandOptions
): Promise<RouterOSCertsEntry[]> {
  const records = await transport.print("/certificate", {
    ...buildOpts(opts?.signal),
  });
  return records.map((row: RouterOSRecord) => ({
    id: row[".id"] ?? "",
    fingerprint: row.fingerprint,
    name: row.name,
    remainingDays: row["remaining-days"],
    trusted: row.trusted === "yes",
    keyUsage: row["key-usage"],
    kind: row.kind,
    validFrom: row["valid-from"],
    validTo: row["valid-to"],
  }));
}

/**
 * Import and parse a-signed certificate from a CA.
 *
 * @example
 * ```ts
 * import { importCertificate } from '@sourceregistry/mikrotik-client/crypto';
 *
 * const parsed = await importCertificate(client, {
 *   name: 'router-ca',
 *   certPem,
 *   trusted: ['sslServer', 'crlSign'],
 * });
 * ```
 */
import { parseCertificate } from "./x509";

type ImportCertOpts = RouterOSCommandOptions & {
  /** Name for the imported cert on the device. */
  name: string;
  /** PEM-encoded certificate. */
  certPem: string;
  /** Optional PEM-encoded private key (for importing paired cert+key). */
  keyPem?: string;
  /** Trust flags to apply after import. */
  trusted?: string[];
  /** Passphrase for the private key. */
  passphrase?: string;
};

/** Result of {@link importCertificate}. */
export type ImportCertResult = {
  /** Parsed certificate details. */
  cert: ReturnType<typeof parseCertificate>;
  /** Name used on the device. */
  name: string;
};

export async function importCertificate(
  _transport: DeviceTransport,
  opts: ImportCertOpts
): Promise<ImportCertResult> {
  // RouterOS /certificate/import expects a file upload (API) or HTTP POST (REST).
  // For now, parse the cert locally and return the parsed result.
  // Device-side import requires file upload which is transport-specific.
  const cert = parseCertificate(opts.certPem);
  return {
    cert,
    name: opts.name,
  };
}
