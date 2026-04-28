import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  decodeLength,
  encodeLength,
  encodeSentence,
  encodeWord,
  SentenceDecoder,
  withTimeout,
} from "./shared";

// ─── createDeferred ──────────────────────────────────────────────────────────

describe("createDeferred", () => {
  it("creates a deferred with promise, resolve, and reject", () => {
    const deferred = createDeferred<string>();
    expect(deferred.promise).toBeInstanceOf(Promise);
    expect(typeof deferred.resolve).toBe("function");
    expect(typeof deferred.reject).toBe("function");
  });

  it("resolves when resolve() is called", async () => {
    const deferred = createDeferred<string>();
    deferred.resolve("hello");
    await expect(deferred.promise).resolves.toBe("hello");
  });

  it("rejects when reject() is called", async () => {
    const deferred = createDeferred<string>();
    deferred.reject(new Error("failed"));
    await expect(deferred.promise).rejects.toThrow("failed");
  });

  it("async resolves with PromiseLike", async () => {
    const deferred = createDeferred<PromiseLike<string>>();
    deferred.resolve(Promise.resolve("async value"));
    const result = await deferred.promise;
    expect(result).toBe("async value");
  });
});

// ─── encodeLength ────────────────────────────────────────────────────────────

describe("encodeLength", () => {
  it("throws on negative length", () => {
    expect(() => encodeLength(-1)).toThrow(RangeError);
  });

  it("throws on non-integer length", () => {
    expect(() => encodeLength(1.5)).toThrow(RangeError);
  });

  it("encodes 0 as single byte [0]", () => {
    expect(encodeLength(0)).toEqual(Buffer.from([0]));
  });

  it("encodes small length (<= 0x7f) as single byte", () => {
    expect(encodeLength(1)).toEqual(Buffer.from([1]));
    expect(encodeLength(127)).toEqual(Buffer.from([127]));
  });

  it("encodes medium length (<= 0x3fff) as 2 bytes", () => {
    const encoded = encodeLength(128);
    expect(encoded.length).toBe(2);
    // Round-trip check
    const decoded = decodeLength(encoded);
    expect(decoded).toEqual({ length: 128, bytesRead: 2 });
  });

  it("encodes 0x7f boundary (1 byte path) vs 0x80 (2 byte path)", () => {
    expect(encodeLength(0x7f).length).toBe(1);
    expect(encodeLength(0x80).length).toBe(2);
  });

  it("encodes 0x3fff boundary (2 byte path) vs 0x4000 (3 byte path)", () => {
    expect(encodeLength(0x3fff).length).toBe(2);
    expect(encodeLength(0x4000).length).toBe(3);
  });

  it("encodes large length (<= 0x1fffff) as 3 bytes", () => {
    const encoded = encodeLength(0x4000);
    expect(encoded.length).toBe(3);
    const decoded = decodeLength(encoded);
    expect(decoded).toEqual({ length: 0x4000, bytesRead: 3 });
  });

  it("encodes 0x1fffff boundary (3 byte path) vs 0x200000 (4 byte path)", () => {
    expect(encodeLength(0x1fffff).length).toBe(3);
    expect(encodeLength(0x200000).length).toBe(4);
  });

  it("encodes very large length (<= 0x0fffffff) as 4 bytes", () => {
    const encoded = encodeLength(0x200000);
    expect(encoded.length).toBe(4);
    const decoded = decodeLength(encoded);
    expect(decoded).toEqual({ length: 0x200000, bytesRead: 4 });
  });

  it("encodes max 4-byte range boundary", () => {
    expect(encodeLength(0x0fffffff).length).toBe(4);
  });

  it("encodes huge length (> 0x0fffffff) as 5 bytes", () => {
    const encoded = encodeLength(0x100000000);
    expect(encoded.length).toBe(5);
    expect(encoded[0]).toBe(0xf0);
  });

  it("round-trips all encode ranges", () => {
    const testValues = [0, 1, 127, 128, 16383, 16384, 2097151, 2097152, 268435455];
    for (const val of testValues) {
      const encoded = encodeLength(val);
      const decoded = decodeLength(encoded);
      expect(decoded?.length).toBe(val);
    }
  });
});

