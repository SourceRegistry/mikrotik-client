/**
 * Intermediate Representation (IR) module for RouterOS `/export` configurations.
 *
 * Provides bidirectional parsing and rendering of RouterOS script text,
 * structural diff, and patch application.
 *
 * @module @sourceregistry/mikrotik-client/ir
 *
 * @example
 * ```ts
 * import { parseExport, diff, renderScript, applyPatch } from '@sourceregistry/mikrotik-client/ir';
 *
 * // Parse live config
 * const live = parseExport(await fetchLiveExport());
 *
 * // Parse desired config
 * const desired = parseExport(desiredExportText);
 *
 * // Compute diff
 * const patch = diff(live, desired);
 *
 * // Apply changes
 * const result = await applyPatch(transport, patch);
 * ```
 */

export {
  // Types
  type IRBlock,
  type IRComment,
  type IREnvSet,
  type IRItem,
  type IRItemKind,
  type IRProperty,
  type IRResourceBlock,
  type IRResourceCommand,
  type IRSystemCommand,
  type RouterOSConfig,
  // Constants
  IR_ITEM_KINDS,
  IR_RESOURCE_COMMANDS,
  // Helpers
  createEmptyConfig,
  isResourceBlock,
  isComment,
  isEnvSet,
  isSystemCommand,
  isBlock,
} from "./types";

export {
  // Parser
  parseExport,
  type ParseExportOptions,
  ParseExportError,
} from "./parse";

export {
  // Renderer
  renderScript,
  renderIdentity,
  quoteValue,
  needsQuoting,
  type RenderScriptOptions,
} from "./render";

export {
  // Diff and patch
  diff,
  applyPatch,
  renderPatch,
  type Patch,
  type PatchItem,
  type PatchOp,
  type PatchOperation,
  type PatchUpdate,
  type PropertyChange,
  type ApplyResult,
  type ApplyPatchOptions,
  isPatchEmpty,
  patchSize,
} from "./diff";
