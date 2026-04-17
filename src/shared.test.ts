import { describe, expect, it } from "vitest";
import { SentenceDecoder, encodeSentence } from "./shared";

describe("RouterOS sentence codec", () => {
  it("encodes and decodes sentences across chunk boundaries", () => {
    const decoder = new SentenceDecoder();
    const encoded = encodeSentence(["/system/resource/print", "=name=router1", ".tag=7"]);

    const first = decoder.push(encoded.subarray(0, 5));
    const second = decoder.push(encoded.subarray(5));

    expect(first).toEqual([]);
    expect(second).toEqual([
      ["/system/resource/print", "=name=router1", ".tag=7"],
    ]);
  });
});
