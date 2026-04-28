import { describe, expect, it } from "vitest";
import {
  parseBool,
  parseDuration,
  parseInteger,
  parseList,
  serializeBool,
  serializeDuration,
  serializeInteger,
  serializeList,
} from "./codecs";

describe("parseBool", () => {
  it("parses REST API 'true'", () => expect(parseBool("true")).toBe(true));
  it("parses REST API 'false'", () => expect(parseBool("false")).toBe(false));
  it("parses binary API 'yes'", () => expect(parseBool("yes")).toBe(true));
  it("parses binary API 'no'", () => expect(parseBool("no")).toBe(false));
  it("treats unknown value as false", () => expect(parseBool("maybe")).toBe(false));
});

describe("serializeBool", () => {
  it("serializes true", () => expect(serializeBool(true)).toBe("true"));
  it("serializes false", () => expect(serializeBool(false)).toBe("false"));
});

describe("parseBool / serializeBool round-trip", () => {
  it("true round-trips", () => expect(parseBool(serializeBool(true))).toBe(true));
  it("false round-trips", () => expect(parseBool(serializeBool(false))).toBe(false));
});

describe("parseInteger", () => {
  it("parses positive integer", () => expect(parseInteger("1500")).toBe(1500));
  it("parses zero", () => expect(parseInteger("0")).toBe(0));
  it("parses negative integer", () => expect(parseInteger("-1")).toBe(-1));
  it("returns NaN for non-numeric", () => expect(parseInteger("abc")).toBeNaN());
  it("ignores trailing non-digits", () => expect(parseInteger("100ms")).toBe(100));
});

describe("serializeInteger", () => {
  it("serializes integer", () => expect(serializeInteger(42)).toBe("42"));
  it("truncates decimals", () => expect(serializeInteger(3.9)).toBe("3"));
});

describe("parseInteger / serializeInteger round-trip", () => {
  it("1500 round-trips", () => expect(parseInteger(serializeInteger(1500))).toBe(1500));
  it("0 round-trips", () => expect(parseInteger(serializeInteger(0))).toBe(0));
});

describe("parseList", () => {
  it("parses comma-separated list", () =>
    expect(parseList("ether1,ether2,ether3")).toEqual(["ether1", "ether2", "ether3"]));
  it("returns empty array for empty string", () => expect(parseList("")).toEqual([]));
  it("parses single item", () => expect(parseList("ether1")).toEqual(["ether1"]));
});

describe("serializeList", () => {
  it("joins with comma", () => expect(serializeList(["a", "b", "c"])).toBe("a,b,c"));
  it("empty array produces empty string", () => expect(serializeList([])).toBe(""));
});

describe("parseList / serializeList round-trip", () => {
  it("list round-trips", () => {
    const list = ["ether1", "ether2", "ether3"];
    expect(parseList(serializeList(list))).toEqual(list);
  });
});

describe("parseDuration", () => {
  it("parses seconds only", () => expect(parseDuration("30s")).toBe(30));
  it("parses minutes and seconds", () => expect(parseDuration("1m30s")).toBe(90));
  it("parses hours", () => expect(parseDuration("1h")).toBe(3600));
  it("parses days", () => expect(parseDuration("1d")).toBe(86400));
  it("parses weeks", () => expect(parseDuration("1w")).toBe(604800));
  it("parses compound duration", () =>
    expect(parseDuration("1w2d3h4m5s")).toBe(
      604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5
    ));
  it("returns NaN for invalid input", () => expect(parseDuration("invalid")).toBeNaN());
  it("returns NaN for partial match", () => expect(parseDuration("1x")).toBeNaN());
});

describe("serializeDuration", () => {
  it("serializes zero as '0s'", () => expect(serializeDuration(0)).toBe("0s"));
  it("serializes seconds", () => expect(serializeDuration(45)).toBe("45s"));
  it("serializes minutes and seconds", () => expect(serializeDuration(90)).toBe("1m30s"));
  it("serializes hours", () => expect(serializeDuration(3600)).toBe("1h"));
  it("serializes compound duration", () =>
    expect(serializeDuration(604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5)).toBe(
      "1w2d3h4m5s"
    ));
});

describe("parseDuration / serializeDuration round-trip", () => {
  it("0 round-trips", () => expect(parseDuration(serializeDuration(0))).toBe(0));
  it("complex duration round-trips", () => {
    const seconds = 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5;
    expect(parseDuration(serializeDuration(seconds))).toBe(seconds);
  });
});
