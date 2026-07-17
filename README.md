# XYCLI

A terminal-native AI coding agent — like Claude Code, but open and extensible.

Bring LLM-powered software engineering directly into your CLI workflow. Write code, debug, refactor, run tests, and deploy — all through natural language in your terminal.

## Status

**M1 Skeleton** — core agent loop, Anthropic provider, 3 built-in tools. Working CLI, 44 tests passing.

| Milestone | Goal | Status |
|-----------|------|--------|
| M1 | Core skeleton (agent loop + Anthropic + file/terminal tools) | ✅ Done |
| M2 | More tools + streaming UX | 🔜 Next |
| M3 | Multi-provider (OpenAI) | Planned |
| M4 | SQLite persistence + resume | Planned |
| M5 | Plan mode | Planned |
| M6 | Cross-session memory | Planned |
| M7 | Computer use | Planned |
| M8 | MCP + plugins | Planned |
| M9 | Safety (permissions, undo) | Planned |
| M10 | Polish (telemetry, CI/CD) | Planned |

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9
- An Anthropic API key

### Install & Run

```bash
# Install dependencies
npm install

# Build
npm run build

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run XYCLI
node dist/src/cli.js "list files in the current directory"
```

### Development

```bash
npm run dev          # Run with tsx (no build needed)
npm test             # Run all tests
npm run typecheck    # Type check without emitting
npm run build        # Compile TypeScript
```

## Architecture

```
xycli "prompt"
    │
    ▼
CLI Entry (Commander.js)
    │
    ▼
Agent Loop ── observe → plan → act → reflect
    │              │
    ▼              ▼
Anthropic API    Tool Registry
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      file_read  file_write  terminal_exec
          │
          ▼
    Session Store (JSON)
```

- **Tool interface** — add tools by implementing `ITool` and registering. No core changes needed.
- **Provider interface** — swap LLMs by implementing `IProvider`. Anthropic built-in, OpenAI coming in M3.
- **Agent loop** — resumable observe-plan-act-reflect cycle with configurable max turns and Ctrl+C handling.

## Built-in Tools (M1)

| Tool | Permission | Description |
|------|-----------|-------------|
| `file_read` | read-only | Read files with line ranges, size limits, SHA256 |
| `file_write` | write-files | Atomic writes with unified diff and hash verification |
| `terminal_exec` | run-safe-commands | Execute shell commands with stdout/stderr capture and timeout |

## Testing

```bash
npm test           # 44 tests (5 test suites)
```

Tests use mock providers — no API key needed for the test suite.

## Project Structure

```
XYCLI/
├── docs/                    # Design documents
│   ├── PRD.md              # Product requirements (18 FR, 10 user stories)
│   ├── ARCHITECTURE.md     # System architecture (314 lines)
│   ├── DESIGN.md           # Detailed design (1018 lines, full DDL/interfaces)
│   └── TASKS.md            # Task breakdown (10 milestones, 61 tasks)
├── src/
│   ├── cli.ts              # CLI entry (Commander.js)
│   ├── version.ts
│   ├── core/               # Agent loop, types, prompts, errors
│   ├── providers/          # Anthropic adapter (IProvider)
│   ├── tools/              # Tool registry + 3 built-in tools (ITool)
│   └── session/            # JSON file session store
├── test/
│   ├── e2e/                # End-to-end tests
│   └── fixtures/           # Mock providers
├── package.json
└── tsconfig.json
```

## License

MIT
