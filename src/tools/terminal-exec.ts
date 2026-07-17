// ============================================================================
// terminal_exec tool — execute shell commands
// ============================================================================

import { spawn } from "node:child_process";
import type { ITool, ToolResult, ToolExecutionContext, JSONSchema7 } from "./types.js";
import type { PermissionLevel } from "../core/types.js";

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface TerminalExecInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface TerminalExecOutput {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputSummary: string;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

const MAX_OUTPUT_LENGTH = 100_000; // characters
const DEFAULT_TIMEOUT_MS = 120_000;

export class TerminalExecTool implements ITool<TerminalExecInput, TerminalExecOutput> {
  name = "terminal_exec";
  description =
    "Execute a shell command and return stdout, stderr, and exit code. " +
    "Use this for running tests, builds, package scripts, git commands, " +
    "and listing files. Output is truncated at 100,000 characters. " +
    "For listing files, use `ls` on macOS/Linux or `dir` on Windows.";
  permissionLevel: PermissionLevel = "run-safe-commands";
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS;

  inputSchema: JSONSchema7 = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to execute (e.g., 'ls', 'npm test')",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Command arguments as an array",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command (defaults to session CWD)",
      },
      timeoutMs: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000)",
      },
      env: {
        type: "object",
        description: "Additional environment variables",
      },
    },
    required: ["command"],
  };

  idempotencyKey(input: TerminalExecInput, context: ToolExecutionContext): string {
    const argsKey = (input.args ?? []).join(" ");
    const cwd = input.cwd ?? context.cwd;
    return `terminal_exec:${input.command}:${argsKey}:${cwd}`;
  }

  async execute(
    input: TerminalExecInput,
    context: ToolExecutionContext
  ): Promise<ToolResult<TerminalExecOutput>> {
    const startedAt = new Date().toISOString();
    const cwd = input.cwd ?? context.cwd;
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let truncated = false;

      const child = spawn(input.command, input.args ?? [], {
        cwd,
        env: { ...context.env, ...input.env },
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        signal: context.signal,
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // Give it a moment, then force kill
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 3000);
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        if (stdout.length < MAX_OUTPUT_LENGTH) {
          stdout += text;
          if (stdout.length >= MAX_OUTPUT_LENGTH) {
            truncated = true;
            stdout = stdout.substring(0, MAX_OUTPUT_LENGTH);
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        if (stderr.length < MAX_OUTPUT_LENGTH) {
          stderr += text;
          if (stderr.length >= MAX_OUTPUT_LENGTH) {
            truncated = true;
            stderr = stderr.substring(0, MAX_OUTPUT_LENGTH);
          }
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        const endedAt = new Date().toISOString();
        resolve({
          success: false,
          output: null,
          error: {
            code: "COMMAND_SPAWN_ERROR",
            message: err.message,
            retryable: false,
            details: { command: input.command },
          },
          durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
          startedAt,
          endedAt,
          metadata: {},
        });
      });

      child.on("close", (exitCode, signal) => {
        clearTimeout(timeout);
        const endedAt = new Date().toISOString();
        const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();

        const outputSummary = stdout.length > 0
          ? stdout.split("\n").slice(-20).join("\n")
          : stderr.split("\n").slice(-20).join("\n");

        resolve({
          success: exitCode === 0,
          output: {
            exitCode,
            signal,
            stdout,
            stderr,
            outputSummary,
            truncated: truncated || timedOut,
          },
          error: exitCode !== 0
            ? {
                code: timedOut ? "COMMAND_TIMEOUT" : "NONZERO_EXIT",
                message: timedOut
                  ? `Command timed out after ${timeoutMs}ms`
                  : `Command exited with code ${exitCode}`,
                retryable: timedOut,
                details: {
                  command: input.command,
                  exitCode,
                  signal,
                  timeoutMs,
                },
              }
            : null,
          durationMs,
          startedAt,
          endedAt,
          metadata: {
            command: input.command,
            exitCode,
            signal,
            cwd,
          },
        });
      });
    });
  }
}
