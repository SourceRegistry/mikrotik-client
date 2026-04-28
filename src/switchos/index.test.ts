import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { SwitchOSHttpError } from "./index";
import {
  SwitchOSClient,
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

describe("SwitchOS decodeSwitchOSLiteral edge cases", () => {
  it("parses empty object", () => {
    expect(decodeSwitchOSLiteral("{}")).toEqual({});
  });

  it("parses empty array", () => {
    expect(decodeSwitchOSLiteral("[]")).toEqual([]);
  });

  it("parses null", () => {
    expect(decodeSwitchOSLiteral("null")).toBeNull();
  });

  it("parses true/false", () => {
    expect(decodeSwitchOSLiteral("true")).toBe(true);
    expect(decodeSwitchOSLiteral("false")).toBe(false);
  });

  it("parses negative numbers", () => {
    expect(decodeSwitchOSLiteral("-42")).toBe(-42);
  });

  it("parses decimal numbers", () => {
    expect(decodeSwitchOSLiteral("3.14")).toBeCloseTo(3.14);
  });

  it("parses exponent numbers", () => {
    expect(decodeSwitchOSLiteral("1e3")).toBe(1000);
    expect(decodeSwitchOSLiteral("1e+3")).toBe(1000);
    expect(decodeSwitchOSLiteral("1e-3")).toBeCloseTo(0.001);
  });

  it("parses string escape sequences", () => {
    expect(decodeSwitchOSLiteral("'\\n'")).toBe("\n");
    expect(decodeSwitchOSLiteral("'\\r'")).toBe("\r");
    expect(decodeSwitchOSLiteral("'\\t'")).toBe("\t");
    expect(decodeSwitchOSLiteral("'\\\\'"  )).toBe("\\");
    expect(decodeSwitchOSLiteral("'\\\"'")).toBe("\"");
    expect(decodeSwitchOSLiteral("'\\x41'")).toBe("A");
    expect(decodeSwitchOSLiteral("'\\u0041'")).toBe("A");
    expect(decodeSwitchOSLiteral("'\\z'")).toBe("z"); // default fallthrough
  });

  it("parses quoted key", () => {
    expect(decodeSwitchOSLiteral("{'key':1}")).toEqual({ key: 1 });
  });

  it("throws on unterminated string", () => {
    expect(() => decodeSwitchOSLiteral("'unterminated")).toThrow();
  });

  it("throws on invalid hex escape", () => {
    expect(() => decodeSwitchOSLiteral("'\\xZZ'")).toThrow(/hex escape/);
  });

  it("throws on invalid unicode escape", () => {
    expect(() => decodeSwitchOSLiteral("'\\uZZZZ'")).toThrow(/unicode escape/);
  });
});

describe("SwitchOS encodeSwitchOSLiteral edge cases", () => {
  it("encodes null", () => {
    expect(encodeSwitchOSLiteral(null)).toBe("null");
  });

  it("encodes true/false", () => {
    expect(encodeSwitchOSLiteral(true)).toBe("true");
    expect(encodeSwitchOSLiteral(false)).toBe("false");
  });

  it("encodes string", () => {
    expect(encodeSwitchOSLiteral("hello")).toBe("'hello'");
  });

  it("encodes nested array", () => {
    expect(encodeSwitchOSLiteral([1, 2, 3])).toBe("[0x1,0x2,0x3]");
  });
});

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

  it("retries on second 401 with updated nonce", async () => {
    let requestCount = 0;
    const nonce2 = "newnoncevalue1234";
    const server = createServer((request, response, _body, state) => {
      requestCount++;
      if (state.authorizedRequests === 1) {
        // Return 401 again with a new nonce on the second authorized request
        response.writeHead(401, { "WWW-Authenticate": `Digest realm="${realm}", nonce="${nonce2}", qop="auth", algorithm=MD5` });
        response.end("stale nonce");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("{id:'ok'}");
    });
    servers.push(server);

    const client = new SwitchOSClient({
      baseUrl: await server.listen(),
      username: "admin",
      password: "secret",
    });

    const result = await client.read<{ id: string }>("/sys.b");
    expect(result).toEqual({ id: "ok" });
    // 2 authorized requests: first returns stale 401, second returns 200
    expect(requestCount).toBe(2);
  });

  it("handles URLSearchParams body", async () => {
    const calls: Array<RequestInit> = [];
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return new Response("", { status: 200 });
      },
    });
    const params = new URLSearchParams({ foo: "bar" });
    await client.request("/test", { method: "POST", body: params });
    expect(calls[0]?.body).toBeInstanceOf(URLSearchParams);
  });

  it("handles FormData body", async () => {
    const calls: Array<RequestInit> = [];
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return new Response("", { status: 200 });
      },
    });
    const form = new FormData();
    form.append("key", "value");
    await client.request("/test", { method: "POST", body: form });
    expect(calls[0]?.body).toBeInstanceOf(FormData);
  });

  it("handles ArrayBuffer body", async () => {
    const calls: Array<RequestInit> = [];
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return new Response("", { status: 200 });
      },
    });
    const buf = new ArrayBuffer(4);
    await client.request("/test", { method: "POST", body: buf });
    expect(calls[0]?.body).toBeInstanceOf(Buffer);
  });

  it("handles no-credentials 401 → returns response", async () => {
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async () => new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": createDigestHeader() } }),
    });
    // No username/password → should not retry
    await expect(client.read("/sys.b")).rejects.toMatchObject({ status: 401 });
  });

  it("handles 401 with no parseable WWW-Authenticate → returns response", async () => {
    let call = 0;
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      username: "admin",
      password: "secret",
      fetch: async () => {
        call++;
        // No WWW-Authenticate header → challenge parsing returns undefined → returns as-is
        return new Response("no-challenge", { status: 401 });
      },
    });
    await expect(client.read("/sys.b")).rejects.toMatchObject({ status: 401 });
    expect(call).toBe(1);
  });

  it("downloads binary data", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async () => new Response(data, { status: 200 }),
    });
    const result = await client.download("/backup.bin");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it("download throws SwitchOSHttpError on non-200", async () => {
    const client = new SwitchOSClient({
      baseUrl: "http://127.0.0.1",
      fetch: async () => new Response("not found", { status: 404 }),
    });
    await expect(client.download("/missing.bin")).rejects.toMatchObject({ status: 404 });
  });

  it("listEndpoints returns keys from schema", () => {
    const client = new SwitchOSClient({ baseUrl: "http://127.0.0.1" });
    expect(client.listEndpoints()).toEqual([]);
    client.schema = { endpoints: { "/sys.b": {} as SwitchOSSectionSchema } };
    expect(client.listEndpoints()).toContain("/sys.b");
  });

  it("getEndpointSchema returns matching endpoint", () => {
    const client = new SwitchOSClient({ baseUrl: "http://127.0.0.1" });
    const schema: SwitchOSSectionSchema = { tab_id: "sys", tab_title: "System", title: "System", url: "/sys.b", shape: "object", list: false, read_only: false, refresh_ms: null, controls: [] };
    client.schema = { endpoints: { "/sys.b": schema } };
    expect(client.getEndpointSchema("/sys.b")).toBe(schema);
    expect(client.getEndpointSchema("/missing")).toBeUndefined();
  });
});
