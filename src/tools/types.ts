// ============================================================================
// Tool Types — exact interfaces from DESIGN.md §4
// ============================================================================

import type { PermissionLevel } from "../core/types.js";

// ---------------------------------------------------------------------------
// JSON Schema (minimal subset for tool definitions)
// ---------------------------------------------------------------------------

export interface JSONSchema7 {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema7;
  items?: JSONSchema7 | JSONSchema7[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JSONSchema7[];
  anyOf?: JSONSchema7[];
  allOf?: JSONSchema7[];
}

// ---------------------------------------------------------------------------
// PermissionPolicy — simplified in M1, full form in M9
// ---------------------------------------------------------------------------

export interface PermissionPolicy {
  mode: "ask" | "auto-safe" | "read-only";
  defaultLevel: PermissionLevel;
  allow: PermissionRules;
  deny: PermissionRules;
  secretPatterns: RegExp[];
}

export interface PermissionRules {
  commands: string[];
  paths: string[];
  domains: string[];
  tools: string[];
  mcpServers: string[];
  plugins: string[];
}

// ---------------------------------------------------------------------------
// StructuredLogger — minimal interface in M1
// ---------------------------------------------------------------------------

export interface StructuredLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// ToolExecutionContext — exact from DESIGN.md §4.1
// ---------------------------------------------------------------------------

export interface ToolExecutionContext {
  sessionId: string;
  callId: string;
  cwd: string;
  env: Record<string, string>;
  signal: AbortSignal;
  permissions: PermissionPolicy;
  logger: StructuredLogger;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// ToolErrorPayload
// ---------------------------------------------------------------------------

export interface ToolErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ToolResult — exact from DESIGN.md §4.1
// ---------------------------------------------------------------------------

export interface ToolResult<TOutput = unknown> {
  success: boolean;
  output: TOutput | null;
  error: ToolErrorPayload | null;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ITool — exact from DESIGN.md §4.1
// ---------------------------------------------------------------------------

export interface ITool<TInput extends object = object, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  permissionLevel: PermissionLevel;
  defaultTimeoutMs: number;
  idempotencyKey(input: TInput, context: ToolExecutionContext): string;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}
