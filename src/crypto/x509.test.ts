import { describe, expect, it } from "vitest";
import { parseCertificate } from "./x509";

// Self-signed RSA-2048 cert: CN=test.example.com, O=Test Org, C=US
// SAN: DNS:test.example.com, IP:127.0.0.1 — keyUsage: digitalSignature,keyEncipherment
// valid ~2026-04-27 to 2036-04-24
const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDiTCCAnGgAwIBAgIUHCL2F6RaSgX6GkINuHCqttEDDUQwDQYJKoZIhvcNAQEL
BQAwOzEZMBcGA1UEAwwQdGVzdC5leGFtcGxlLmNvbTERMA8GA1UECgwIVGVzdCBP
cmcxCzAJBgNVBAYTAlVTMB4XDTI2MDQyNzA2MTkxMFoXDTM2MDQyNDA2MTkxMFow
OzEZMBcGA1UEAwwQdGVzdC5leGFtcGxlLmNvbTERMA8GA1UECgwIVGVzdCBPcmcx
CzAJBgNVBAYTAlVTMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu8Mq
tbHOTqVonUlSjR0+d9Hy+6RhilcFWchVQ7LvSry0g5aL1wHymoo+sjMj+3m2QezJ
lvxa7b4WG8cuIvT6UVud9I2ifxnTKYhqRKQAoWLfSKLOnwSDKM9e4QyUjkj1qXFB
15DVt7PWW3SIsuW/E+MrCnL6N9TFAiMMpIFraQJkesjndBLkvYKprWa7UbcI3tkK
UdDylpZEBiKoF9tVkSudubPL7+FD7dNLBCxERLHVVM07Q38PzmyKtJ8RTyY1N49S
j8JyeFDgnDJmwqe33VhPxmbtuDhv4Buj0PEgyLROMorfe22zGQUiMtygPgrkrz5i
8VseMy7+9Suwq0FmRQIDAQABo4GEMIGBMB0GA1UdDgQWBBSC9MNomgVBONVa3nmO
0DOjsyVfvTAfBgNVHSMEGDAWgBSC9MNomgVBONVa3nmO0DOjsyVfvTAPBgNVHRMB
Af8EBTADAQH/MCEGA1UdEQQaMBiCEHRlc3QuZXhhbXBsZS5jb22HBH8AAAEwCwYD
VR0PBAQDAgWgMA0GCSqGSIb3DQEBCwUAA4IBAQBVtmFw1eUxnFnkce6rKtOoiXY4
EkVeyH1i0qIjFXn5vBcZdB0xLxFlAPDLqhGMFamtJjmlq1TzoAXWXgJlU3AWwZrZ
qTkYCVPUSwjk0qfKyTDTP0fEz3Ei/f9MXvN9406yRHo2Oz1Ipwxnhgmj1B6HdD8f
YsAzEQFQEBu+SXrBYDHJCrg2Tnh0g/dK1nIWnZC8mT+WjQ+6H4Fc8OJPFc0mkpN6
pT0EHqS6joi7SoXA2MDDCD+VionZxV77uxE1klAOuuLII0NrsOWM7NbAFjgEBwGx
Caa3RiHi665nEU7fddmFq0rn84IMq0xhjgCBbQn5m0vsUBh+CxGvK+bWNs9C
-----END CERTIFICATE-----`;

describe("parseCertificate", () => {
  it("parses a valid PEM certificate", () => {
    const result = parseCertificate(TEST_CERT_PEM);
    expect(result).toBeDefined();
    expect(typeof result.subject).toBe("string");
    expect(typeof result.issuer).toBe("string");
    expect(typeof result.serialNumber).toBe("string");
    expect(typeof result.validFrom).toBe("string");
    expect(typeof result.validTo).toBe("string");
    expect(typeof result.fingerprint256).toBe("string");
    expect(typeof result.fingerprint512).toBe("string");
    expect(Array.isArray(result.subjectAltNames)).toBe(true);
    expect(typeof result.publicKeySize).toBe("string");
    expect(result.pem).toBe(TEST_CERT_PEM);
  });

  it("returns non-empty sha256 fingerprint", () => {
    const result = parseCertificate(TEST_CERT_PEM);
    expect(result.fingerprint256.length).toBeGreaterThan(0);
    expect(result.fingerprint256).toMatch(/^[0-9A-F:]+$/);
  });

  it("is self-signed (subject === issuer)", () => {
    const result = parseCertificate(TEST_CERT_PEM);
    expect(result.subject).toBe(result.issuer);
  });

  it("keyUsage is always an array (even when Node returns undefined for extension)", () => {
    const result = parseCertificate(TEST_CERT_PEM);
    // X509Certificate.keyUsage returns undefined in Node ≤ v24 despite extension present;
    // parseCertificate normalises to [].
    expect(Array.isArray(result.keyUsage)).toBe(true);
  });

  it("parses SANs including DNS and IP entries", () => {
    const result = parseCertificate(TEST_CERT_PEM);
    expect(result.subjectAltNames.some((s) => s.includes("test.example.com"))).toBe(true);
    expect(result.subjectAltNames.some((s) => s.includes("127.0.0.1"))).toBe(true);
  });

  it("parses RSA public key size", () => {
    const result = parseCertificate(TEST_CERT_PEM);
    expect(result.publicKeySize).toBe("2048");
  });

  it("throws on invalid PEM", () => {
    expect(() => parseCertificate("not a certificate")).toThrow();
  });

  it("parses EC public key (namedCurve branch)", () => {
    // Self-signed P-256 cert, no SAN
    const EC_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBkDCCATegAwIBAgIUX+hdlV9DD6z2AnARn4OIH24pBkYwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTZWMudGVzdC5leGFtcGxlLmNvbTAeFw0yNjA0MjcyMDEyMjNa
Fw0zNjA0MjQyMDEyMjNaMB4xHDAaBgNVBAMME2VjLnRlc3QuZXhhbXBsZS5jb20w
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATf0cJ6WgzZJlUqNvImrhU3slVeeS68
vLXV47/BtNE7035TRZrJV7ZP8/kC9KYj5R726ypeqY5w9s+w+MW6fJJbo1MwUTAd
BgNVHQ4EFgQURB9RG8F0kE4gAFaLm3OscjeykykwHwYDVR0jBBgwFoAURB9RG8F0
kE4gAFaLm3OscjeykykwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBE
AiAMDnB4zlfW6SJxVr1zl9ewVGkTQrvXOdLg6X90JR3dWgIgd3qsvmxB6oFziy7j
01kdnBUc4WFS7bJ32I8spuw8deg=
-----END CERTIFICATE-----`;
    const result = parseCertificate(EC_CERT_PEM);
    expect(result.publicKeySize).toBe("prime256v1");
  });

  it("returns empty subjectAltNames when no SAN extension", () => {
    // Self-signed RSA cert without SAN
    const NO_SAN_PEM = `-----BEGIN CERTIFICATE-----
MIIDGzCCAgOgAwIBAgIUQTSQx+v/kMn2indpOCJXqDJJ87QwDQYJKoZIhvcNAQEL
BQAwHTEbMBkGA1UEAwwSbm8tc2FuLmV4YW1wbGUuY29tMB4XDTI2MDQyNzIwMTIy
M1oXDTM2MDQyNDIwMTIyM1owHTEbMBkGA1UEAwwSbm8tc2FuLmV4YW1wbGUuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAhnX7L3F2fosgS/lBsCFf
GvqW/Zcxiy+2jmEjXCW6fLcQePTpXzHaWg75X1OTuvL/Nr8b/SvA8XWOExvDc5mB
uyYkOC6hNtR4L/xgW8zKqZbCV21pqAs37m48JrgDFqEWSNOaoGgLyBEhFw5C4VZ3
4AHIk2mlD80xNQ8MkGXHjeb4qsb3IBeSX/Vz1x5qo8OjhoXh73cW/xtMFRTq4OXK
qME2CHqnVqwvbtvBt42Hh6KXfBtkaAXiflibHk+CskbP/d0LsU4lpq5JCixjDRpI
y9xILbWeb8Cxx1EOZFr7uDJZoGLezLDJnddWtkB/sDe5bG120AxD92EwKypE/QIs
9wIDAQABo1MwUTAdBgNVHQ4EFgQUfmyOpLeseqYHr3pTjHvpwJ5j2DowHwYDVR0j
BBgwFoAUfmyOpLeseqYHr3pTjHvpwJ5j2DowDwYDVR0TAQH/BAUwAwEB/zANBgkq
hkiG9w0BAQsFAAOCAQEAFFm2ejCrGoGQw/5iUqcQ7hOJIqpy79nUHCdeYHHFvrLs
dUIku1dmLNxQaI40IlFXPiT5u9x/GnQmBi8dPRzAF4jaL73CR3gpI+2hzwGgh+Br
8sxBHBeO2l0Mit5cYxIS8IT9ip1+uqFIwWrQ4/dCb8vsilSpDrI5k9ztcBxTmezm
PhQY2x4tL3cB5pXAKtYcxO+tsamvjqqM6aZlvMPG00UaWy1KZssAwK/mfVgPwNCw
gDM+RoNI4mxgoog6G26Vqe10q6b4XGRMQYOtTqFe9GFOQU7eQHwaZ9OxU3jLuOTS
VNZRhr8lL6GfbnpnJvlWiX4rRnqBX8JigYEgBzkvDg==
-----END CERTIFICATE-----`;
    const result = parseCertificate(NO_SAN_PEM);
    expect(result.subjectAltNames).toEqual([]);
  });
});
