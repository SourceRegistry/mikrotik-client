import { X509Certificate } from 'node:crypto';

// ---------------------------------------------------------------------------
// Parsed certificate structure
// ---------------------------------------------------------------------------

/**
 * Parsed X.509 certificate fields.
 */
export type ParsedCert = {
    /** Subject distinguished name (pretty-printed). */
    subject: string;
    /** Issuer distinguished name (pretty-printed). */
    issuer: string;
    /** Certificate serial number (hex). */
    serialNumber: string;
    /** Not valid before (UTC). */
    validFrom: string;
    /** Not valid after (UTC). */
    validTo: string;
    /** SHA-256 fingerprint (hex, colon-separated). */
    fingerprint256: string;
    /** SHA-512 fingerprint (hex, colon-separated). */
    fingerprint512: string;
    /** Subject Alternative Names (dNSName + iPAddress). */
    subjectAltNames: string[];
    /** Key usage flags (from X509Certificate.keyUsage). */
    keyUsage: string[];
    /** Public key size in bits (RSA) or curve name (ECDSA). */
    publicKeySize: string;
    /** Raw PEM text. */
    pem: string;
};

/**
 * Parse a PEM-encoded X.509 certificate into a structured object.
 *
 * Uses Node's built-in `X509Certificate` (available since v17.4) — no external
 * dependencies.
 *
 * @example
 * ```ts
 * import { parseCertificate } from '@sourceregistry/mikrotik-client/crypto';
 *
 * const cert = parseCertificate(pemText);
 * console.log(cert.subject, cert.fingerprint256);
 * ```
 */
export function parseCertificate(pem: string): ParsedCert {
    const cert = new X509Certificate(pem);

    // X509Certificate.keyUsage returns string[] | undefined depending on Node version
    // and whether the extension is present. Normalise to [] when absent.
    const keyUsageList: string[] = (cert.keyUsage as string[] | undefined) ?? [];

    // Extract key size from asymmetricKeyDetails on the KeyObject
    const details = cert.publicKey.asymmetricKeyDetails;
    const keySize = details?.modulusLength
        ? String(details.modulusLength)
        : details?.namedCurve
            ? details.namedCurve
            : 'unknown';

    return {
        subject: cert.subject,
        issuer: cert.issuer,
        serialNumber: cert.serialNumber,
        validFrom: cert.validFrom,
        validTo: cert.validTo,
        fingerprint256: cert.fingerprint256,
        fingerprint512: cert.fingerprint512,
        subjectAltNames:
            cert.subjectAltName?.split(', ').map((s) => s.trim()) ?? [],
        keyUsage: keyUsageList,
        publicKeySize: keySize,
        pem,
    };
}
