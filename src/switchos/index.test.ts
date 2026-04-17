import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  SwitchOSClient,
  SwitchOSHttpError,
  decodeSwitchOSBitmask,
  decodeSwitchOSHexString,
  decodeSwitchOSIpv4,
  decodeSwitchOSLiteral,
  decodeSwitchOSMac,
  encodeSwitchOSBitmask,
  encodeSwitchOSHexString,
  encodeSwitchOSIpv4,
  encodeSwitchOSLiteral,
  encodeSwitchOSMac,
} from "./index";

const realm = "MikroTik SwOS";
const nonce = "deadbeefcafebabe";
const opaque = "feedface";

function createDigestHeader() {
  return `Digest realm="${realm}", nonce="${nonce}", opaque="${opaque}", qop="auth", algorithm=MD5`;
}

function createServer(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    body: string,
    state: { authorizedRequests: number }
  ) => void
) {
  const state = { authorizedRequests: 0 };
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const auth = request.headers.authorization;

      if (!auth?.startsWith("Digest ")) {
        response.writeHead(401, { "WWW-Authenticate": createDigestHeader() });
        response.end("auth required");
        return;
      }

      state.authorizedRequests += 1;
      handler(request, response, body, state);
    });
  });

  return {
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind test server");
      }
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

describe("SwitchOS literal codec", () => {
  it("encodes and decodes object payloads", () => {
    const payload = {
      iptp: 0x01,
      ip: 0x0101a8c0,
      id: "737769746368",
      rows: [{ vid: 0x0001, nm: "64656661756c74" }],
    };

    const encoded = encodeSwitchOSLiteral(payload);

    expect(encoded).toBe("{iptp:0x1,ip:0x101a8c0,id:'737769746368',rows:[{vid:0x1,nm:'64656661756c74'}]}");
    expect(decodeSwitchOSLiteral(encoded)).toEqual(payload);
  });

  it("handles stable SwOS wire helpers", () => {
    expect(encodeSwitchOSHexString("switch")).toBe("737769746368");
    expect(decodeSwitchOSHexString("737769746368")).toBe("switch");
    expect(encodeSwitchOSIpv4("192.168.1.1")).toBe(0x0101a8c0);
    expect(decodeSwitchOSIpv4(0x0101a8c0)).toBe("192.168.1.1");
    expect(encodeSwitchOSMac("00:11:22:33:44:55")).toBe("001122334455");
    expect(decodeSwitchOSMac("001122334455")).toBe("00:11:22:33:44:55");
    expect(encodeSwitchOSBitmask([0, 1, 16])).toBe(0x00010003);
    expect(decodeSwitchOSBitmask(0x00010003)).toEqual([0, 1, 16]);
  });
});

describe("SwitchOS client", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close();
    }
  });

  it("retries GET with digest auth and parses literal body", async () => {
    const server = createServer((request, response, _body, state) => {
      expect(request.url).toBe("/sys.b");
      expect(state.authorizedRequests).toBeGreaterThanOrEqual(1);
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("{id:'737769746368',ip:0x0101A8C0}");
    });
    servers.push(server);

    const baseUrl = await server.listen();
    const client = new SwitchOSClient({
      baseUrl,
      username: "admin",
      password: "secret",
    });

    await client.login();
    const result = await client.read<{ id: string; ip: number }>("/sys.b");

    expect(result).toEqual({ id: "737769746368", ip: 0x0101a8c0 });
  });

  it("serializes POST bodies as text/plain JS literals", async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return new Response("[{vid:0x1,nm:'64656661756c74',mbr:0x3}]", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    });

    const result = await client.write("/vlan.b", [{ vid: 1, nm: "64656661756c74", mbr: 3 }]);

    expect(String(calls[0]?.input)).toBe("http://127.0.0.1/vlan.b");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toBeInstanceOf(Headers);
    expect((calls[0]?.init?.headers as Headers).get("content-type")).toBe("text/plain");
    expect(calls[0]?.init?.body).toBe("[{vid:0x1,nm:'64656661756c74',mbr:0x3}]");
    expect(result).toEqual([{ vid: 1, nm: "64656661756c74", mbr: 3 }]);
  });

  it("posts action endpoints with star body", async () => {
    const server = createServer((request, response, body) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/reboot");
      expect(body).toBe("*");
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("");
    });
    servers.push(server);

    const client = new SwitchOSClient({
      baseUrl: await server.listen(),
      username: "admin",
      password: "secret",
    });

    await expect(client.action("/reboot")).resolves.toBeUndefined();
  });

  it("throws rich HTTP errors for non-success responses", async () => {
    const server = createServer((_request, response, _body) => {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("boom");
    });
    servers.push(server);

    const client = new SwitchOSClient({
      baseUrl: await server.listen(),
      username: "admin",
      password: "secret",
    });

    await expect(client.read("/sys.b")).rejects.toMatchObject<Partial<SwitchOSHttpError>>({
      name: "SwitchOSHttpError",
      status: 500,
      body: "boom",
    });
  });
});
