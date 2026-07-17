// ============================================================================
// file_read tool — read a file with line numbers
// ============================================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { ITool, ToolResult, ToolExecutionContext, JSONSchema7 } from "./types.js";
import type { PermissionLevel } from "../core/types.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface FileReadInput {
  path: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

export interface FileReadOutput {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export class FileReadTool implements ITool<FileReadInput, FileReadOutput> {
  name = "file_read";
  description =
    "Read the contents of a file. Returns the file content with line numbers. " +
    "Supports reading specific line ranges. Files larger than 2 MB will be truncated.";
  permissionLevel: PermissionLevel = "read-only";
  defaultTimeoutMs = 30_000;

  inputSchema: JSONSchema7 = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path to the file to read (absolute or relative to CWD)",
      },
      startLine: {
        type: "number",
        description: "The first line to read (1-indexed, defaults to 1)",
      },
      endLine: {
        type: "number",
        description: "The last line to read (inclusive, defaults to end of file)",
      },
      maxBytes: {
        type: "number",
        description: "Maximum bytes to read (default 2 MB)",
      },
    },
    required: ["path"],
  };

  idempotencyKey(input: FileReadInput, _context: ToolExecutionContext): string {
    return `file_read:${input.path}:${input.startLine ?? 0}:${input.endLine ?? 0}`;
  }

  async execute(
    input: FileReadInput,
    context: ToolExecutionContext
  ): Promise<ToolResult<FileReadOutput>> {
    const startedAt = new Date().toISOString();
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

    try {
      // Resolve path relative to cwd
      const resolvedPath = path.isAbsolute(input.path)
        ? input.path
        : path.resolve(context.cwd, input.path);

      // Check if file exists and is accessible
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(resolvedPath);
      } catch {
        return {
          success: false,
          output: null,
          error: {
            code: "FILE_NOT_FOUND",
            message: `File not found: ${input.path}`,
            retryable: false,
            details: { path: input.path, resolvedPath },
          },
          durationMs: 0,
          startedAt,
          endedAt: new Date().toISOString(),
          metadata: {},
        };
      }

      if (!stat.isFile()) {
        return {
          success: false,
          output: null,
          error: {
            code: "NOT_A_FILE",
            message: `Path is not a file: ${input.path}`,
            retryable: false,
            details: { path: input.path, resolvedPath },
          },
          durationMs: 0,
          startedAt,
          endedAt: new Date().toISOString(),
          metadata: {},
        };
      }

      // Read the file
      let content: string;
      if (stat.size > maxBytes) {
        // Read only up to maxBytes
        const buf = Buffer.alloc(maxBytes);
        const fd = await fs.open(resolvedPath, "r");
        try {
          await fd.read(buf, 0, maxBytes, 0);
        } finally {
          await fd.close();
        }
        content = buf.toString("utf-8");
      } else {
        content = await fs.readFile(resolvedPath, "utf-8");
      }

      const truncated = stat.size > maxBytes;
      const lines = content.split("\n");

      // Apply line range
      const startLine = input.startLine ?? 1;
      const endLine = input.endLine ?? lines.length;
      const selectedLines = lines.slice(Math.max(0, startLine - 1), endLine);
      const selectedContent = selectedLines.join("\n");

      const sha256 = createHash("sha256").update(content).digest("hex");

      const endedAt = new Date().toISOString();
      return {
        success: true,
        output: {
          path: input.path,
          content: selectedContent,
          startLine,
          endLine: Math.min(endLine, lines.length),
          totalLines: lines.length,
          truncated,
          sha256,
        },
        error: null,
        durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
        startedAt,
        endedAt,
        metadata: {
          fileSize: stat.size,
          resolvedPath,
        },
      };
    } catch (err: unknown) {
      const endedAt = new Date().toISOString();
      const message = err instanceof Error ? err.message : "Unknown error reading file";
      return {
        success: false,
        output: null,
        error: {
          code: "FILE_READ_ERROR",
          message,
          retryable: false,
          details: { path: input.path },
        },
        durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
        startedAt,
        endedAt,
        metadata: {},
      };
    }
  }
}
