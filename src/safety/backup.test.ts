import { describe, expect, it, vi } from "vitest";
import { saveBackup, removeBackup, importExport, listBackups } from "./backup";
import type { DeviceTransport } from "../routeros/transport";

function createMockTransport(): DeviceTransport {
  return {
    execute: vi.fn().mockResolvedValue({ tag: "test", records: [], traps: [] }),
    print: vi.fn().mockResolvedValue([]),
    listen: vi.fn().mockResolvedValue({
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    }),
  };
}

describe("saveBackup", () => {
  it("executes /export with file attribute", async () => {
    const transport = createMockTransport();
    await saveBackup(transport, "pre-backup");
    expect(transport.execute).toHaveBeenCalledWith("/export", {
      attributes: { file: "pre-backup" },
      signal: undefined,
      timeoutMs: undefined,
    });
  });

  it("passes signal and timeoutMs", async () => {
    const transport = createMockTransport();
    const signal = new AbortController().signal;
    await saveBackup(transport, "backup", { signal, timeoutMs: 30000 });
    expect(transport.execute).toHaveBeenCalledWith("/export", {
      attributes: { file: "backup" },
      signal,
      timeoutMs: 30000,
    });
  });
});

describe("removeBackup", () => {
  it("executes /file/remove with query", async () => {
    const transport = createMockTransport();
    await removeBackup(transport, "pre-backup");
    expect(transport.execute).toHaveBeenCalledWith("/file/remove", {
      queries: ["name=pre-backup.rsc"],
      signal: undefined,
      timeoutMs: undefined,
    });
  });
});

describe("importExport", () => {
  it("requires confirm: true", async () => {
    const transport = createMockTransport();
    // @ts-expect-error testing missing confirm
    await expect(importExport(transport, "backup", {})).rejects.toThrow("confirm: true");
  });

  it("executes /import with confirm", async () => {
    const transport = createMockTransport();
    await importExport(transport, "backup", { confirm: true });
    expect(transport.execute).toHaveBeenCalledWith("/import", {
      attributes: { file: "backup.rsc" },
      signal: undefined,
      timeoutMs: undefined,
    });
  });
});

describe("listBackups", () => {
  it("lists .rsc files", async () => {
    const transport = createMockTransport();
    vi.mocked(transport.print).mockResolvedValue([
      { name: "pre-a1b2c3d4.rsc", size: "1024" },
      { name: "other.txt", size: "512" },
    ]);
    const results = await listBackups(transport);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("pre-a1b2c3d4.rsc");
  });

  it("filters by prefix", async () => {
    const transport = createMockTransport();
    vi.mocked(transport.print).mockResolvedValue([]);
    await listBackups(transport, "cc-");
    expect(transport.print).toHaveBeenCalledWith("/file", {
      queries: ["name~^cc-"],
      signal: undefined,
      timeoutMs: undefined,
    });
  });
});
