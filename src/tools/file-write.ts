// ============================================================================
// file_write tool — create or overwrite a file
// ============================================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { ITool, ToolResult, ToolExecutionContext, JSONSchema7 } from "./types.js";
import type { PermissionLevel } from "../core/types.js";

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface FileWriteInput {
  path: string;
  content: string;
  createIfMissing: boolean;
  expectedSha256?: string;
}

export interface FileWriteOutput {
  path: string;
  created: boolean;
  preImageSha256: string | null;
  postImageSha256: string;
  unifiedDiff: string;
}

// ---------------------------------------------------------------------------
// Simple unified diff generator
// ---------------------------------------------------------------------------

function generateUnifiedDiff(
  filePath: string,
  oldContent: string | null,
  newContent: string
): string {
  const oldLines = oldContent ? oldContent.split("\n") : [];
  const newLines = newContent.split("\n");
  const header = oldContent
    ? `--- a/${filePath}\n+++ b/${filePath}\n`
    : `--- /dev/null\n+++ b/${filePath}\n`;

  // Simple diff: all old removed, all new added
  if (!oldContent) {
    // New file
    const diffLines = newLines.map((l) => `+${l}`);
    return `${header}@@ -0,0 +1,${newLines.length} @@\n${diffLines.join("\n")}\n`;
  }

  if (oldContent === newContent) {
    return `${header}@@ -1,${oldLines.length} +1,${newLines.length} @@\n (no changes)\n`;
  }

  // Simple all-remove then all-add diff
  const lines: string[] = [];
  lines.push(header);
  lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);

  // Find common prefix
  let commonStart = 0;
  while (
    commonStart < oldLines.length &&
    commonStart < newLines.length &&
    oldLines[commonStart] === newLines[commonStart]
  ) {
    lines.push(` ${oldLines[commonStart]}`);
    commonStart++;
  }

  // Find common suffix
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= commonStart &&
    newEnd >= commonStart &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  // Changed section
  for (let i = commonStart; i <= oldEnd; i++) {
    lines.push(`-${oldLines[i]}`);
  }
  for (let i = commonStart; i <= newEnd; i++) {
    lines.push(`+${newLines[i]}`);
  }

  // Common suffix
  for (let i = oldEnd + 1; i < oldLines.length; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export class FileWriteTool implements ITool<FileWriteInput, FileWriteOutput> {
  name = "file_write";
  description =
    "Create or overwrite a file with new content. " +
    "Returns a unified diff showing the changes. " +
    "If the file already exists, the previous content will be shown as removed.";
  permissionLevel: PermissionLevel = "write-files";
  defaultTimeoutMs = 30_000;

  inputSchema: JSONSchema7 = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path to the file to write (absolute or relative to CWD)",
      },
      content: {
        type: "string",
        description: "The new content to write to the file",
      },
      createIfMissing: {
        type: "boolean",
        description: "Whether to create the file if it doesn't exist (default: true)",
      },
      expectedSha256: {
        type: "string",
        description: "Optional expected SHA-256 of the current file content for safety",
      },
    },
    required: ["path", "content"],
  };

  idempotencyKey(input: FileWriteInput, _context: ToolExecutionContext): string {
    const contentHash = createHash("sha256").update(input.content).digest("hex");
    return `file_write:${input.path}:${contentHash}`;
  }

  async execute(
    input: FileWriteInput,
    context: ToolExecutionContext
  ): Promise<ToolResult<FileWriteOutput>> {
    const startedAt = new Date().toISOString();
    const createIfMissing = input.createIfMissing !== false; // default true

    try {
      const resolvedPath = path.isAbsolute(input.path)
        ? input.path
        : path.resolve(context.cwd, input.path);

      // Read existing content (if any)
      let preImageSha256: string | null = null;
      let oldContent: string | null = null;
      let created = false;

      try {
        oldContent = await fs.readFile(resolvedPath, "utf-8");
        preImageSha256 = createHash("sha256").update(oldContent).digest("hex");

        // Check expected hash
        if (input.expectedSha256 && preImageSha256 !== input.expectedSha256) {
          return {
            success: false,
            output: null,
            error: {
              code: "HASH_MISMATCH",
              message: `File hash mismatch. Expected ${input.expectedSha256}, got ${preImageSha256}. The file may have been modified since last read.`,
              retryable: false,
              details: {
                path: input.path,
                expectedSha256: input.expectedSha256,
                actualSha256: preImageSha256,
              },
            },
            durationMs: 0,
            startedAt,
            endedAt: new Date().toISOString(),
            metadata: {},
          };
        }
      } catch {
        // File doesn't exist
        if (!createIfMissing) {
          return {
            success: false,
            output: null,
            error: {
              code: "FILE_NOT_FOUND",
              message: `File does not exist and createIfMissing is false: ${input.path}`,
              retryable: false,
              details: { path: input.path },
            },
            durationMs: 0,
            startedAt,
            endedAt: new Date().toISOString(),
            metadata: {},
          };
        }
        created = true;
      }

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

      // Write file atomically (write to temp, then rename)
      const tmpPath = resolvedPath + ".xycli-tmp";
      await fs.writeFile(tmpPath, input.content, "utf-8");

      try {
        await fs.rename(tmpPath, resolvedPath);
      } catch {
        // Fallback: copy and unlink
        await fs.copyFile(tmpPath, resolvedPath);
        await fs.unlink(tmpPath);
      }

      const postImageSha256 = createHash("sha256")
        .update(input.content)
        .digest("hex");
      const unifiedDiff = generateUnifiedDiff(input.path, oldContent, input.content);

      const endedAt = new Date().toISOString();
      return {
        success: true,
        output: {
          path: input.path,
          created,
          preImageSha256,
          postImageSha256,
          unifiedDiff,
        },
        error: null,
        durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
        startedAt,
        endedAt,
        metadata: {
          resolvedPath,
          contentLength: input.content.length,
        },
      };
    } catch (err: unknown) {
      // Clean up temp file if it exists
      const resolvedPath = path.isAbsolute(input.path)
        ? input.path
        : path.resolve(context.cwd, input.path);
      try {
        await fs.unlink(resolvedPath + ".xycli-tmp");
      } catch {
        // ignore cleanup errors
      }

      const endedAt = new Date().toISOString();
      const message = err instanceof Error ? err.message : "Unknown error writing file";
      return {
        success: false,
        output: null,
        error: {
          code: "FILE_WRITE_ERROR",
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
