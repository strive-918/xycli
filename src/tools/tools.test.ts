// ============================================================================
// Tool Registry + Built-in Tools Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { DefaultToolRegistry } from "./registry.js";
import { registerBuiltins } from "./builtins.js";
import { FileReadTool } from "./file-read.js";
import { FileWriteTool } from "./file-write.js";
import { TerminalExecTool } from "./terminal-exec.js";
import type { ToolRegistry } from "./registry.js";
import type { ITool } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupRegistry(): ToolRegistry {
  const registry = new DefaultToolRegistry();
  registerBuiltins(registry);
  return registry;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xycli-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Registry Tests
// ---------------------------------------------------------------------------

describe("DefaultToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new DefaultToolRegistry();
  });

  it("registers and retrieves a tool", () => {
    const tool = new FileReadTool();
    registry.register(tool);
    expect(registry.get("file_read")).toBe(tool);
  });

  it("throws when registering duplicate tool name", () => {
    registry.register(new FileReadTool());
    expect(() => registry.register(new FileReadTool())).toThrow(
      /already registered/
    );
  });

  it("returns undefined for unknown tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered tools", () => {
    registerBuiltins(registry);
    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list.map((t) => t.name).sort()).toEqual([
      "file_read",
      "file_write",
      "terminal_exec",
    ]);
  });

  it("getAll returns tool instances", () => {
    registerBuiltins(registry);
    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(all[0]).toBeDefined();
  });

  it("execute returns error for unknown tool", async () => {
    const result = await registry.execute(
      "nonexistent",
      {},
      "session-1",
      process.cwd()
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// FileReadTool Tests
// ---------------------------------------------------------------------------

describe("FileReadTool", () => {
  it("reads an existing file with content", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "test.txt");
      const content = "line1\nline2\nline3";
      await fs.writeFile(filePath, content);

      const tool = new FileReadTool();
      const result = await tool.execute(
        { path: filePath },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.output?.content).toContain("line1");
      expect(result.output?.totalLines).toBe(3);
      expect(result.output?.sha256).toBeDefined();
      expect(result.output?.truncated).toBe(false);
    });
  });

  it("returns error for non-existent file", async () => {
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path: "/nonexistent/file.txt" },
      {
        sessionId: "test",
        callId: "1",
        cwd: "/",
        env: {},
        signal: new AbortController().signal,
        permissions: {} as any,
        logger: { info() {}, warn() {}, error() {} },
        startedAt: new Date().toISOString(),
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("FILE_NOT_FOUND");
  });

  it("supports line range reading", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "range.txt");
      const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
      await fs.writeFile(filePath, lines.join("\n"));

      const tool = new FileReadTool();
      const result = await tool.execute(
        { path: filePath, startLine: 5, endLine: 10 },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.output?.startLine).toBe(5);
      expect(result.output?.endLine).toBe(10);
      expect(result.output?.content).toContain("line5");
      expect(result.output?.content).not.toContain("line20");
    });
  });

  it("returns error for directories", async () => {
    await withTempDir(async (dir) => {
      const tool = new FileReadTool();
      const result = await tool.execute(
        { path: dir },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_A_FILE");
    });
  });
});

// ---------------------------------------------------------------------------
// FileWriteTool Tests
// ---------------------------------------------------------------------------

