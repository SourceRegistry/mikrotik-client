import { describe, expect, it } from 'vitest';
import { generateCsr, type GenerateCsrOptions, type CsrResult } from './csr';

describe('generateCsr', () => {
    it('generates a valid RSA 2048 CSR', () => {
        const result = generateCsr({
            commonName: 'example.com',
            keyType: 'rsa',
            keySize: 2048,
        } satisfies GenerateCsrOptions);

        expect(result).toBeDefined();
        expect(result.commonName).toBe('example.com');
        expect(result.csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
        expect(result.csrPem).toContain('-----END CERTIFICATE REQUEST-----');
        expect(result.keyPem).toContain('-----BEGIN PRIVATE KEY-----');
        expect(result.keyPem).toContain('-----END PRIVATE KEY-----');
        expect(result.sans).toEqual([]);
    });

    it('generates a valid RSA 4096 CSR', () => {
        const result = generateCsr({
            commonName: 'big.example.com',
            keyType: 'rsa',
            keySize: 4096,
        } satisfies GenerateCsrOptions);

        expect(result.commonName).toBe('big.example.com');
        expect(result.csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
        expect(result.keyPem).toContain('-----BEGIN PRIVATE KEY-----');
    });

    it('generates a valid ECDSA P-256 CSR', () => {
        const result = generateCsr({
            commonName: 'ec.example.com',
            keyType: 'ecdsa',
            namedCurve: 'P-256',
        } satisfies GenerateCsrOptions);

        expect(result.commonName).toBe('ec.example.com');
        expect(result.csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
        // Node exports EC private keys in PKCS#8 format (BEGIN PRIVATE KEY)
        expect(result.keyPem).toContain('-----BEGIN PRIVATE KEY-----');
    });

    it('generates a valid ECDSA P-384 CSR', () => {
        const result = generateCsr({
            commonName: 'ec384.example.com',
            keyType: 'ecdsa',
            namedCurve: 'P-384',
        } satisfies GenerateCsrOptions);

        expect(result.commonName).toBe('ec384.example.com');
        expect(result.csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    });

    it('includes subject fields when provided', () => {
        const result = generateCsr({
            commonName: 'cn.example.com',
            keyType: 'rsa',
            keySize: 2048,
            countryName: 'US',
            organizationName: 'Example Inc',
        } satisfies GenerateCsrOptions);

        expect(result.commonName).toBe('cn.example.com');
        expect(result.csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    });

    it('includes SANs when provided', () => {
        const result = generateCsr({
            commonName: 'example.com',
            keyType: 'rsa',
            keySize: 2048,
            sans: ['example.com', 'www.example.com', '192.168.1.1'],
        } satisfies GenerateCsrOptions);

        expect(result.sans).toEqual(['example.com', 'www.example.com', '192.168.1.1']);
        expect(result.csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    });

    it('returns CsrResult with correct shape', () => {
        const result = generateCsr({
            commonName: 'shape.test',
            keyType: 'rsa',
            keySize: 2048,
        } satisfies GenerateCsrOptions);

        // Type check: ensure result is CsrResult with expected shape
        const _: CsrResult = result;
        expect(typeof _.csrPem).toBe('string');
        expect(typeof _.keyPem).toBe('string');
        expect(typeof _.commonName).toBe('string');
        expect(Array.isArray(_.sans)).toBe(true);
    });

    it('ECDSA CSR has no NULL params in signature algorithm (RFC 5480)', () => {
        const result = generateCsr({
            commonName: 'ec.example.com',
            keyType: 'ecdsa',
            namedCurve: 'P-256',
        });
        // Decode DER and check that the sigAlg sequence does NOT contain a NULL byte (0x05 0x00)
        // after the OID. NULL params are valid for RSA but MUST be absent for ECDSA.
        const der = Buffer.from(
            result.csrPem
                .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
                .replace('-----END CERTIFICATE REQUEST-----', '')
                .replace(/\n/g, ''),
            'base64',
        );
        // OID for ecdsa-with-SHA256: 06 08 2a 86 48 ce 3d 04 03 02
        const ecdsaSha256Oid = Buffer.from('06082a8648ce3d040302', 'hex');
        const oidPos = der.indexOf(ecdsaSha256Oid);
        expect(oidPos).toBeGreaterThan(-1);
        // Byte immediately after OID should NOT be 0x05 (NULL tag)
        const byteAfterOid = der[oidPos + ecdsaSha256Oid.length];
        expect(byteAfterOid).not.toBe(0x05);
    });

    it('different SNIs produce different CSRs', () => {
        const resultA = generateCsr({
            commonName: 'a.example.com',
            keyType: 'rsa',
            keySize: 2048,
        } satisfies GenerateCsrOptions);

        const resultB = generateCsr({
            commonName: 'b.example.com',
            keyType: 'rsa',
            keySize: 2048,
        } satisfies GenerateCsrOptions);

        expect(resultA.csrPem).not.toBe(resultB.csrPem);
        expect(resultA.keyPem).not.toBe(resultB.keyPem);
    });
});
