/**
 * @module mac-telnet/auth
 *
 * Authentication helpers for MAC-Telnet protocol.
 *
 * Supports two authentication methods:
 * - EC-SRP (Elliptic Curve Secure Remote Password) on secp256r1 (P-256)
 * - MD5 legacy auth (fallback for older RouterOS versions)
 *
 * @example
 * ```ts
 * // EC-SRP authentication
 * const { privateKey, publicKey } = generateClientECDHKey();
 * const hash = computeECSRPHash({ username: "admin", clientPrivateKey: privateKey, serverPublicKey });
 *
 * // MD5 authentication (legacy)
 * const md5Hash = computeMD5Hash("password", salt);
 * ```
 */

import * as crypto from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

/** SECP256R1 curve name for Node.js crypto. */
export const EC_CURVE = "P-256";

/** Size of one EC coordinate in bytes (256 bits / 8). */
export const EC_COORDINATE_SIZE = 32;

/** Uncompressed EC point: 0x04 prefix + 32 bytes x + 32 bytes y. */
export const EC_POINT_UNCOMPRESSED_SIZE = 65;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * ECDH key pair for MAC-Telnet authentication.
 *
 * @example
 * ```ts
 * const { ecdh, publicKey } = generateClientECDHKey();
 * ```
 */
export interface ECKeyPair {
  /** ECDH instance for computing shared secrets. */
  ecdh: crypto.ECDH;
  /** Raw uncompressed public key point (65 bytes: 0x04 || x || y). */
  publicKey: Uint8Array;
}

// ── MD5 Legacy Auth ──────────────────────────────────────────────────────────

/**
 * Compute MD5 hash for legacy MAC-Telnet authentication.
 *
 * Formula: `MD5(password || salt)`
 *
 * @param password - The plaintext password.
 * @param salt - Random salt bytes from the device.
 * @returns 16-byte MD5 digest.
 *
 * @example
 * ```ts
 * const resp = computeMD5Hash("secret", deviceSalt);
 * ```
 */
export function computeMD5Hash(password: string, salt: Uint8Array): Uint8Array {
  const h = crypto.createHash("md5");
  h.update(password, "utf8");
  h.update(salt);
  return new Uint8Array(h.digest());
}

// ── EC-SRP Auth ──────────────────────────────────────────────────────────────

/**
 * Generate an ECDH key pair on P-256 for EC-SRP auth.
 *
 * @returns Key pair containing ECDH instance and uncompressed public point.
 *
 * @example
 * ```ts
 * const { ecdh, publicKey } = generateClientECDHKey();
 * ```
 */
export function generateClientECDHKey(): ECKeyPair {
  // OpenSSL curve name for createECDH
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();

  // getPublicKey() returns raw SEC1 uncompressed point (65 bytes: 0x04 || x || y)
  const rawPoint = ecdh.getPublicKey() as Uint8Array;

  return { ecdh, publicKey: rawPoint };
}

/**
 * Compute the EC-SRP authentication response hash.
 *
 * 1. ECDH(key_priv, server_pub) → shared_secret
 * 2. HMAC-SHA256(shared_secret, username || server_pub) → response
 *
 * @param opts - Username, client ECDH instance, server's raw public point.
 * @returns 32-byte HMAC-SHA256 response.
 *
 * @example
 * ```ts
 * const resp = computeECSRPHash({ username, clientECDH: key.ecdh, serverPublicKey });
 * ```
 */
export function computeECSRPHash(opts: {
  username: string;
  clientECDH: crypto.ECDH;
  serverPublicKey: Uint8Array;
}): Uint8Array {
  const { username, clientECDH, serverPublicKey } = opts;

  const shared = clientECDH.computeSecret(serverPublicKey);
  if (!shared || shared.length === 0) {
    throw new Error("ECDH shared secret computation failed");
  }

  const hmac = crypto.createHmac("sha256", shared);
  hmac.update(username, "utf8");
  hmac.update(serverPublicKey);
  return new Uint8Array(hmac.digest());
}

// ── Point helpers ────────────────────────────────────────────────────────────

/**
 * Parse uncompressed EC point into coordinates.
 *
 * @param point - 65-byte point (0x04 || x || y).
 * @returns `[x, y]` each 32 bytes.
 * @throws If length or prefix is invalid.
 */
export function parseEcPoint(point: Uint8Array): [x: Uint8Array, y: Uint8Array] {
  if (point.length !== EC_POINT_UNCOMPRESSED_SIZE) {
    throw new Error(`Bad EC point length: ${point.length}`);
  }
  const prefix = point[0];
  if (prefix === undefined || prefix !== 0x04) {
    throw new Error(`Bad EC point prefix: 0x${prefix?.toString(16).padStart(2, "0") ?? "??"}`);
  }
  return [point.slice(1, 33), point.slice(33)];
}

/**
 * Quick validation: correct length + uncompressed prefix.
 */
export function isValidEcPublicKey(key: Uint8Array): boolean {
  return key.length === EC_POINT_UNCOMPRESSED_SIZE && key[0] === 0x04;
}
