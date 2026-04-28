import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { createDeferred, withTimeout, type Deferred } from "../shared";
import type { RouterOSAttributes, RouterOSPrimitive } from "./index";

export type RouterOSSshProcess = ChildProcessWithoutNullStreams & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
};

export type RouterOSSshSpawn = (
  command: string,
  args: readonly string[],
  options: { signal?: AbortSignal }
) => RouterOSSshProcess;

export type RouterOSSshClientOptions = {
  host: string;
  username?: string;
  port?: number;
  sshPath?: string;
  identityFile?: string | Blob;
  knownHostsFile?: string;
  /**
   * Defaults to "accept-new" so first-time hosts are recorded and changed host
   * keys still fail instead of silently accepting a possible MITM.
   */
  strictHostKeyChecking?: boolean | "accept-new";
  connectTimeoutMs?: number;
  timeoutMs?: number;
  batchMode?: boolean;
  extraArgs?: readonly string[];
  spawn?: RouterOSSshSpawn;
};

export type RouterOSSshCommandOptions = {
  words?: readonly string[];
  attributes?: RouterOSAttributes;
  timeoutMs?: number;
  signal?: AbortSignal;
  stdin?: string | Buffer;
  rejectOnNonZeroExit?: boolean;
};

export type RouterOSSshCommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export class RouterOSSshCommandError extends Error {
  public constructor(public readonly result: RouterOSSshCommandResult) {
    const details = result.stderr.trim() || result.stdout.trim();
    super(
      details
        ? `RouterOS SSH command failed with exit code ${result.exitCode}: ${details}`
        : `RouterOS SSH command failed with exit code ${result.exitCode}`
    );
    this.name = "RouterOSSshCommandError";
  }
}

function normalizeSshValue(value: RouterOSPrimitive): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSshValue(item) ?? "").join(",");
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function quoteRouterOSValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(value)) {
    return value;
  }

  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatRouterOSSshCommand(
  command: string,
  options: {
    words?: readonly string[];
    attributes?: RouterOSAttributes;
  } = {}
): string {
  const normalizedCommand = command.startsWith("/") ? command : `/${command}`;
  const words = [normalizedCommand, ...(options.words ?? [])];
  for (const [key, value] of Object.entries(options.attributes ?? {})) {
    const normalizedValue = normalizeSshValue(value);
    if (normalizedValue === undefined) continue;
    words.push(`${key}=${quoteRouterOSValue(normalizedValue)}`);
  }

  return words.join(" ");
}

function createSshArgs(
  options: RouterOSSshClientOptions,
  remoteCommand: string,
  identityFilePath?: string
): string[] {
  const args: string[] = [];

  if (options.port !== undefined) {
    args.push("-p", String(options.port));
  }

  if (identityFilePath) {
    args.push("-i", identityFilePath);
  }

  if (options.knownHostsFile) {
    args.push("-o", `UserKnownHostsFile=${options.knownHostsFile}`);
  }

  const strictHostKeyChecking = options.strictHostKeyChecking ?? "accept-new";
  args.push(
    "-o",
    `StrictHostKeyChecking=${
      typeof strictHostKeyChecking === "boolean"
        ? strictHostKeyChecking
          ? "yes"
          : "no"
        : strictHostKeyChecking
    }`
  );

  if (options.connectTimeoutMs !== undefined) {
    args.push("-o", `ConnectTimeout=${Math.ceil(options.connectTimeoutMs / 1000)}`);
  }

  if (options.batchMode ?? true) {
    args.push("-o", "BatchMode=yes");
  }

  args.push(...(options.extraArgs ?? []));

  const target = options.username ? `${options.username}@${options.host}` : options.host;
  args.push(target, remoteCommand);
  return args;
}

async function materializeIdentityFile(
  identityFile: RouterOSSshClientOptions["identityFile"]
): Promise<{ path?: string; cleanup: () => Promise<void> }> {
  if (!identityFile) {
    return { cleanup: async () => undefined };
  }

  if (typeof identityFile === "string") {
    return { path: identityFile, cleanup: async () => undefined };
  }

  const directory = await mkdtemp(join(tmpdir(), "mikrotik-client-ssh-"));
  const path = join(directory, "identity");
  await chmod(directory, 0o700).catch(() => undefined);
  await writeFile(path, Buffer.from(await identityFile.arrayBuffer()), {
    mode: 0o600,
  });
  await chmod(path, 0o600).catch(() => undefined);

  return {
    path,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export class RouterOSSshClient {
  public constructor(public readonly options: RouterOSSshClientOptions) {}

  async execute(
    command: string,
    options: RouterOSSshCommandOptions = {}
  ): Promise<RouterOSSshCommandResult> {
    const remoteCommand = formatRouterOSSshCommand(command, {
      ...(options.words !== undefined && { words: options.words }),
      ...(options.attributes !== undefined && { attributes: options.attributes }),
    });
    const materializedIdentity = await materializeIdentityFile(this.options.identityFile);
    const args = createSshArgs(
      this.options,
      remoteCommand,
      materializedIdentity.path
    );
    const spawnProcess: RouterOSSshSpawn =
      this.options.spawn ??
      ((nextCommand, nextArgs, nextOptions) =>
        spawn(nextCommand, nextArgs, nextOptions) as RouterOSSshProcess);
    const child = spawnProcess(this.options.sshPath ?? "ssh", args, {
      ...(options.signal !== undefined && { signal: options.signal }),
    });
    const deferred: Deferred<RouterOSSshCommandResult> =
      createDeferred<RouterOSSshCommandResult>();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      deferred.reject(error);
    });
    child.once("close", (exitCode, signal) => {
      deferred.resolve({
        command: remoteCommand,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }

    try {
      const result = await withTimeout(
        deferred.promise,
        options.timeoutMs ?? this.options.timeoutMs,
        `RouterOS SSH command timed out for ${remoteCommand}`,
        () => child.kill()
      );

      if (result.exitCode !== 0 && (options.rejectOnNonZeroExit ?? true)) {
        throw new RouterOSSshCommandError(result);
      }

      return result;
    } finally {
      await materializedIdentity.cleanup();
    }
  }
}
