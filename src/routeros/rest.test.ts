import { describe, expect, it, vi } from "vitest";
import {
  RouterOSRestAuthError,
  RouterOSRestClient,
  RouterOSRestPermissionError,
  RouterOSRestProtocolError,
  RouterOSRestTrapError,
} from "./rest";
import { createRouterOSHelpers } from "./helpers";
import type { DeviceTransport } from "./transport";

// ─── Mock fetch helpers ───────────────────────────────────────────────────────

function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): typeof globalThis.fetch {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      })
  );
}

type CapturedCall = { url: string; method: string; headers: Headers; body?: string };

function capturedFetch(
  status: number,
  body: unknown
): { fetch: typeof globalThis.fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, headers, ...(bodyText !== undefined && { body: bodyText }) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetchImpl, calls };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RouterOSRestClient", () => {
  describe("print", () => {
    it("GET /rest/<path> for simple list", async () => {
      const { fetch, calls } = capturedFetch(200, [
        { ".id": "*1", name: "ether1", type: "ether", disabled: "false" },
        { ".id": "*2", name: "ether2", type: "ether", disabled: "false" },
      ]);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        username: "admin",
        password: "test",
        fetch,
      });

      const records = await client.print("/interface");

      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ name: "ether1", type: "ether" });
      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/interface");
      expect(calls[0]?.method).toBe("GET");
    });

    it("includes Authorization header", async () => {
      const { fetch, calls } = capturedFetch(200, []);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        username: "admin",
        password: "secret",
        fetch,
      });

      await client.print("/ip/address");

      const auth = calls[0]?.headers.get("authorization");
      expect(auth).toBe(`Basic ${Buffer.from("admin:secret").toString("base64")}`);
    });

    it("appends .proplist as query param on GET", async () => {
      const { fetch, calls } = capturedFetch(200, []);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      await client.print("/interface", {
        attributes: { ".proplist": "name,type,disabled" },
      });

      expect(calls[0]?.url).toContain(".proplist=name%2Ctype%2Cdisabled");
      expect(calls[0]?.method).toBe("GET");
    });

    it("strips /print suffix passed by RouterOSClient.print internals", async () => {
      const { fetch, calls } = capturedFetch(200, []);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      // RouterOSClient.print appends /print — REST client should strip it
      await client.print("/interface/print");

      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/interface");
    });

    it("uses POST /print when queries are present", async () => {
      const { fetch, calls } = capturedFetch(200, []);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      await client.print("/interface", {
        queries: ["?=type=ether"],
      });

      expect(calls[0]?.url).toContain("/rest/interface/print");
      expect(calls[0]?.method).toBe("POST");
    });

    it("normalizes boolean and null response values to strings", async () => {
      const { fetch } = capturedFetch(200, [
        { ".id": "*1", disabled: false, comment: null, mtu: 1500 },
      ]);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      const records = await client.print("/interface");

      expect(records[0]).toMatchObject({
        disabled: "false",
        comment: "",
        mtu: "1500",
      });
    });

    it("returns empty array for empty response", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(200, []),
      });

      const records = await client.print("/ip/address");

      expect(records).toEqual([]);
    });
  });

  describe("execute", () => {
    it("POST /rest/<path>/add and returns .id record", async () => {
      const { fetch, calls } = capturedFetch(201, { ".id": "*10" });
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      const result = await client.execute("/ip/address/add", {
        attributes: { address: "10.0.0.1/24", interface: "ether1" },
      });

      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/ip/address/add");
      expect(calls[0]?.method).toBe("POST");
      expect(result.records[0]).toMatchObject({ ".id": "*10" });
      expect(result.traps).toEqual([]);
    });

    it("POST /rest/<path>/set with attributes", async () => {
      const { fetch, calls } = capturedFetch(200, {});
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      await client.execute("/ip/address/set", {
        attributes: { ".id": "*10", disabled: true },
      });

      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/ip/address/set");
      expect(calls[0]?.method).toBe("POST");
    });

    it("POST /rest/<path>/remove", async () => {
      const { fetch, calls } = capturedFetch(200, {});
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      await client.execute("/ip/address/remove", {
        attributes: { ".id": "*10" },
      });

      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/ip/address/remove");
    });

    it("maps getall to /print endpoint", async () => {
      const { fetch, calls } = capturedFetch(200, []);
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      await client.execute("/interface/getall");

      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/interface/print");
    });

    it("POST /rest/<path> for generic commands", async () => {
      const { fetch, calls } = capturedFetch(200, {});
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch,
      });

      await client.execute("/system/reboot");

      expect(calls[0]?.url).toBe("http://192.168.1.1/rest/system/reboot");
      expect(calls[0]?.method).toBe("POST");
    });

    it("result includes done reply on success", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(200, {}),
      });

      const result = await client.execute("/system/reboot");

      expect(result.done).toBeDefined();
      expect(result.done?.type).toBe("done");
    });
  });

  describe("error handling", () => {
    it("throws RouterOSRestAuthError on 401", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(401, { detail: "bad credentials" }),
      });

      await expect(client.print("/interface")).rejects.toThrow(RouterOSRestAuthError);
      await expect(client.print("/interface")).rejects.toMatchObject({
        code: "auth_failed",
        retriable: false,
      });
    });

    it("throws RouterOSRestPermissionError on 403", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(403, { detail: "permission denied" }),
      });

      await expect(client.print("/interface")).rejects.toThrow(RouterOSRestPermissionError);
      await expect(client.print("/interface")).rejects.toMatchObject({
        code: "permission_denied",
        retriable: false,
      });
    });

    it("throws RouterOSRestTrapError on 400 with detail from response body", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(400, {
          detail: "no such item (4)",
          error: 400,
        }),
      });

      await expect(
        client.execute("/ip/address/remove", { attributes: { ".id": "*999" } })
      ).rejects.toThrow(RouterOSRestTrapError);
      await expect(
        client.execute("/ip/address/remove", { attributes: { ".id": "*999" } })
      ).rejects.toMatchObject({
        code: "trap",
        detail: "no such item (4)",
        httpStatus: 400,
      });
    });

    it("throws RouterOSRestProtocolError on 500", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(500, { detail: "internal error" }),
      });

      await expect(client.print("/interface")).rejects.toThrow(RouterOSRestProtocolError);
      await expect(client.print("/interface")).rejects.toMatchObject({
        code: "protocol_violation",
        retriable: true,
      });
    });

    it("throws RouterOSRestProtocolError on listen (not supported)", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(200, []),
      });

      await expect(client.listen("/interface/listen")).rejects.toThrow(RouterOSRestProtocolError);
      await expect(client.listen("/interface/listen")).rejects.toMatchObject({
        code: "protocol_violation",
      });
    });
  });

  describe("DeviceTransport compatibility", () => {
    it("satisfies DeviceTransport interface", () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(200, []),
      });

      // Type-level check: assign to DeviceTransport
      const transport: DeviceTransport = client;
      expect(transport).toBeDefined();
    });

    it("createRouterOSHelpers works with RouterOSRestClient", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        username: "admin",
        password: "test",
        fetch: mockFetch(200, [
          { ".id": "*1", name: "ether1", type: "ether", "mac-address": "AA:BB:CC:DD:EE:FF" },
        ]),
      });

      const helpers = createRouterOSHelpers(client);
      const interfaces = await helpers.interface.list();

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0]).toMatchObject({ name: "ether1" });
    });

    it("helpers.system.resource.get works via REST", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: mockFetch(200, {
          "cpu-load": "5",
          "free-memory": "104857600",
          version: "7.14.1",
          platform: "CHR",
        }),
      });

      const helpers = createRouterOSHelpers(client);
      const resource = await helpers.system.resource.get();

      expect(resource).toMatchObject({
        version: "7.14.1",
        platform: "CHR",
      });
    });
  });

  describe("signal and timeout", () => {
    it("pre-aborted signal is passed to fetch", async () => {
      let capturedSignal: AbortSignal | undefined;
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        fetch: async (_url, init) => {
          capturedSignal = init?.signal ?? undefined;
          return new Response("[]", { status: 200 });
        },
      });

      const controller = new AbortController();
      controller.abort(new Error("test abort"));

      // Even though signal is aborted, we just verify it's passed through
      try {
        await client.print("/interface", { signal: controller.signal });
      } catch {
        // May throw - that's fine
      }

      expect(capturedSignal?.aborted).toBe(true);
    });

    it("passes AbortSignal to fetch when timeoutMs is set", async () => {
      let capturedSignal: AbortSignal | undefined;
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        timeoutMs: 100,
        fetch: async (_url, init) => {
          capturedSignal = init?.signal ?? undefined;
          return new Response("[]", { status: 200 });
        },
      });

      await client.print("/interface");

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    it("returns empty array when response body is invalid JSON", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        username: "admin",
        password: "test",
        fetch: mockFetch(200, "not-json", { "content-type": "text/plain" }),
      });
      const records = await client.print("/interface");
      expect(records).toEqual([]);
    });

    it("returns empty array when response body is JSON primitive", async () => {
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        username: "admin",
        password: "test",
        fetch: vi.fn(
          async () =>
            new Response("42", { status: 200, headers: { "content-type": "application/json" } })
        ),
      });
      const records = await client.print("/interface");
      expect(records).toEqual([]);
    });
  });

  describe("execute with array attribute containing null", () => {
    it("serializes null element in array attribute as empty string", async () => {
      const calls: Array<{ body?: string }> = [];
      const client = new RouterOSRestClient({
        baseUrl: "http://192.168.1.1",
        username: "admin",
        password: "test",
        fetch: vi.fn(async (_input, init) => {
          calls.push({ body: typeof init?.body === "string" ? init.body : undefined });
          return new Response("[]", { status: 200 });
        }),
      });
      await client.execute("/interface/set", {
        attributes: { list: [null, "wan"] as unknown as string[] },
      });
      expect(calls[0]?.body).toContain(",wan");
    });
  });
});
