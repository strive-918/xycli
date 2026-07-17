// ============================================================================
// Session Types — matches DESIGN.md §7
// ============================================================================

import type { SessionStatus, MessageRole, AgentLoopState } from "../core/types.js";
import type { NormalizedToolCall } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  currentState: AgentLoopState;
  plan: Record<string, unknown>;
  providerName: string;
  model: string;
  messages: Message[];
  toolCalls: ToolCallRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: NormalizedToolCall[];
  toolCallId?: string;
  sequence: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// ToolCallRecord
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown | null;
  error: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "denied";
  durationMs: number | null;
  startedAt: string;
  endedAt: string | null;
}

// ---------------------------------------------------------------------------
// SessionStore interface — constructor-injected, not a singleton
// ---------------------------------------------------------------------------

export interface SessionStore {
  create(session: Session): Promise<void>;
  update(session: Session): Promise<void>;
  get(sessionId: string): Promise<Session | null>;
  list(limit?: number): Promise<Session[]>;
}
