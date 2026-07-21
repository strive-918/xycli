# XYCLI 详细设计

> 当前版本：Rust-only v0.2.0 基线。本文描述已经实现的核心边界；尚未实现的设计集中记录在 `NEXT_PHASE_DESIGN.md`。

## 1. 工作区与依赖方向

```text
Cargo workspace
├── crates/xycli-cli
│   ├── clap 参数解析
│   ├── 单次任务与 REPL
│   ├── Ctrl+C 取消
│   └── 进程退出码
└── crates/xycli-core
    ├── agent.rs
    ├── provider.rs
    ├── permission.rs
    ├── prompt.rs
    ├── session.rs
    ├── error.rs
    └── tools/
```

依赖方向固定为：

```text
xycli-cli → xycli-core
Agent → Provider trait
      → ToolRegistry
      → SessionStore trait
Tool → PermissionMode + 工作区策略
```

`xycli-core` 不读取终端输入，也不创建具体界面，CLI 负责组合 Provider、工具和存储。新增桌面端或服务端时应复用核心库，而不是复制 Agent 循环。

## 2. Agent 运行时

`AgentRunConfig` 输入 prompt、model、max_turns、cwd、Provider、ToolRegistry、SessionStore、权限模式、取消令牌和可选会话 ID。`run_agent` 负责：

1. 校验 prompt 和轮次；
2. 创建或恢复会话；
3. 构建系统提示词和工具 Schema；
4. 请求 Provider；
5. 记录文本、Token 与工具调用；
6. 执行权限检查和工具调用；
7. 将结果写回上下文并继续下一轮；
8. 保存完成、未完成、中断或错误终态。

状态机：

```text
Idle → Planning → Acting → Observing
                 ↑         │
                 └─────────┘

任意运行态 → Completed | Incomplete | Interrupted | Error
```

只有 `Completed` 返回退出码 0。达到最大轮次和模型输出截断都属于 `Incomplete`，不能伪装为成功。

## 3. Provider

`Provider` trait 当前提供：

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn chat(&self, request: ProviderRequest) -> XycliResult<ProviderResponse>;
    fn supports_tools(&self, model: &str) -> bool;
}
```

内部消息统一表示文本、工具调用和工具结果。Anthropic 与 DeepSeek 只负责厂商协议转换、认证、HTTP 错误映射和响应归一化，不参与 Agent 状态决策。

当前请求超时为 180 秒，并响应 `CancellationToken`。HTTP 408、409、429、500、502、503、504 会被标记为可重试，但重试策略尚未执行。

## 4. 工具注册与结果

每个 Tool 声明名称、描述、JSON Schema、权限级别、默认超时和异步执行逻辑。ToolRegistry 的固定顺序是：

```text
查找工具
  → 检查 PermissionMode
  → 工具输入严格校验
  → 创建超时与子取消令牌
  → 执行工具
  → 归一化 ToolResult
```

模型输入使用 `serde_json::Value`，每个工具实现是运行时权威校验器。业务失败通过结构化结果返回模型；基础设施错误才升级为 Agent 错误。

## 5. 内置工具

### 5.1 file_read

- 只接受工作区内相对路径；
- 支持行范围和读取大小上限；
- 返回内容、范围、截断标记和 SHA-256；
- 已存在目标必须通过真实路径检查。

### 5.2 file_write

- 内容最大 2 MiB；
- 可用 `expectedSha256` 防止覆盖用户并发修改；
- 待创建路径通过最近已存在祖先解析符号链接；
- 写入同目录唯一临时文件后原子重命名；
- 返回写入前后哈希与差异。

### 5.3 terminal_exec

- `command` 是单个程序名，参数只能放入 `args`；
- 使用 `tokio::process::Command`，不调用 shell；
- 工作目录必须位于工作区；
- stdout、stderr 各自限制保留 100,000 字节；
- 超时或取消时终止子进程；
- `auto-safe` 只允许受限的 `pwd`、`echo`、`ls`、`git status/diff/log/show`。

## 6. 权限与安全

权限模式使用显式矩阵：

| 模式 | 能力 |
| --- | --- |
| `read-only` | 只读工具 |
| `auto-safe` | 工作区读写与安全命令 |
| `full-access` | 全部工具级能力与任意本地程序 |

安全边界分三层：

```text
工具级权限矩阵
  → 输入 Schema 和范围校验
    → 文件真实路径或命令语义策略
```

新增权限级别时必须默认拒绝；不能依赖枚举顺序自动放行。项目指令、模型输出和插件声明都不能提升 CLI 选择的权限模式。

## 7. 会话持久化

`SessionStore` 隔离存储实现，当前 `JsonSessionStore` 将会话写入 `.xycli/sessions/json/<uuid>.json`：

- 字段使用 `camelCase`；
- 临时文件与目标文件在同一目录；
- 原子重命名避免半截 JSON；
- 单进程内异步互斥避免同时覆盖；
- 损坏的单个文件不阻断列表读取。

恢复会话时要求工作目录一致，防止历史上下文被带到另一个仓库执行。

## 8. CLI 与退出码

CLI 支持单次 prompt、stdin 和 REPL。REPL 串行处理输入并通过会话 ID 延续上下文；`/new` 创建新会话，`/model` 和 `/turns` 修改后续请求配置。

| 退出码 | 含义 |
| ---: | --- |
| 0 | 正常完成 |
| 1 | 未完成、中断或一般运行错误 |
| 2 | 参数或配置错误 |
| 3 | 顶层权限错误 |
| 4 | Provider 或网络错误 |
| 5 | 工具致命错误 |

## 9. 测试分层

1. 单元测试：权限矩阵、协议解析、命令规则和 Agent 状态；
2. Agent 测试：MockProvider、多轮工具调用、轮次上限和会话落盘；
3. 安全集成测试：路径逃逸、符号链接、哈希冲突、命令注入和权限拒绝；
4. Provider HTTP 测试：本机临时服务检查 URL、认证头、请求体和响应解析；
5. CLI 进程测试：真实二进制参数、stdin、退出码和本地模拟 API。

所有默认测试必须离线运行，不使用真实 API Key。

## 10. 构建与发布

唯一构建链是 Cargo：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
```

本地全局安装使用 `cargo install --path crates/xycli-cli --locked --force`。正式跨平台发布将在 CI 中生成签名或校验和明确的二进制归档。

## 11. 演进约束

- 流式输出通过事件接口进入 Renderer，不能让 Provider 直接打印终端；
- 重试只包围单次 Provider 请求，不能重放已成功的工具副作用；
- 审批发生在工具输入校验之后、副作用之前；
- MCP 与插件工具必须进入同一个 ToolRegistry、权限和审计链；
- SQLite 替换 JSON 时保持 `SessionStore` 领域边界；
- Computer Use 在审批、审计、恢复和跨平台发布成熟前不进入主线。
