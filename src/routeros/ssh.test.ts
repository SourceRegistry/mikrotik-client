import { EventEmitter } from "node:events";
import { access, readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  formatRouterOSSshCommand,
  RouterOSSshClient,
  RouterOSSshCommandError,
  type RouterOSSshSpawn,
} from "./ssh";

function createMockSpawn(
  handler: (call: {
    command: string;
    args: readonly string[];
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    child: EventEmitter & { kill: () => boolean };
  }) => void | Promise<void>
): RouterOSSshSpawn {
  return (command, args) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {
      child.emit("close", null, "SIGTERM");
      return true;
    };

    queueMicrotask(async () => {
      await handler({ command, args, stdin, stdout, stderr, child });
    });

    return child as ReturnType<RouterOSSshSpawn>;
  };
}

describe("RouterOSSshClient", () => {
  it("formats RouterOS CLI commands with normalized values", () => {
    expect(
      formatRouterOSSshCommand("ip/address/add", {
        words: ["terse"],
        attributes: {
          address: "192.168.88.10/24",
          interface: "bridge",
          disabled: false,
          comment: "office uplink",
          list: ["ether1", "ether2"],
          empty: null,
          skip: undefined,
        },
      })
    ).toBe(
      '/ip/address/add terse address=192.168.88.10/24 interface=bridge disabled=no comment="office uplink" list=ether1,ether2 empty='
    );
  });

  it("executes commands through the ssh binary without shell interpolation", async () => {
    let capturedArgs: readonly string[] = [];
    const client = new RouterOSSshClient({
      host: "192.168.88.1",
      username: "admin",
      port: 2222,
      identityFile: "id_routeros",
      spawn: createMockSpawn(({ command, args, stdout, stderr, child }) => {
        capturedArgs = args;
        expect(command).toBe("ssh");
        stdout.write("uptime: 1d2h\n");
        stderr.end();
        stdout.end();
        child.emit("close", 0, null);
      }),
    });

    const result = await client.execute("/system/resource/print", {
      words: ["terse"],
    });

    expect(capturedArgs).toEqual([
      "-p",
      "2222",
      "-i",
      "id_routeros",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "BatchMode=yes",
      "admin@192.168.88.1",
      "/system/resource/print terse",
    ]);
    expect(result.stdout).toBe("uptime: 1d2h\n");
  });

  it("allows strict host key checking to be hardened or relaxed explicitly", async () => {
    const calls: readonly string[][] = [];
    const capturedCalls = calls as string[][];
    const spawn = createMockSpawn(({ args, stdout, stderr, child }) => {
      capturedCalls.push([...args]);
      stdout.end();
      stderr.end();
      child.emit("close", 0, null);
    });

    await new RouterOSSshClient({
      host: "router.example.com",
      strictHostKeyChecking: true,
      spawn,
    }).execute("/system/identity/print");

    await new RouterOSSshClient({
      host: "router.example.com",
      strictHostKeyChecking: false,
      spawn,
    }).execute("/system/identity/print");

    expect(capturedCalls[0]).toContain("StrictHostKeyChecking=yes");
    expect(capturedCalls[1]).toContain("StrictHostKeyChecking=no");
  });

  it("materializes Blob identity files for the lifetime of the command", async () => {
    let identityPath = "";
    const client = new RouterOSSshClient({
      host: "router.example.com",
      identityFile: new Blob(["PRIVATE KEY DATA"]),
      spawn: createMockSpawn(async ({ args, stdout, stderr, child }) => {
        const identityIndex = args.indexOf("-i");
        expect(identityIndex).toBeGreaterThanOrEqual(0);
        identityPath = args[identityIndex + 1] ?? "";
        expect(await readFile(identityPath, "utf8")).toBe("PRIVATE KEY DATA");
        stdout.end();
        stderr.end();
        child.emit("close", 0, null);
      }),
    });

    await client.execute("/system/identity/print");
    await expect(access(identityPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-zero commands with stderr context", async () => {
    const client = new RouterOSSshClient({
      host: "router.example.com",
      spawn: createMockSpawn(({ stdout, stderr, child }) => {
        stdout.end();
        stderr.write("failure: no such command\n");
        stderr.end();
        child.emit("close", 1, null);
      }),
    });

    await expect(client.execute("/bad/command")).rejects.toBeInstanceOf(
      RouterOSSshCommandError
    );
  });
});
