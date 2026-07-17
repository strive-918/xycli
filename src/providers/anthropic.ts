// ============================================================================
// Anthropic Provider Adapter — DESIGN.md §6
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import type {
  IProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderTokenInput,
  ProviderToolDefinition,
  ProviderMessage,
  TokenEstimate,
  NormalizedToolCall,
  TokenUsage,
  ProviderContentBlock,
  ProviderErrorPayload,
} from "./types.js";
import { ProviderError } from "../core/errors.js";

// ---------------------------------------------------------------------------
// Anthropic → internal mapping helpers
// ---------------------------------------------------------------------------

function toAnthropicTools(
  tools: ProviderToolDefinition[]
): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

function toAnthropicMessages(
  messages: ProviderMessage[]
): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role as Anthropic.MessageParam["role"], content: m.content };
    }
    // Content blocks
    const blocks: Anthropic.ContentBlockParam[] = m.content.map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text", text: block.text };
        case "tool_use":
          return {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        case "tool_result":
          return {
            type: "tool_result",
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
      }
    });
    return { role: m.role as Anthropic.MessageParam["role"], content: blocks };
  });
}

function normalizeToolCall(
  block: Anthropic.ToolUseBlock
): NormalizedToolCall {
  return {
    id: block.id,
    name: block.name,
    input: (block.input as Record<string, unknown>) ?? {},
  };
}

function normalizeUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function toProviderMessage(
  message: Anthropic.Message
): ProviderMessage {
  const blocks: ProviderContentBlock[] = message.content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
        };
      default:
        return { type: "text", text: "" };
    }
  });
  return { role: "assistant", content: blocks };
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements IProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  private abortController: AbortController | null = null;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new ProviderError(
        "ANTHROPIC_API_KEY is not set. Set the environment variable or pass an API key to the constructor.",
        { retryable: false }
      );
    }
    this.client = new Anthropic({ apiKey: key });
  }

  // -----------------------------------------------------------------------
  // chat — non-streaming
  // -----------------------------------------------------------------------

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    try {
      const systemText = request.system || undefined;
      const tools = request.tools.length > 0 ? toAnthropicTools(request.tools) : undefined;

      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxOutputTokens || 4096,
        temperature: request.temperature ?? 0.2,
        system: systemText,
        messages: toAnthropicMessages(request.messages),
        tools,
      });

      const message = toProviderMessage(response);
      const toolCalls: NormalizedToolCall[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          toolCalls.push(normalizeToolCall(block));
        }
      }

      const finishReason: ProviderResponse["finishReason"] =
        response.stop_reason === "tool_use"
          ? "tool_calls"
          : response.stop_reason === "max_tokens"
            ? "length"
            : response.stop_reason === "end_turn"
              ? "stop"
              : "stop";

      return {
        message,
        toolCalls,
        usage: normalizeUsage(response.usage),
        finishReason,
      };
    } catch (err: unknown) {
      throw this.wrapError(err);
    }
  }

  // -----------------------------------------------------------------------
  // streamChat — async generator for streaming
  // -----------------------------------------------------------------------

  async *streamChat(
    request: ProviderRequest
  ): AsyncIterable<ProviderStreamEvent> {
    const systemText = request.system || undefined;
    const tools = request.tools.length > 0 ? toAnthropicTools(request.tools) : undefined;
    this.abortController = new AbortController();

    try {
      const stream = this.client.messages.stream({
        model: request.model,
        max_tokens: request.maxOutputTokens || 4096,
        temperature: request.temperature ?? 0.2,
        system: systemText,
        messages: toAnthropicMessages(request.messages),
        tools,
      });

      // Collect blocks incrementally
      const contentBlocks: Anthropic.ContentBlock[] = [];
      let currentToolUse: Partial<Anthropic.ToolUseBlock> | null = null;
      let finalUsage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      let stopReason: Anthropic.Message["stop_reason"] = "end_turn";

      for await (const event of stream) {
        switch (event.type) {
          case "message_start":
            finalUsage = normalizeUsage(event.message.usage);
            yield { type: "usage", usage: finalUsage };
            break;

          case "content_block_start":
            if (event.content_block.type === "tool_use") {
              currentToolUse = {
                type: "tool_use",
                id: event.content_block.id,
                name: event.content_block.name,
                input: {},
              };
            }
            contentBlocks.push(event.content_block);
            break;

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              yield { type: "text_delta", text: event.delta.text };
            } else if (
              event.delta.type === "input_json_delta" &&
              currentToolUse
            ) {
              // Accumulate JSON for tool call — yield partial
              yield {
                type: "tool_call_delta",
                call: {
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: event.delta.partial_json
                    ? { _partial: event.delta.partial_json }
                    : {},
                },
              };
            }
            break;

          case "content_block_stop":
            // Block complete
            break;

          case "message_delta":
            if (event.usage) {
              finalUsage = {
                inputTokens: finalUsage.inputTokens,
                outputTokens: event.usage.output_tokens,
                cacheReadTokens: finalUsage.cacheReadTokens,
                cacheWriteTokens: finalUsage.cacheWriteTokens,
              };
              yield { type: "usage", usage: finalUsage };
            }
            stopReason = event.delta.stop_reason ?? stopReason;
            break;

          case "message_stop":
            break;
        }
      }

      // Build final response from collected blocks
      const finalMessage: Anthropic.Message = {
        id: "msg_stream",
        type: "message",
        role: "assistant",
        content: contentBlocks,
        model: request.model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
          input_tokens: finalUsage.inputTokens,
          output_tokens: finalUsage.outputTokens,
          cache_creation_input_tokens: finalUsage.cacheWriteTokens || null,
          cache_read_input_tokens: finalUsage.cacheReadTokens || null,
        },
      };

      const message = toProviderMessage(finalMessage);
      const toolCalls: NormalizedToolCall[] = [];

      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          toolCalls.push(normalizeToolCall(block));
        }
      }

      const finishReason: ProviderResponse["finishReason"] =
        stopReason === "tool_use"
          ? "tool_calls"
          : stopReason === "max_tokens"
            ? "length"
            : stopReason === "end_turn"
              ? "stop"
              : "stop";

      const response: ProviderResponse = {
        message,
        toolCalls,
        usage: finalUsage,
        finishReason,
      };

      yield { type: "done", response };
    } catch (err: unknown) {
      const wrapped = this.wrapError(err);
      yield {
        type: "error",
        error: {
          code: wrapped.code,
          message: wrapped.message,
          retryable: wrapped.retryable,
          details: wrapped.details,
        },
      };
    }
  }

  // -----------------------------------------------------------------------
  // supportsTools
  // -----------------------------------------------------------------------

  supportsTools(_model: string): boolean {
    // All Claude models support tools
    return true;
  }

  // -----------------------------------------------------------------------
  // estimateTokens — rough heuristic
  // -----------------------------------------------------------------------

  async estimateTokens(input: ProviderTokenInput): Promise<TokenEstimate> {
    // Rough heuristic: ~3.5 chars per token for English text
    let totalChars = input.system.length;
    for (const msg of input.messages) {
      if (typeof msg.content === "string") {
        totalChars += msg.content.length;
      } else {
        totalChars += JSON.stringify(msg.content).length;
      }
    }
    totalChars += JSON.stringify(input.tools).length;

    const inputTokens = Math.ceil(totalChars / 3.5);
    return { inputTokens, outputTokens: 0 };
  }

  // -----------------------------------------------------------------------
  // abort
  // -----------------------------------------------------------------------

  abort(): void {
    this.abortController?.abort();
  }

  // -----------------------------------------------------------------------
  // error wrapping
  // -----------------------------------------------------------------------

  private wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    if (err instanceof Anthropic.APIError) {
      const retryable =
        err.status === 429 ||
        err.status === 500 ||
        err.status === 502 ||
        err.status === 503;

      return new ProviderError(
        `Anthropic API error: ${err.message}`,
        {
          retryable,
          status: err.status,
          requestId: err.request_id,
        }
      );
    }

    if (err instanceof Error) {
      return new ProviderError(err.message, { retryable: false });
    }

    return new ProviderError("Unknown provider error", { retryable: false });
  }
}