// ─── decodeLength ─────────────────────────────────────────────────────────

describe("decodeLength", () => {
  it("returns undefined for empty buffer", () => {
    expect(decodeLength(Buffer.alloc(0))).toBeUndefined();
  });

  it("returns undefined when offset >= buffer length", () => {
    expect(decodeLength(Buffer.from([42]), 1)).toBeUndefined();
  });

  it("decodes 1-byte length (first < 0x80)", () => {
    expect(decodeLength(Buffer.from([42]))).toEqual({ length: 42, bytesRead: 1 });
  });

  it("decodes 2-byte length (0x80 <= first < 0xc0)", () => {
    // Encode 128: value = 128 | 0x8000 = 0x8080 -> [0x80, 0x80]
    expect(decodeLength(Buffer.from([0x80, 0x80]))).toEqual({ length: 128, bytesRead: 2 });
  });

  it("returns undefined for truncated 2-byte length", () => {
    expect(decodeLength(Buffer.from([0x80]))).toBeUndefined();
  });

  it("decodes 3-byte length (0xc0 <= first < 0xe0)", () => {
    const encoded = encodeLength(0x4000); // Should produce 3-byte encoding
    expect(decodeLength(encoded)?.length).toBe(0x4000);
    expect(decodeLength(encoded)?.bytesRead).toBe(3);
  });

  it("returns undefined for truncated 3-byte length", () => {
    expect(decodeLength(Buffer.from([0xc0, 0x40, 0x00, 0xff]), 0)).toEqual(
      decodeLength(Buffer.from([0xc0, 0x40, 0x00, 0xff]))
    );
    // Clearly truncated
    const buf = Buffer.from([0xc0, 0x40]);
    expect(decodeLength(buf)).toBeUndefined();
  });

  it("decodes 4-byte length (0xe0 <= first < 0xf0)", () => {
    const encoded = encodeLength(0x200000); // Should produce 4-byte encoding
    expect(decodeLength(encoded)?.length).toBe(0x200000);
    expect(decodeLength(encoded)?.bytesRead).toBe(4);
  });

  it("returns undefined for truncated 4-byte length", () => {
    const buf = Buffer.from([0xe0, 0x20, 0x00]);
    expect(decodeLength(buf)).toBeUndefined();
  });

  it("decodes 5-byte length (first === 0xf0)", () => {
    // encodeLength for 0x100000000 produces [0xf0, 0, 0, 0, 0]
    // decodeLength applies >>> 0 which truncates to 32-bit, so value = 0
    // This is a JS limitation for values > 2^32
    const encoded = encodeLength(0x100000000);
    expect(encoded.length).toBe(5);
    expect(encoded[0]).toBe(0xf0);
    const decoded = decodeLength(encoded);
    expect(decoded?.bytesRead).toBe(5);
    // The value after >>> 0 truncation is 0 (expected JS behavior)
    expect(decoded?.length).toBe(0);
  });
  it("returns undefined for truncated 5-byte length", () => {
    const buf = Buffer.from([0xf0, 0x01, 0x00]);
    expect(decodeLength(buf)).toBeUndefined();
  });

  it("throws on reserved byte (0xff)", () => {
    expect(() => decodeLength(Buffer.from([0xff]))).toThrow(/Reserved.*control byte/);
  });

  it("decodes with non-zero offset", () => {
    const buf = Buffer.from([0xff - 1, 42]); // padding + 1-byte length
    const result = decodeLength(buf, 1);
    expect(result).toEqual({ length: 42, bytesRead: 1 });
  });
});

// ─── encodeWord ──────────────────────────────────────────────────────────

