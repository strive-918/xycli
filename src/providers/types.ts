// ============================================================================
// Provider Types — exact interfaces from DESIGN.md §6
// ============================================================================

// ---------------------------------------------------------------------------
// ProviderMessage
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

// ---------------------------------------------------------------------------
// NormalizedToolCall
// ---------------------------------------------------------------------------

export interface NormalizedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TokenUsage
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// ---------------------------------------------------------------------------
// TokenEstimate
// ---------------------------------------------------------------------------

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// ProviderTokenInput
// ---------------------------------------------------------------------------

export interface ProviderTokenInput {
  messages: ProviderMessage[];
  system: string;
  tools: ProviderToolDefinition[];
}

// ---------------------------------------------------------------------------
// ProviderToolDefinition
// ---------------------------------------------------------------------------

export interface ProviderToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ProviderRequest
// ---------------------------------------------------------------------------

export interface ProviderRequest {
  sessionId: string;
  model: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  system: string;
  temperature: number;
  maxOutputTokens: number;
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// ProviderResponse
// ---------------------------------------------------------------------------

export interface ProviderResponse {
  message: ProviderMessage;
  toolCalls: NormalizedToolCall[];
  usage: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "error";
}

// ---------------------------------------------------------------------------
// ProviderStreamEvent
// ---------------------------------------------------------------------------

export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_delta"; call: Partial<NormalizedToolCall> }
  | { type: "usage"; usage: TokenUsage }
  | { type: "error"; error: ProviderErrorPayload }
  | { type: "done"; response: ProviderResponse };

// ---------------------------------------------------------------------------
// ProviderErrorPayload
// ---------------------------------------------------------------------------

export interface ProviderErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// IProvider — exact from DESIGN.md §6
// ---------------------------------------------------------------------------

export interface IProvider {
  name: "anthropic" | "openai" | "generic-openai";
  chat(request: ProviderRequest): Promise<ProviderResponse>;
  streamChat(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
  supportsTools(model: string): boolean;
  estimateTokens(input: ProviderTokenInput): Promise<TokenEstimate>;
}
