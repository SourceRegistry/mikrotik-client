import type {
  RouterOSCommandOptions,
  RouterOSCommandResult,
  RouterOSListenOptions,
  RouterOSRecord,
  RouterOSStream,
} from "./index";

/**
 * Common interface implemented by all RouterOS transport clients
 * (`RouterOSClient`, `RouterOSRestClient`).
 *
 * Resource helpers accept this interface so they work with any transport
 * without modification.
 *
 * @example
 * ```ts
 * import { createRouterOSHelpers } from "@sourceregistry/mikrotik-client/routeros";
 *
 * // Works with both API and REST transport:
 * const helpers = createRouterOSHelpers(transport);
 * const interfaces = await helpers.interface.list();
 * ```
 */
export interface DeviceTransport {
  /**
   * Execute a RouterOS command and return the full result.
   *
   * @param command - RouterOS command path (e.g. `/ip/address/add`)
   * @param options - Command options (attributes, queries, timeout, signal)
   */
  execute(command: string, options?: RouterOSCommandOptions): Promise<RouterOSCommandResult>;

  /**
   * Execute a RouterOS print command and return records.
   *
   * @param command - RouterOS resource path (e.g. `/ip/address`)
   * @param options - Print options (proplist via attributes, queries, timeout, signal)
   */
  print(command: string, options?: RouterOSCommandOptions): Promise<RouterOSRecord[]>;

  /**
   * Start a RouterOS listen command and return an async stream.
   *
   * Not supported by all transports — `RouterOSRestClient` throws
   * `RouterOSRestProtocolError` with code `"protocol_violation"`.
   *
   * @param command - RouterOS listen path (e.g. `/interface/listen`)
   * @param options - Listen options
   */
  listen(command: string, options?: RouterOSListenOptions): Promise<RouterOSStream>;
}
