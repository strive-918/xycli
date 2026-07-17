// ============================================================================
// Built-in Tools — register all M1 tools
// ============================================================================

import type { ToolRegistry } from "./registry.js";
import { FileReadTool } from "./file-read.js";
import { FileWriteTool } from "./file-write.js";
import { TerminalExecTool } from "./terminal-exec.js";

/**
 * Register all built-in M1 tools on the given registry.
 */
export function registerBuiltins(registry: ToolRegistry): void {
  registry.register(new FileReadTool());
  registry.register(new FileWriteTool());
  registry.register(new TerminalExecTool());
}
