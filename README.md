# XYCLI

XYCLI 是一个使用 Rust 实现的终端 AI 编程助手。它把自然语言任务交给模型，通过受控的文件与终端工具完成读取、修改和验证，并将执行过程保存为本地会话。

## 当前状态

当前版本为 Rust-only 的 `v0.2.0` 基线：

- Rust CLI 与可复用的 `xycli-core`；
- Anthropic Messages API 与 DeepSeek Chat Completions API；
- 可继续上下文的 Agent 工具调用循环；
- `file_read`、`file_write`、`terminal_exec` 三个内置工具；
- `read-only`、`auto-safe`、`full-access` 三种权限模式；
- 工作区路径隔离、符号链接逃逸防御和无 shell 命令执行；
- JSON 会话原子持久化；
- Rust 单元、协议、集成、安全和 CLI 进程测试。

旧 TypeScript 运行时及其 npm 构建链已于 2026-07-21 删除。项目现在只需要 Rust 工具链。

## 环境要求

- Rust stable；项目通过 `rust-toolchain.toml` 声明 `rustfmt` 和 `clippy`；
- `ANTHROPIC_API_KEY` 或 `DEEPSEEK_API_KEY`。

安装 Rust：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## 本地构建与运行

```bash
cd /Users/hxy/XYCLI
cargo build --workspace
```

使用 DeepSeek：

```bash
export DEEPSEEK_API_KEY='你的密钥'
cargo run -p xycli -- --provider deepseek
```

使用 Anthropic：

```bash
export ANTHROPIC_API_KEY='你的密钥'
cargo run -p xycli --
```

不提供 prompt 时进入交互模式；也可以执行单次任务：

```bash
cargo run -p xycli -- --provider deepseek "读取 README.md 并总结"
```

构建发布版本：

```bash
cargo build --workspace --release
./target/release/xycli --help
./target/release/xycli --provider deepseek
```

## 安装为全局命令

从项目源码安装：

```bash
cd /Users/hxy/XYCLI
cargo install --path crates/xycli-cli --locked --force
```

确认 `$HOME/.cargo/bin` 已加入 `PATH` 后，可以在任意目录启动：

```bash
xycli --provider deepseek
```

如果新终端找不到命令，在 `~/.zshrc` 中加入：

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

然后执行 `source ~/.zshrc`。

## 常用参数

```text
--provider <provider>   anthropic 或 deepseek
--model <model>         覆盖 Provider 默认模型
--max-turns <1-100>     单次任务最大 Agent 循环次数
--permission <mode>     read-only、auto-safe 或 full-access
--session <uuid>        继续已有会话
-i, --interactive       强制进入交互模式
```

交互命令包括 `/help`、`/new`、`/model <name>`、`/turns <n>` 和 `/exit`。

## API Key

当前版本从环境变量读取密钥。可在当前终端临时设置，也可以写入用户级 shell 配置。不要把密钥写入项目文件或提交到 Git。

下一阶段将增加用户配置和系统凭据存储，避免反复输入密钥，设计见 [下一阶段详细设计](docs/NEXT_PHASE_DESIGN.md)。

## 权限说明

默认使用 `auto-safe`：

- 文件读写仅允许在启动工作区内；
- 真实路径校验会阻止绝对路径、`..` 和符号链接逃逸；
- `terminal_exec` 始终以“可执行文件 + 参数数组”运行，不经过 shell；
- 仅允许 `pwd`、`echo`、工作区内 `ls` 和受限的只读 Git 子命令；
- 其他可执行文件需要显式使用 `--permission full-access`。

`full-access` 仍不会启用 shell 字符串拼接，但允许模型调用 PATH 中的任意程序，只应在任务和仓库可信时使用。

## 测试与质量检查

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
./target/release/xycli --help
```

Provider 协议测试使用本机临时 HTTP 服务，不访问真实模型 API，也不会消耗额度。

## 架构

```text
crates/xycli-cli
  └── 参数、交互模式、Ctrl+C 与进程退出码
        ↓
crates/xycli-core
  ├── Agent Loop
  ├── Provider：Anthropic / DeepSeek
  ├── PermissionMode + ToolRegistry
  ├── file_read / file_write / terminal_exec
  └── JsonSessionStore
```

详细资料：

- [系统架构](docs/ARCHITECTURE.md)
- [详细设计](docs/DESIGN.md)
- [下一阶段详细设计](docs/NEXT_PHASE_DESIGN.md)
- [产品需求](docs/PRD.md)
- [任务路线图](docs/TASKS.md)
- [Rust 迁移与收尾记录](docs/RUST_MIGRATION.md)

## 项目结构

```text
Cargo.toml
crates/
├── xycli-cli/          # Rust 可执行程序与 CLI 进程测试
└── xycli-core/         # Rust 核心库、协议测试和安全测试
docs/                   # 中文产品、架构、设计和路线图
```

## 许可证

MIT
