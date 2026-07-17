#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("xycli")
  .description("A terminal-native AI coding agent")
  .version(VERSION)
  .argument("[prompt]", "Natural language prompt for the AI agent")
  .option("--model <model>", "Model to use", "claude-sonnet-4-5-20250929")
  .option("--max-turns <turns>", "Maximum agent loop iterations", "25")
  .action(async (prompt: string | undefined, options: { model: string; maxTurns: string }) => {
    if (!prompt) {
      program.outputHelp();
      process.exit(0);
    }

    const cwd = process.cwd();
    const maxTurns = parseInt(options.maxTurns, 10);

    // Lazy-load heavy dependencies
    const { AnthropicProvider } = await import("./providers/anthropic.js");
    const { DefaultToolRegistry } = await import("./tools/registry.js");
    const { registerBuiltins } = await import("./tools/builtins.js");
    const { JsonSessionStore } = await import("./session/json-store.js");
    const { runAgent } = await import("./core/agent-loop.js");

    // Build provider
    let provider;
    try {
      provider = new AnthropicProvider();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to initialize provider";
      console.error(message);
      console.error(
        "Set ANTHROPIC_API_KEY environment variable to use XYCLI.\n" +
        "Example: export ANTHROPIC_API_KEY=sk-ant-..."
      );
      process.exit(4);
    }

    // Build tool registry with built-in tools
    const toolRegistry = new DefaultToolRegistry();
    registerBuiltins(toolRegistry);

    // Build session store
    const sessionStore = new JsonSessionStore(cwd);

    console.log(`XYCLI v${VERSION} — AI Coding Agent`);
    console.log(`Model: ${options.model}`);
    console.log(`CWD: ${cwd}`);
    console.log("");

    // Set up Ctrl+C handler
    const abortController = new AbortController();
    let interrupted = false;

    process.on("SIGINT", () => {
      if (!interrupted) {
        interrupted = true;
        console.log("\n\nInterrupted. Finishing current action...");
        abortController.abort();
      } else {
        console.log("\nForce quitting...");
        process.exit(1);
      }
    });

    try {
      const result = await runAgent({
        prompt,
        model: options.model,
        maxTurns,
        cwd,
        provider,
        toolRegistry,
        sessionStore,
        signal: abortController.signal,
      });

      console.log(`\n──────────────────────────────────────────`);
      console.log(`Session: ${result.sessionId}`);
      console.log(`Turns: ${result.turns}`);
      console.log(`Status: ${result.status}`);

      if (result.finalMessage) {
        console.log(`\n${result.finalMessage}`);
      }

      process.exit(0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error(`\nFatal error: ${message}`);
      process.exit(1);
    }
  });

program.parse();
