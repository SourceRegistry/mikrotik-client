import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import {
  generateClientECDHKey,
  computeMD5Hash,
  computeECSRPHash,
  parseEcPoint,
  isValidEcPublicKey,
  EC_POINT_UNCOMPRESSED_SIZE,
} from "./auth";

describe("computeMD5Hash", () => {
  it("produces correct MD5(password || salt)", () => {
    const password = "test-password";
    const salt = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

    const hash = computeMD5Hash(password, salt);

    expect(hash.length).toBe(16);

    // Verify against known MD5 output
    const expected = crypto.createHash("md5");
    expected.update(password, "utf8");
    expected.update(salt);
    expect(Array.from(hash)).toEqual(Array.from(new Uint8Array(expected.digest())));
  });

  it("produces different hashes for different passwords", () => {
    const salt = new Uint8Array(8);
    crypto.getRandomValues(salt);

    const hash1 = computeMD5Hash("password1", salt);
    const hash2 = computeMD5Hash("password2", salt);

    expect(hash1).not.toEqual(hash2);
  });

  it("produces different hashes for different salts", () => {
    const password = "same-password";
    const salt1 = new Uint8Array([0xaa, 0xbb]);
    const salt2 = new Uint8Array([0xcc, 0xdd]);

    const hash1 = computeMD5Hash(password, salt1);
    const hash2 = computeMD5Hash(password, salt2);

    expect(hash1).not.toEqual(hash2);
  });
});

describe("generateClientECDHKey", () => {
  it("generates a valid EC key pair", () => {
    const { ecdh, publicKey } = generateClientECDHKey();

    expect(ecdh).toBeDefined();
    expect(publicKey).toBeDefined();
  });

  it("public key is 65-byte uncompressed point", () => {
    const { publicKey } = generateClientECDHKey();

    expect(publicKey.length).toBe(EC_POINT_UNCOMPRESSED_SIZE);
    expect(publicKey[0]).toBe(0x04); // uncompressed prefix
  });

  it("public key is valid according to isValidEcPublicKey", () => {
    const { publicKey } = generateClientECDHKey();

    expect(isValidEcPublicKey(publicKey)).toBe(true);
  });

  it("each generated key pair is unique", () => {
    const key1 = generateClientECDHKey();
    const key2 = generateClientECDHKey();

    expect(key1.publicKey).not.toEqual(key2.publicKey);
  });
});

describe("parseEcPoint", () => {
  it("parses valid uncompressed point", () => {
    const { publicKey } = generateClientECDHKey();
    const [x, y] = parseEcPoint(publicKey);

    expect(x.length).toBe(32);
    expect(y.length).toBe(32);
    expect(publicKey[0]).toBe(0x04);
    expect(Array.from(publicKey.slice(1, 33))).toEqual(Array.from(x));
    expect(Array.from(publicKey.slice(33))).toEqual(Array.from(y));
  });

  it("throws on wrong length", () => {
    const bad = new Uint8Array(64);
    expect(() => parseEcPoint(bad)).toThrow(/length/);
  });

  it("throws on bad prefix", () => {
    const bad = new Uint8Array(65);
    bad[0] = 0x03; // compressed prefix
    expect(() => parseEcPoint(bad)).toThrow(/prefix/);
  });
});

describe("isValidEcPublicKey", () => {
  it("returns true for valid uncompressed point", () => {
    const { publicKey } = generateClientECDHKey();
    expect(isValidEcPublicKey(publicKey)).toBe(true);
  });

  it("returns false for wrong length", () => {
    const bad = new Uint8Array(64);
    bad[0] = 0x04;
    expect(isValidEcPublicKey(bad)).toBe(false);
  });

  it("returns false for compressed point", () => {
    const bad = new Uint8Array(33);
    bad[0] = 0x03;
    expect(isValidEcPublicKey(bad)).toBe(false);
  });
});

describe("computeECSRPHash", () => {
  it("computes hash from client key and server public key", () => {
    const client = generateClientECDHKey();

    // Generate a server key pair for testing
    const server = generateClientECDHKey();

    const hash = computeECSRPHash({
      username: "testuser",
      clientECDH: client.ecdh,
      serverPublicKey: server.publicKey,
    });

    expect(hash.length).toBe(32);
  });

  it("produces consistent hash for same inputs", () => {
    const client = generateClientECDHKey();
    const server = generateClientECDHKey();

    const hash1 = computeECSRPHash({
      username: "user",
      clientECDH: client.ecdh,
      serverPublicKey: server.publicKey,
    });

    const hash2 = computeECSRPHash({
      username: "user",
      clientECDH: client.ecdh,
      serverPublicKey: server.publicKey,
    });

    expect(hash1).toEqual(hash2);
  });

  it("produces different hash for different usernames", () => {
    const client = generateClientECDHKey();
    const server = generateClientECDHKey();

    const hash1 = computeECSRPHash({
      username: "alice",
      clientECDH: client.ecdh,
      serverPublicKey: server.publicKey,
    });

    const hash2 = computeECSRPHash({
      username: "bob",
      clientECDH: client.ecdh,
      serverPublicKey: server.publicKey,
    });

    expect(hash1).not.toEqual(hash2);
  });

  it("throws on invalid server public key", () => {
    const client = generateClientECDHKey();
    const badPublicKey = new Uint8Array(65);
    badPublicKey[0] = 0x04;

    expect(() =>
      computeECSRPHash({
        username: "user",
        clientECDH: client.ecdh,
        serverPublicKey: badPublicKey,
      })
    ).toThrow();
  });
});
