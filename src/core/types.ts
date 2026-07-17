// ============================================================================
// Core Domain Types — exact interfaces from DESIGN.md
// ============================================================================

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export type PermissionLevel =
  | "read-only"
  | "write-files"
  | "run-safe-commands"
  | "network"
  | "full-access";

// ---------------------------------------------------------------------------
// Agent Loop State (DESIGN.md §5)
// ---------------------------------------------------------------------------

export type AgentLoopState =
  | "IDLE"
  | "PLANNING"
  | "ACTING"
  | "OBSERVING"
  | "REFLECTING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "ERROR";

// ---------------------------------------------------------------------------
// Session Status
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "running"
  | "waiting_approval"
  | "completed"
  | "error"
  | "interrupted";

// ---------------------------------------------------------------------------
// Provider roles for messages
// ---------------------------------------------------------------------------

export type MessageRole = "system" | "user" | "assistant" | "tool";
