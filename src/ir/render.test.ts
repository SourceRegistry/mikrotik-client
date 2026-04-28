import { describe, expect, it } from "vitest";
import { renderScript, renderIdentity } from "./render";
import {
  type IRItem,
  type RouterOSConfig,
  type IRResourceBlock,
  type IRResourceCommand,
  createEmptyConfig,
} from "./types";
import { parseExport } from "./parse";

function resource(
  path: string,
  command: IRResourceCommand,
  properties: { name: string; value: string }[]
): IRResourceBlock {
  return {
    kind: "resource",
    path,
    command,
    properties,
  };
}

function config(items: IRItem[]): RouterOSConfig {
  const c = createEmptyConfig();
  c.items = items;
  return c;
}

describe("renderScript", () => {
  describe("block rendering", () => {
    it("renders a block with nested items", () => {
      const c = config([
        {
          kind: "block",
          items: [
            { kind: "system", command: ':put "hello"' },
            resource("/interface bridge", "add", [{ name: "name", value: "br1" }]),
          ],
        },
      ]);
      const script = renderScript(c, { sortByDependency: false });
      expect(script).toContain("{");
      expect(script).toContain("}");
      expect(script).toContain(':put "hello"');
      expect(script).toContain("/interface bridge");
    });

    it("renders empty block", () => {
      const c = config([{ kind: "block", items: [{ kind: "comment", text: "" }] }]);
      const script = renderScript(c, { sortByDependency: false });
      // Empty comment renders as empty string, filtered out; block keeps its padding
      expect(script).toMatch(/^\{\s*\}\s*\n$/);
    });

    it("renders nested blocks with system commands in compact mode", () => {
      const c = config([
        {
          kind: "block",
          items: [
            { kind: "comment", text: "inside block" },
            { kind: "system", command: ':put "ok"' },
          ],
        },
      ]);
      // Compact mode filters top-level comments but blocks preserve inner content
      const script = renderScript(c, { compact: true, sortByDependency: false });
      expect(script).toContain(':put "ok"');
      expect(script).toContain("{");
      expect(script).toContain("}");
    });

    it("filters top-level comments in compact mode but not inside blocks", () => {
      const c = config([
        { kind: "comment", text: "top-level filtered" },
        {
          kind: "block",
          items: [
            { kind: "comment", text: "nested kept" },
            { kind: "system", command: ":put x" },
          ],
        },
      ]);
      const script = renderScript(c, { compact: true, sortByDependency: false });
      expect(script).not.toContain("top-level filtered");
      // Nested comments inside blocks are preserved (filterItems only acts on top level)
      expect(script).toContain("nested kept");
    });
  });

  describe("env rendering", () => {
    it("renders env set items", () => {
      const c = config([{ kind: "env", name: "SNMP-_COMMUNITY", value: "public" }]);
      const script = renderScript(c, { sortByDependency: false });
      expect(script).toContain("/env set SNMP-_COMMUNITY=public");
    });

    it("quotes env values with special chars", () => {
      const c = config([{ kind: "env", name: "TEST", value: "value with spaces" }]);
      const script = renderScript(c, { sortByDependency: false });
      expect(script).toContain('"value with spaces"');
    });

    it("sorts env items by /env priority", () => {
      const c = config([
        resource("/ip address", "add", [{ name: "address", value: "10.0.0.1/24" }]),
        { kind: "env", name: "VAR", value: "val" },
      ]);
      const script = renderScript(c);
      // /env (priority 10) should come before /ip address (priority 80)
      const envIdx = script.indexOf("/env set");
      const ipIdx = script.indexOf("/ip address");
      expect(envIdx).toBeLessThan(ipIdx);
    });
  });

  describe("identity rendering", () => {
    it("renders identity with simple name", () => {
      expect(renderIdentity("router1")).toBe("/system identity set name=router1");
    });

    it("renders identity with quoted name containing spaces", () => {
      const result = renderIdentity("my router");
      expect(result).toContain('"my router"');
    });

    it("renders identity at the top", () => {
      const c = config([
        resource("/system identity", "set", [{ name: "name", value: "my-router" }]),
        resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
      ]);
      c.identity = "my-router";
      const script = renderScript(c);
      expect(script).toContain("/system identity");
      expect(script).toContain("name=my-router");
    });
  });

  describe("order hint and comment sorting", () => {
    it("uses custom order hints when provided", () => {
      const c = config([
        resource("/ip address", "add", [{ name: "address", value: "10.0.0.1/24" }]),
        resource("/interface bridge", "add", [{ name: "name", value: "br1" }]),
      ]);
      c.orderHints = { "/interface": 999, "/ip": 1 };
      const script = renderScript(c);
      // /ip (custom 1) should come before /interface (custom 999)
      const ipIdx = script.indexOf("/ip address");
      const brIdx = script.indexOf("/interface bridge");
      expect(ipIdx).toBeLessThan(brIdx);
    });

    it("falls back to default hints when no custom", () => {
      const c = config([
        resource("/interface bridge", "add", [{ name: "name", value: "br1" }]),
        resource("/ip address", "add", [{ name: "address", value: "10.0.0.1/24" }]),
      ]);
      const script = renderScript(c);
      const brIdx = script.indexOf("/interface bridge");
      const ipIdx = script.indexOf("/ip address");
      expect(brIdx).toBeLessThan(ipIdx);
    });

    it("interleaves comments with sorted items", () => {
      const c = config([
        { kind: "comment", text: "Section 1" },
        resource("/ip address", "add", [{ name: "address", value: "10.0.0.1/24" }]),
        { kind: "comment", text: "Section 2" },
        resource("/interface bridge", "add", [{ name: "name", value: "br1" }]),
      ]);
      const script = renderScript(c);
      expect(script).toContain("# Section 1");
      expect(script).toContain("# Section 2");
    });

    it("renders items with default priority 500 (unknown paths)", () => {
      const c = config([
        { kind: "system", command: "/unknown resource test" },
        resource("/interface bridge", "add", [{ name: "name", value: "br1" }]),
      ]);
      const script = renderScript(c);
      expect(script).toContain("/interface bridge");
    });
  });

  describe("output formatting", () => {
    it("ends with a newline when items are present", () => {
      const c = config([resource("/interface bridge", "add", [{ name: "name", value: "br1" }])]);
      const script = renderScript(c, { sortByDependency: false });
      expect(script.endsWith("\n")).toBe(true);
    });

    it("returns empty string for empty config", () => {
      const c = createEmptyConfig();
      const script = renderScript(c);
      expect(script).toBe("");
    });

    it("handles config with only empty comments", () => {
      const c = config([{ kind: "comment", text: "" }]);
      const script = renderScript(c);
      expect(script).toBe("");
    });

    it("renders single item ends with newline", () => {
      const c = config([{ kind: "system", command: ":put test" }]);
      const script = renderScript(c);
      expect(script).toBe(":put test\n");
    });
  });

  describe("basic resource rendering", () => {
    it("renders a simple resource block", () => {
      const c = config([
        resource("/ip address", "add", [
          { name: "address", value: "192.168.1.1/24" },
          { name: "interface", value: "bridge1" },
        ]),
      ]);
      const script = renderScript(c);
      expect(script).toContain("/ip address");
      expect(script).toContain("add");
      expect(script).toContain("address=192.168.1.1/24");
      expect(script).toContain("interface=bridge1");
    });

    it("renders set with [find ...] query", () => {
      const block: IRResourceBlock = resource("/interface ethernet", "set", [
        { name: "disabled", value: "no" },
      ]);
      block.findQuery = [{ name: "default-name", value: "ether1" }];
      const c = config([block]);
      const script = renderScript(c);
      expect(script).toContain("/interface ethernet");
      expect(script).toContain("set");
      expect(script).toContain("[find default-name=ether1]");
      expect(script).toContain("disabled=no");
    });

    it("renders comments", () => {
      const c = config([
        { kind: "comment", text: "interfaces section" },
        resource("/interface bridge", "add", [{ name: "name", value: "bridge1" }]),
      ]);
      const script = renderScript(c);
      expect(script).toContain("# interfaces section");
    });

    it("renders system commands", () => {
      const c = config([{ kind: "system", command: ":delay 1s" }]);
      const script = renderScript(c);
      expect(script).toContain(":delay 1s");
    });
  });

  describe("quoting", () => {
    it("quotes values containing spaces", () => {
      const c = config([
        resource("/interface ethernet", "set", [{ name: "comment", value: "my interface" }]),
      ]);
      const block = c.items[0];
      if (block.kind === "resource") {
        block.findQuery = [{ name: "default-name", value: "ether1" }];
      }
      const script = renderScript(c);
      expect(script).toContain('"my interface"');
    });

    it("does not quote simple values", () => {
      const c = config([
        resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
      ]);
      const script = renderScript(c);
      expect(script).toContain("address=192.168.1.1/24");
      expect(script).not.toContain('"192.168.1.1/24"');
    });
  });

  describe("compact mode", () => {
    it("omits comments in compact mode", () => {
      const c = config([
        { kind: "comment", text: "interfaces section" },
        resource("/interface bridge", "add", [{ name: "name", value: "bridge1" }]),
      ]);
      const script = renderScript(c, { compact: true });
      expect(script).not.toContain("# interfaces section");
      expect(script).toContain("/interface bridge");
    });
  });

  describe("dependency ordering", () => {
    it("sorts items by dependency order when sortByDependency=true", () => {
      const c = config([
        resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
        resource("/interface bridge", "add", [{ name: "name", value: "bridge1" }]),
      ]);
      const script = renderScript(c, { sortByDependency: true });
      // Bridge (30) should come before IP address (80)
      const bridgeIdx = script.indexOf("/interface bridge");
      const ipIdx = script.indexOf("/ip address");
      expect(bridgeIdx).toBeLessThan(ipIdx);
    });

    it("preserves original order when sortByDependency=false", () => {
      const c = config([
        resource("/ip address", "add", [{ name: "address", value: "192.168.1.1/24" }]),
        resource("/interface bridge", "add", [{ name: "name", value: "bridge1" }]),
      ]);
      const script = renderScript(c, { sortByDependency: false });
      const bridgeIdx = script.indexOf("/interface bridge");
      const ipIdx = script.indexOf("/ip address");
      expect(ipIdx).toBeLessThan(bridgeIdx);
    });
  });

  describe("terse mode", () => {
    it("renders terse output", () => {
      const c = config([
        resource("/interface bridge", "add", [{ name: "name", value: "bridge1" }]),
      ]);
      const script = renderScript(c, { terse: true });
      expect(script).toContain("/interface bridge");
    });
  });

  describe("round-trip (parse -> render -> parse)", () => {
    it("preserves resource structure through a round trip", () => {
      const original = `
        /interface bridge add name=bridge1
        /interface ethernet set [find default-name=ether1] disabled=no
        /ip address add address=192.168.1.1/24 interface=bridge1
      `;
      const parsed = parseExport(original);
      const rendered = renderScript(parsed);
      const reParsed = parseExport(rendered);

      expect(reParsed.items).toHaveLength(parsed.items.length);
      const originalResources = parsed.items.filter(
        (item): item is IRResourceBlock => item.kind === "resource"
      );
      const reParsedResources = reParsed.items.filter(
        (item): item is IRResourceBlock => item.kind === "resource"
      );
      expect(reParsedResources).toHaveLength(originalResources.length);
    });

    it("preserves identity through a round trip", () => {
      const original = `/system identity set name=my-router
        /ip address add address=192.168.1.1/24 interface=bridge1`;
      const parsed = parseExport(original);
      const rendered = renderScript(parsed);
      const reParsed = parseExport(rendered);
      expect(reParsed.identity).toBe("my-router");
    });

    it("preserves comments through a round trip", () => {
      const original = `# interfaces
        /interface bridge add name=bridge1`;
      const parsed = parseExport(original);
      const rendered = renderScript(parsed);
      const reParsed = parseExport(rendered);
      const comments = reParsed.items.filter(
        (item): item is { kind: "comment"; text: string } => item.kind === "comment"
      );
      expect(comments.length).toBeGreaterThan(0);
    });
  });
});