describe("FileWriteTool", () => {
  it("creates a new file", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "newfile.txt");
      const tool = new FileWriteTool();

      const result = await tool.execute(
        { path: filePath, content: "hello world", createIfMissing: true },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.output?.created).toBe(true);
      expect(result.output?.preImageSha256).toBeNull();
      expect(result.output?.postImageSha256).toBeDefined();
      expect(result.output?.unifiedDiff).toContain("+hello world");

      // Verify file was actually written
      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    });
  });

  it("overwrites an existing file", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "existing.txt");
      await fs.writeFile(filePath, "old content");

      const tool = new FileWriteTool();
      const result = await tool.execute(
        { path: filePath, content: "new content", createIfMissing: false },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(true);
      expect(result.output?.created).toBe(false);
      expect(result.output?.preImageSha256).toBeDefined();
      expect(result.output?.unifiedDiff).toContain("-old content");
      expect(result.output?.unifiedDiff).toContain("+new content");

      const content = await fs.readFile(filePath, "utf-8");
      expect(content).toBe("new content");
    });
  });

  it("rejects if createIfMissing is false and file doesn't exist", async () => {
    await withTempDir(async (dir) => {
      const tool = new FileWriteTool();
      const result = await tool.execute(
        {
          path: path.join(dir, "nonexistent.txt"),
          content: "test",
          createIfMissing: false,
        },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FILE_NOT_FOUND");
    });
  });

  it("detects hash mismatch", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "hashcheck.txt");
      await fs.writeFile(filePath, "actual content");

      const tool = new FileWriteTool();
      const result = await tool.execute(
        {
          path: filePath,
          content: "new content",
          createIfMissing: false,
          expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
        {
          sessionId: "test",
          callId: "1",
          cwd: dir,
          env: {},
          signal: new AbortController().signal,
          permissions: {} as any,
          logger: { info() {}, warn() {}, error() {} },
          startedAt: new Date().toISOString(),
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("HASH_MISMATCH");
    });
  });
});

// ---------------------------------------------------------------------------
// TerminalExecTool Tests
// ---------------------------------------------------------------------------

describe("TerminalExecTool", () => {
  it("executes a simple command and returns output", async () => {
    const tool = new TerminalExecTool();
    const result = await tool.execute(
      { command: "echo", args: ["hello", "world"] },
      {
        sessionId: "test",
        callId: "1",
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        signal: new AbortController().signal,
        permissions: {} as any,
        logger: { info() {}, warn() {}, error() {} },
        startedAt: new Date().toISOString(),
      }
    );

    expect(result.success).toBe(true);
    expect(result.output?.stdout).toContain("hello world");
    expect(result.output?.exitCode).toBe(0);
  });

  it("reports non-zero exit codes", async () => {
    const tool = new TerminalExecTool();
    const result = await tool.execute(
      { command: "exit 1" },
      {
        sessionId: "test",
        callId: "1",
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        signal: new AbortController().signal,
        permissions: {} as any,
        logger: { info() {}, warn() {}, error() {} },
        startedAt: new Date().toISOString(),
      }
    );

    expect(result.output?.exitCode).toBe(1);
  });

  it("lists files in current directory", async () => {
    const tool = new TerminalExecTool();
    const result = await tool.execute(
      { command: "ls" },
      {
        sessionId: "test",
        callId: "1",
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        signal: new AbortController().signal,
        permissions: {} as any,
        logger: { info() {}, warn() {}, error() {} },
        startedAt: new Date().toISOString(),
      }
    );

    expect(result.success).toBe(true);
    expect(result.output?.stdout).toContain("package.json");
  });

  it("handles invalid commands gracefully", async () => {
    const tool = new TerminalExecTool();
    const result = await tool.execute(
      { command: "nonexistent_command_xyz_123" },
      {
        sessionId: "test",
        callId: "1",
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        signal: new AbortController().signal,
        permissions: {} as any,
        logger: { info() {}, warn() {}, error() {} },
        startedAt: new Date().toISOString(),
      }
    );

    // Non-zero exit on non-existent command
    expect(result.output?.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Builtins Registration Tests
// ---------------------------------------------------------------------------

describe("registerBuiltins", () => {
  it("registers all 3 M1 tools", () => {
    const registry = new DefaultToolRegistry();
    registerBuiltins(registry);

    expect(registry.get("file_read")).toBeDefined();
    expect(registry.get("file_write")).toBeDefined();
    expect(registry.get("terminal_exec")).toBeDefined();
    expect(registry.getAll()).toHaveLength(3);
  });

  it("each builtin implements ITool correctly", () => {
    const tools: ITool[] = [
      new FileReadTool(),
      new FileWriteTool(),
      new TerminalExecTool(),
    ];

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.permissionLevel).toBeDefined();
      expect(tool.defaultTimeoutMs).toBeGreaterThan(0);
      expect(typeof tool.idempotencyKey).toBe("function");
      expect(typeof tool.execute).toBe("function");
    }
  });
});
