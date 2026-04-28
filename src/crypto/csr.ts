import { generateKeyPairSync, sign } from "node:crypto";

// ---------------------------------------------------------------------------
// Minimal ASN.1 DER encoding helpers
// ---------------------------------------------------------------------------

function bigIntToBytes(value: bigint | number): Buffer {
  if (typeof value === "number") value = BigInt(value);
  if (value === 0n) return Buffer.from([0]);
  const hex = value.toString(16);
  return Buffer.from(hex.padStart(hex.length + (hex.length % 2 ? 1 : 0), "0"), "hex");
}

function derLength(length: number): Buffer {
  if (length < 128) return Buffer.from([length]);
  const hex = length.toString(16).padStart(2, "0");
  const bytes = hex.length / 2;
  return Buffer.concat([Buffer.from([0x80 | bytes]), Buffer.from(hex, "hex")]);
}

function derWrap(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derInteger(value: bigint | number): Buffer {
  const bytes = bigIntToBytes(value);
  const first = bytes[0];
  const content =
    first !== undefined && first & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  return derWrap(0x02, content);
}

function derOctetString(bytes: Buffer): Buffer {
  return derWrap(0x04, bytes);
}

function derBitString(bytes: Buffer): Buffer {
  return derWrap(0x03, Buffer.concat([Buffer.from([0]), bytes]));
}

function derNull(): Buffer {
  return derWrap(0x05, Buffer.alloc(0));
}

function derOid(components: number[]): Buffer {
  if (components.length < 2) throw new Error("OID needs at least 2 components");
  const c0 = components[0];
  const c1 = components[1];
  const encoded: number[] = [40 * (c0 ?? 0) + (c1 ?? 0)];
  for (let i = 2; i < components.length; i++) {
    const c = components[i] ?? 0;
    if (c < 128) {
      encoded.push(c);
    } else {
      const chunks: number[] = [c & 0x7f];
      let v = c >>> 7;
      while (v > 0) {
        chunks.unshift((v & 0x7f) | 0x80);
        v >>>= 7;
      }
      encoded.push(...chunks);
    }
  }
  return derWrap(0x06, Buffer.from(encoded));
}

function derUtf8String(str: string): Buffer {
  return derWrap(0x0c, Buffer.from(str, "utf-8"));
}

function derPrintableString(str: string): Buffer {
  return derWrap(0x13, Buffer.from(str, "ascii"));
}

function derSequence(...children: Buffer[]): Buffer {
  return derWrap(0x30, Buffer.concat(children));
}

function derSet(...children: Buffer[]): Buffer {
  return derWrap(0x31, Buffer.concat(children));
}

function derContext0(content: Buffer): Buffer {
  return derWrap(0xa0, content);
}

// ---------------------------------------------------------------------------
// OIDs
// ---------------------------------------------------------------------------

const OID_CN = [2, 5, 4, 3];
const OID_C = [2, 5, 4, 6];
const OID_O = [2, 5, 4, 10];
const OID_SAN = [2, 5, 29, 17];
const OID_EXT_REQ = [1, 2, 840, 113549, 1, 9, 14];
const OID_SHA256_RSA = [1, 2, 840, 113549, 1, 1, 11];
const OID_SHA256_ECDSA = [1, 2, 840, 10045, 4, 3, 2];

// ---------------------------------------------------------------------------
// PEM helper
// ---------------------------------------------------------------------------

function toPem(data: Buffer, label: string): string {
  const b64 = data.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CSR generation (PKCS#10 / RFC 2986)
// ---------------------------------------------------------------------------

/** Options for {@link generateCsr}. */
export type GenerateCsrOptions = {
  /** Common Name for the CSR. */
  commonName: string;
  /** Subject Alternative Names (DNS names or IP addresses). */
  sans?: string[];
  /** Country name (2-letter ISO 3166-1 code). */
  countryName?: string;
  /** Organization Name. */
  organizationName?: string;
  /** Key type. Default: "rsa". */
  keyType?: "rsa" | "ecdsa";
  /** RSA key size in bits. Default: 2048. Ignored for ECDSA. */
  keySize?: 2048 | 3072 | 4096;
  /** ECDSA curve. Default: "P-256". Ignored for RSA. */
  namedCurve?: "P-256" | "P-384" | "P-521";
};

/** Result of {@link generateCsr}. */
export type CsrResult = {
  /** PEM-encoded PKCS#10 CSR. */
  csrPem: string;
  /** PEM-encoded private key (PKCS#8, unencrypted). */
  keyPem: string;
  /** The common name encoded in the CSR. */
  commonName: string;
  /** SAN values encoded in the CSR. */
  sans: string[];
};

/**
 * Generate a PKCS#10 CSR and matching private key.
 *
 * Pure `node:crypto` — no external dependencies. Produces a valid CSR
 * verifiable with `openssl req -in csr.pem -noout -text -verify`.
 *
 * @example
 * ```ts
 * import { generateCsr } from '@sourceregistry/mikrotik-client/crypto';
 *
 * const { csrPem, keyPem } = generateCsr({
 *   commonName: 'router.example.com',
 *   sans: ['router.example.com', '192.168.1.1'],
 * });
 * ```
 */
export function generateCsr(opts: GenerateCsrOptions): CsrResult {
  const keyType = opts.keyType ?? "rsa";
  const sans = opts.sans ?? [];

  // 1. Generate key pair - privateKey as PEM string (for sign), publicKey as DER
  type KeyPairResult = { privateKey: string; publicKey: Buffer };
  const pair =
    keyType === "rsa"
      ? (generateKeyPairSync("rsa", {
          modulusLength: opts.keySize ?? 2048,
          publicKeyEncoding: { type: "spki", format: "der" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }) as unknown as KeyPairResult)
      : (generateKeyPairSync("ec", {
          namedCurve: opts.namedCurve ?? "P-256",
          publicKeyEncoding: { type: "spki", format: "der" },
          privateKeyEncoding: { type: "pkcs8", format: "pem" },
        }) as unknown as KeyPairResult);

  const keyPem = pair.privateKey;
  const spki: Buffer = pair.publicKey;

  // 2. Build Subject (RDNSequence)
  const rdns: Buffer[] = [];
  if (opts.countryName) rdns.push(derSet(derOid(OID_C), derPrintableString(opts.countryName)));
  if (opts.organizationName) rdns.push(derSet(derOid(OID_O), derUtf8String(opts.organizationName)));
  rdns.push(derSet(derOid(OID_CN), derUtf8String(opts.commonName)));
  const subject = derSequence(...rdns);

  // 3. Build attributes (extensionRequest with SAN if present)
  const attributes = sans.length > 0 ? buildExtRequestAttr(sans) : derContext0(derSet());

  // 4. certificateRequestInfo = [version, subject, spki, attributes]
  const cri = derSequence(derInteger(0), subject, spki, attributes);

  // 5. Sign the CRI (sign accepts PEM string as key)
  const signature = sign("SHA256", cri, keyPem);
  const sigAlgOid = keyType === "rsa" ? OID_SHA256_RSA : OID_SHA256_ECDSA;
  // RFC 5480 §2.1: ECDSA algorithm identifier MUST omit parameters (not NULL).
  // RFC 4055 §5: RSA algorithm identifier MUST include NULL parameters.
  const sigAlg =
    keyType === "rsa" ? derSequence(derOid(sigAlgOid), derNull()) : derSequence(derOid(sigAlgOid));

  // 6. CertificateRequest = [certificateRequestInfo, signatureAlgorithm, signature]
  const csrDer = derSequence(cri, sigAlg, derBitString(signature));

  return {
    csrPem: toPem(csrDer, "CERTIFICATE REQUEST"),
    keyPem,
    commonName: opts.commonName,
    sans,
  };
}

// ---------------------------------------------------------------------------
// Build extensionRequest attribute containing SAN
// ---------------------------------------------------------------------------

function buildExtRequestAttr(sans: string[]): Buffer {
  const names: Buffer[] = [];
  for (const san of sans) {
    const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(san);
    if (isIp) {
      const parts = san.split(".").map(Number);
      names.push(derWrap(0xa4, Buffer.from(parts)));
    } else {
      names.push(derWrap(0x82, Buffer.from(san, "utf-8")));
    }
  }

  const extnValue = derOctetString(derSequence(...names));
  const ext = [derSequence(derOid(OID_SAN), extnValue)];

  return derContext0(derSequence(derSequence(derOid(OID_EXT_REQ), derSet(...ext))));
}
