// ============================================================================
// Tool Registry — centralized tool registration and execution
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import type { ITool, ToolResult, ToolExecutionContext } from "./types.js";
import type { PermissionLevel } from "../core/types.js";
import type { StructuredLogger } from "./types.js";
import { ToolError } from "../core/errors.js";

// ---------------------------------------------------------------------------
// Minimal permission policy for M1 (full policy in M9)
// ---------------------------------------------------------------------------

function defaultPolicy() {
  return {
    mode: "ask" as const,
    defaultLevel: "read-only" as PermissionLevel,
    allow: { commands: [], paths: [], domains: [], tools: [], mcpServers: [], plugins: [] },
    deny: { commands: [], paths: [], domains: [], tools: [], mcpServers: [], plugins: [] },
    secretPatterns: [] as RegExp[],
  };
}

function defaultLogger(): StructuredLogger {
  return {
    info: (_msg, _data?) => {},
    warn: (_msg, _data?) => {},
    error: (_msg, _data?) => {},
  };
}

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export interface ToolRegistry {
  register(tool: ITool): void;
  get(name: string): ITool | undefined;
  getAll(): ITool[];
  list(): Array<{ name: string; description: string }>;
  execute(
    name: string,
    input: object,
    sessionId: string,
    cwd: string,
    signal?: AbortSignal
  ): Promise<ToolResult>;
}

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, ITool>();

  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      throw new ToolError(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }

  list(): Array<{ name: string; description: string }> {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  async execute(
    name: string,
    input: object,
    sessionId: string,
    cwd: string,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: null,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool "${name}" is not registered. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
          retryable: false,
          details: {},
        },
        durationMs: 0,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        metadata: {},
      };
    }

    const callId = uuidv4();
    const startedAt = new Date().toISOString();

    // Use a timeout signal combined with the caller's signal
    const abortController = new AbortController();
    const timeoutMs = tool.defaultTimeoutMs || 120_000;
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }

    const context: ToolExecutionContext = {
      sessionId,
      callId,
      cwd,
      env: { ...process.env } as Record<string, string>,
      signal: abortController.signal,
      permissions: defaultPolicy(),
      logger: defaultLogger(),
      startedAt,
    };

    try {
      const idempotencyKey = tool.idempotencyKey(input, context);
      context.logger.info(`Executing tool: ${name}`, { callId, idempotencyKey });

      const result = await tool.execute(input, context);
      result.startedAt = startedAt;
      result.endedAt = result.endedAt || new Date().toISOString();

      return result;
    } catch (err: unknown) {
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - new Date(startedAt).getTime();

      if (err instanceof ToolError) {
        return {
          success: false,
          output: null,
          error: {
            code: err.code,
            message: err.message,
            retryable: err.retryable,
            details: err.details,
          },
          durationMs,
          startedAt,
          endedAt,
          metadata: {},
        };
      }

      const message = err instanceof Error ? err.message : "Unknown tool execution error";
      return {
        success: false,
        output: null,
        error: {
          code: "TOOL_EXECUTION_ERROR",
          message,
          retryable: false,
          details: {},
        },
        durationMs,
        startedAt,
        endedAt,
        metadata: {},
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
