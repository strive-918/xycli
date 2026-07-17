// ============================================================================
// M1 E2E Test — full CLI flow with mock provider
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "../../src/core/agent-loop.js";
import { MockAnthropicProvider, makeTextResponse, makeToolCallResponse } from "../fixtures/mock-anthropic.js";
import { DefaultToolRegistry } from "../../src/tools/registry.js";
import { registerBuiltins } from "../../src/tools/builtins.js";
import { JsonSessionStore } from "../../src/session/json-store.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xycli-e2e-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("M1 E2E", () => {
  describe("Full agent loop with mock provider", () => {
    it("completes a 'list files' task using terminal_exec", async () => {
      await withTempDir(async (dir) => {
        // Create some test files
        await fs.writeFile(path.join(dir, "README.md"), "# Test Project");
        await fs.writeFile(path.join(dir, "package.json"), "{}");

        // Mock provider: first response calls terminal_exec, second is final text
        const provider = new MockAnthropicProvider([
          makeToolCallResponse("terminal_exec", {
            command: "ls",
          }),
          makeTextResponse(
            "I found the following files in the directory:\n- README.md\n- package.json\n\nTask complete!"
          ),
        ]);

        const toolRegistry = new DefaultToolRegistry();
        registerBuiltins(toolRegistry);

        const sessionStore = new JsonSessionStore(dir);

        const result = await runAgent({
          prompt: "list files in current directory",
          model: "claude-sonnet-4-5-20250929",
          maxTurns: 5,
          cwd: dir,
          provider,
          toolRegistry,
          sessionStore,
        });

        // Verify agent completed
        expect(result.status).toBe("completed");
        expect(result.turns).toBe(2);

        // Verify session was saved
        const session = await sessionStore.get(result.sessionId);
        expect(session).not.toBeNull();
        expect(session!.title).toContain("list files");
        expect(session!.status).toBe("completed");
        expect(session!.messages).toHaveLength(4); // user, assistant(tool_call), tool_result, assistant(final)
        expect(session!.toolCalls).toHaveLength(1);
        expect(session!.toolCalls[0].toolName).toBe("terminal_exec");
        expect(session!.toolCalls[0].status).toBe("succeeded");
        expect(session!.toolCalls[0].output).toBeDefined();

        // Verify the ls output contains our files
        const output = session!.toolCalls[0].output as { stdout: string };
        expect(output.stdout).toBeDefined();
        expect(output.stdout).toContain("README.md");
        expect(output.stdout).toContain("package.json");

        // Verify session file exists on disk
        const sessionFile = path.join(dir, ".xycli", "sessions", "json", `${result.sessionId}.json`);
        const exists = await fs.stat(sessionFile).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        console.log("E2E test passed:", {
          sessionId: result.sessionId,
          turns: result.turns,
          status: result.status,
        });
      });
    });

    it("handles file_read + file_write workflow", async () => {
      await withTempDir(async (dir) => {
        const testFile = path.join(dir, "config.json");
        await fs.writeFile(testFile, JSON.stringify({ version: "1.0" }));

        const provider = new MockAnthropicProvider([
          makeToolCallResponse("file_read", { path: "config.json" }),
          makeToolCallResponse("file_write", {
            path: "config.json",
            content: JSON.stringify({ version: "2.0" }, null, 2),
            createIfMissing: false,
          }),
          makeTextResponse("Updated config.json from version 1.0 to 2.0."),
        ]);

        const toolRegistry = new DefaultToolRegistry();
        registerBuiltins(toolRegistry);
        const sessionStore = new JsonSessionStore(dir);

        const result = await runAgent({
          prompt: "update config.json version to 2.0",
          model: "claude-sonnet-4-5-20250929",
          maxTurns: 10,
          cwd: dir,
          provider,
          toolRegistry,
          sessionStore,
        });

        expect(result.status).toBe("completed");
        expect(result.turns).toBe(3);

        const session = await sessionStore.get(result.sessionId);
        expect(session!.toolCalls).toHaveLength(2);
        expect(session!.toolCalls[0].toolName).toBe("file_read");
        expect(session!.toolCalls[0].status).toBe("succeeded");
        expect(session!.toolCalls[1].toolName).toBe("file_write");
        expect(session!.toolCalls[1].status).toBe("succeeded");

        // Verify file was actually updated
        const updatedContent = await fs.readFile(testFile, "utf-8");
        const updated = JSON.parse(updatedContent);
        expect(updated.version).toBe("2.0");
      });
    });

    it("preserves session state across multiple turns", async () => {
      await withTempDir(async (dir) => {
        const provider = new MockAnthropicProvider([
          makeToolCallResponse("terminal_exec", { command: "echo step1" }),
          makeToolCallResponse("terminal_exec", { command: "echo step2" }),
          makeToolCallResponse("terminal_exec", { command: "echo step3" }),
          makeTextResponse("All steps completed."),
        ]);

        const toolRegistry = new DefaultToolRegistry();
        registerBuiltins(toolRegistry);
        const sessionStore = new JsonSessionStore(dir);

        const result = await runAgent({
          prompt: "run three steps",
          model: "test-model",
          maxTurns: 10,
          cwd: dir,
          provider,
          toolRegistry,
          sessionStore,
        });

        expect(result.status).toBe("completed");
        expect(result.turns).toBe(4);

        // Verify the session has accumulated all messages and tool calls
        const session = await sessionStore.get(result.sessionId);
        expect(session!.toolCalls).toHaveLength(3);
        expect(session!.messages.length).toBe(8); // user + 3*(assistant+tool_result) + final_assistant

        // All tool calls should be succeeded
        for (const tc of session!.toolCalls) {
          expect(tc.status).toBe("succeeded");
        }
      });
    });
  });
});
