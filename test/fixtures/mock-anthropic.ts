// ============================================================================
// Mock Anthropic Provider for testing
// ============================================================================

import type {
  IProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderTokenInput,
  TokenEstimate,
} from "../../src/providers/types.js";

export interface MockScenario {
  name: string;
  responses: ProviderResponse[];
}

/**
 * A deterministic mock provider that returns pre-configured responses in sequence.
 */
export class MockAnthropicProvider implements IProvider {
  readonly name = "anthropic" as const;
  private responses: ProviderResponse[];
  private callCount = 0;

  constructor(responses: ProviderResponse[]) {
    this.responses = responses;
  }

  async chat(_request: ProviderRequest): Promise<ProviderResponse> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return response;
  }

  async *streamChat(
    _request: ProviderRequest
  ): AsyncIterable<ProviderStreamEvent> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;

    // Yield text from the message
    if (typeof response.message.content === "string") {
      yield { type: "text_delta", text: response.message.content };
    } else {
      for (const block of response.message.content) {
        if (block.type === "text") {
          yield { type: "text_delta", text: block.text };
        }
      }
    }

    yield { type: "usage", usage: response.usage };
    yield { type: "done", response };
  }

  supportsTools(_model: string): boolean {
    return true;
  }

  async estimateTokens(_input: ProviderTokenInput): Promise<TokenEstimate> {
    return { inputTokens: 100, outputTokens: 0 };
  }

  reset(responses: ProviderResponse[]): void {
    this.responses = responses;
    this.callCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Helper factories for common mock responses
// ---------------------------------------------------------------------------

export function makeTextResponse(text: string): ProviderResponse {
  return {
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
    toolCalls: [],
    usage: {
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    finishReason: "stop",
  };
}

export function makeToolCallResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = "tool_001"
): ProviderResponse {
  return {
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolCallId,
          name: toolName,
          input,
        },
      ],
    },
    toolCalls: [
      {
        id: toolCallId,
        name: toolName,
        input,
      },
    ],
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    finishReason: "tool_calls",
  };
}

export function makeTextThenToolCallResponse(
  text: string,
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = "tool_001"
): ProviderResponse {
  return {
    message: {
      role: "assistant",
      content: [
        { type: "text", text },
        {
          type: "tool_use",
          id: toolCallId,
          name: toolName,
          input,
        },
      ],
    },
    toolCalls: [
      {
        id: toolCallId,
        name: toolName,
        input,
      },
    ],
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    finishReason: "tool_calls",
  };
}