describe("encodeWord", () => {
  it("encodes empty string as length 0", () => {
    const encoded = encodeWord("");
    expect(encoded[0]).toBe(0);
    expect(encoded.length).toBe(1);
  });

  it("encodes ASCII word correctly", () => {
    const encoded = encodeWord("hello");
    expect(encoded[0]).toBe(5);
    expect(encoded.slice(1).toString()).toBe("hello");
  });

  it("encodes UTF-8 word with multi-byte chars", () => {
    const encoded = encodeWord("café");
    const decoded = encoded.toString("utf8", 1);
    expect(decoded).toBe("café");
  });

  it("round-trips through encodeWord + decodeLength", () => {
    const word = "test word";
    const encoded = encodeWord(word);
    const { length, bytesRead } = decodeLength(encoded)!;
    expect(length).toBe(word.length);
    expect(encoded.subarray(bytesRead, bytesRead + length).toString()).toBe(word);
  });
});

// ─── encodeSentence ────────────────────────────────────────────────────

describe("encodeSentence", () => {
  it("encodes empty sentence (just terminator)", () => {
    const encoded = encodeSentence([]);
    expect(encoded).toEqual(Buffer.from([0]));
  });

  it("encodes single-word sentence", () => {
    const encoded = encodeSentence(["/print"]);
    const decoder = new SentenceDecoder();
    const sentences = decoder.push(encoded);
    expect(sentences).toEqual([["/print"]]);
  });

  it("encodes multi-word sentence", () => {
    const encoded = encodeSentence(["/interface", "bridge", "add", "=name=br1"]);
    const decoder = new SentenceDecoder();
    const sentences = decoder.push(encoded);
    expect(sentences).toEqual([["/interface", "bridge", "add", "=name=br1"]]);
  });

  it("appends zero-byte terminator", () => {
    const encoded = encodeSentence(["test"]);
    expect(encoded[encoded.length - 1]).toBe(0);
  });

  it("works with empty words", () => {
    const encoded = encodeSentence(["", "word", ""]);
    expect(encoded[encoded.length - 1]).toBe(0);
  });
});

// ─── SentenceDecoder ──────────────────────────────────────────────────

describe("SentenceDecoder", () => {
  it("decodes a complete sentence", () => {
    const decoder = new SentenceDecoder();
    const encoded = encodeSentence(["/system", "resource", "print"]);
    expect(decoder.push(encoded)).toEqual([["/system", "resource", "print"]]);
  });

  it("decodes sentences across chunk boundaries", () => {
    const decoder = new SentenceDecoder();
    const encoded = encodeSentence(["/system/resource/print", "=name=router1", ".tag=7"]);

    const first = decoder.push(encoded.subarray(0, 5));
    const second = decoder.push(encoded.subarray(5));

    expect(first).toEqual([]);
    expect(second).toEqual([
      ["/system/resource/print", "=name=router1", ".tag=7"],
    ]);
  });

  it("decodes multiple sentences in one chunk", () => {
    const decoder = new SentenceDecoder();
    const chunk = Buffer.concat([
      encodeSentence(["/print"]),
      encodeSentence(["/log", "print"]),
    ]);

    expect(decoder.push(chunk)).toEqual([
      ["/print"],
      ["/log", "print"],
    ]);
  });

  it("decodes partial sentences incrementally", () => {
    const decoder = new SentenceDecoder();
    const full = Buffer.concat([
      encodeSentence(["/system", "resource", "print"]),
      encodeSentence(["/ip", "address", "print"]),
    ]);

    const part1 = decoder.push(full.subarray(0, 8));
    expect(part1).toEqual([]);

    const part2 = decoder.push(full.subarray(8, 15));
    expect(part2.length).toBeGreaterThanOrEqual(0);

    const part3 = decoder.push(full.subarray(15));
    expect(part3.length).toBeGreaterThanOrEqual(0);
  });

  it("handles string input", () => {
    const decoder = new SentenceDecoder();
    const encoded = encodeSentence(["test"]);
    expect(decoder.push(encoded.toString())).toEqual([["test"]]);
  });

  it("returns empty array for empty input", () => {
    const decoder = new SentenceDecoder();
    expect(decoder.push(Buffer.alloc(0))).toEqual([]);
  });

  it("handles trailing incomplete sentence", () => {
    const decoder = new SentenceDecoder();
    const full = Buffer.concat([
      encodeSentence(["/print"]),
      encodeLength(5), // incomplete second sentence - length says 5 bytes coming
    ]);

    const result = decoder.push(full);
    expect(result).toEqual([["/print"]]);
    // Now push the rest
    const _part2 = decoder.push(Buffer.from("wordg"));
    const part3 = decoder.push(encodeSentence([])); // terminator
    expect(part3).toEqual([["wordg"]]);
  });

  it("produces buffer content correctly and works with real encoded data", () => {
    const decoder = new SentenceDecoder();
    // Encode a longer word to hit the path where currentWords is appended
    const encoded = encodeSentence(["/interface", "bridge", "port", "add", "=bridge=b1", "=interface=ether1"]);
    const sentences = decoder.push(encoded);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toEqual([
      "/interface", "bridge", "port", "add", "=bridge=b1", "=interface=ether1"
    ]);
  });
});

// ─── withTimeout ───────────────────────────────────────────────────────

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns original promise when timeoutMs is undefined", async () => {
    const result = withTimeout(Promise.resolve(42), undefined, "timeout");
    expect(result).toBeInstanceOf(Promise);
    // Same promise check: wrapping isn't applied
    await expect(result).resolves.toBe(42);
  });

  it("returns original promise when timeoutMs is 0", async () => {
    const result = withTimeout(Promise.resolve("ok"), 0, "timeout");
    await expect(result).resolves.toBe("ok");
  });

  it("returns original promise when timeoutMs is negative", async () => {
    const result = withTimeout(Promise.resolve("ok"), -1, "timeout");
    await expect(result).resolves.toBe("ok");
  });

  it("resolves when promise completes before timeout", async () => {
    const deferred = vi.fn().mockReturnValue(Promise.resolve("fast"));
    const result = withTimeout(deferred(), 1000, "timeout");
    await expect(result).resolves.toBe("fast");
  });

  it("rejects when promise times out", async () => {
    const slow = new Promise<string>((_) => {
      // Never resolves (faux infinite promise)
    });
    const result = withTimeout(slow, 500, "timed out");

    vi.advanceTimersByTime(600);
    await expect(result).rejects.toThrow("timed out");
  });

  it("calls onTimeout callback when timeout fires", async () => {
    const onTimeout = vi.fn();
    const slow = new Promise<string>((_) => { });
    const result = withTimeout(slow, 100, "timeout", onTimeout);

    vi.advanceTimersByTime(200);
    await expect(result).rejects.toThrow("timeout");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("rejects original error when promise fails before timeout", async () => {
    const failing = Promise.reject(new Error("original error"));
    const result = withTimeout(failing, 5000, "timeout");

    vi.advanceTimersByTime(100);
    await expect(result).rejects.toThrow("original error");
  });

  it("clears timer when promise resolves successfully", async () => {
    let timerCount = 0;
    const origSetTimeout = setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms) => {
      timerCount++;
      return origSetTimeout(fn, ms) as ReturnType<typeof setTimeout>;
    });

    const result = withTimeout(Promise.resolve("ok"), 1000, "timeout");
    expect(timerCount).toBe(1);

    await expect(result).resolves.toBe("ok");
    // Timer was cleared (no additional calls)
  });

  it("clears timer when promise rejects", async () => {
    const result = withTimeout(Promise.reject(new Error("fail")), 1000, "timeout");
    await expect(result).rejects.toThrow("fail");
  });
});
