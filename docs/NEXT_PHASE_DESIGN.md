# XYCLI 下一阶段详细设计

> 目标版本：v0.3.0
> 状态：设计完成，待实现
> 日期：2026-07-21

## 1. 结论与规划调整

原路线图把搜索、Web 和更多工具放在配置、凭据、Provider 工厂、审批和 CI 之前。这个顺序会扩大高风险能力，同时让安装、密钥和错误恢复体验继续欠账。

调整后的 v0.3.0 只聚焦“可长期使用的产品化基础”：

1. 全局安装与版本信息；
2. 分层配置和安全凭据；
3. Provider Factory；
4. 统一 Agent 事件协议与终端 Renderer；
5. Provider 流式输出；
6. 可重试错误、退避与限流；
7. macOS/Linux/Windows CI 基线。

搜索、Web、MCP 和 Computer Use 不进入本版本。审批与撤销在 v0.4.0 优先实现，然后才增加更多副作用工具。

## 2. 目标与非目标

### 2.1 目标

- 用户安装一次后可在任意目录运行 `xycli`；
- 常用 Provider 和模型不需要每次传参；
- API Key 不写入项目配置、会话或日志；
- 终端可实时显示模型文本和工具状态；
- 429、短暂 5xx 和网络抖动可以安全恢复；
- 所有新增能力有离线测试和跨平台 CI。

### 2.2 非目标

- 不实现云端账号同步；
- 不实现团队密钥中心；
- 不增加 Web、MCP、浏览器或 Computer Use；
- 不在重试中自动重放已经产生副作用的工具；
- 不改变当前默认权限模式。

## 3. 模块调整

```text
xycli-cli
├── commands/            run、config、doctor
├── renderer/            交互与非交互输出
└── bootstrap.rs         配置、凭据、Provider 和存储装配

xycli-core
├── config/              配置模型、来源与合并
├── credentials/         SecretStore trait
├── events.rs            AgentEvent + EventSink
├── provider/
│   ├── mod.rs           trait 与领域类型
│   ├── factory.rs
│   ├── anthropic.rs
│   ├── deepseek.rs
│   ├── retry.rs
│   └── stream.rs
└── 既有 agent、tools、session、permission
```

先把当前单文件 `provider.rs` 拆为目录模块，保持公开类型名称不变，避免一次提交同时改变行为和接口。

## 4. 配置系统

### 4.1 配置优先级

```text
CLI 参数
  > 环境变量
  > 项目配置 .xycli/config.toml
  > 用户配置 ~/.config/xycli/config.toml
  > 内置默认值
```

项目配置只能设置非秘密参数，例如默认模型、最大轮次、权限请求策略和 Provider Base URL。项目文件中出现明文 API Key 时，加载器必须拒绝并给出迁移提示。

### 4.2 配置模型

```rust
pub struct AppConfig {
    pub provider: ProviderConfig,
    pub agent: AgentConfig,
    pub output: OutputConfig,
}

pub struct Resolved<T> {
    pub value: T,
    pub source: ConfigSource,
}
```

`Resolved<T>` 让 `xycli config explain` 能显示最终值来自哪里，但秘密值只能显示来源和末四位，不能输出原文。

### 4.3 配置命令

- `xycli config show`：展示脱敏后的最终配置；
- `xycli config explain <key>`：展示优先级决议；
- `xycli config set <key> <value> --user|--project`：只允许非秘密字段；
- `xycli config path`：显示实际配置路径。

## 5. 凭据存储

定义：

```rust
#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn get(&self, provider: &str) -> XycliResult<Option<SecretString>>;
    async fn set(&self, provider: &str, value: SecretString) -> XycliResult<()>;
    async fn delete(&self, provider: &str) -> XycliResult<()>;
}
```

查找顺序：

```text
Provider 专用环境变量
  > 系统凭据存储
  > 缺失错误与设置指引
```

首期使用跨平台系统凭据库适配器；不支持系统凭据库时保留环境变量降级，不创建明文 secret 文件。新增命令：

- `xycli auth login <provider>`：通过隐藏输入保存；
- `xycli auth status`：只报告是否已配置；
- `xycli auth logout <provider>`：删除凭据。

测试必须验证 Debug、Display、错误和配置输出都不会包含完整密钥。

## 6. Provider Factory

```rust
pub trait ProviderFactory {
    fn create(
        &self,
        config: &ProviderConfig,
        secret: SecretString,
    ) -> XycliResult<Box<dyn Provider>>;
}
```

Factory 只负责验证能力和创建实例；Agent 不根据字符串分支。Provider 配置包含名称、模型、Base URL、请求超时和重试策略。

未知 Provider、空模型、不安全 Base URL 和缺失凭据必须在创建 Agent 之前失败，退出码为 2。

## 7. 统一事件与流式输出

### 7.1 事件模型

```rust
pub enum AgentEvent {
    StateChanged { state: AgentLoopState },
    AssistantDelta { text: String },
    ToolStarted { call_id: String, name: String },
    ToolFinished { call_id: String, result: ToolResult },
    UsageUpdated { usage: TokenUsage },
    Warning { code: String, message: String },
}

#[async_trait]
pub trait EventSink: Send + Sync {
    async fn emit(&self, event: AgentEvent);
}
```

Agent 只发事件，不写 stdout。CLI Renderer 消费事件并根据 TTY、`NO_COLOR`、`--json` 和 `--no-stream` 决定表现形式。

### 7.2 Provider 流

Provider 增加 `stream_chat`，输出统一的文本增量、工具参数增量、用量和结束原因。每个工具调用按 call ID 聚合 JSON；只有完整解析和 Schema 校验后才能执行。

非流式 `chat` 保留为兼容路径，并可由收集完整流实现。测试必须覆盖：

- 多段中文文本；
- 多个并行工具调用参数交错；
- 半截 JSON；
- 流中断；
- 长度截断；
- 非 TTY 和 `NO_COLOR`。

## 8. 重试、退避与限流

只对“尚未获得有效 Provider 响应”的请求重试：

| 错误 | 策略 |
| --- | --- |
| 408、409、429、5xx | 可重试 |
| 连接失败、超时 | 可重试 |
| 400、401、403、404 | 不重试 |
| 内容过滤、Schema 错误 | 不重试 |

默认最多 3 次，使用带抖动的指数退避，并尊重 `Retry-After`。取消令牌可以中断退避等待。

一次 Provider 响应中的工具执行完成后，下一轮模型请求是新操作；失败重试不能重放上一轮工具。fallback 推迟到重试和错误分类稳定后再实现。

## 9. CLI 与安装

新增命令面：

```text
xycli [prompt]
xycli run [prompt]
xycli auth login|status|logout
xycli config show|explain|set|path
xycli doctor
xycli --version
```

`cargo install --path crates/xycli-cli --locked` 是源码安装基线。CI 生成 macOS arm64/x86_64、Linux x86_64、Windows x86_64 二进制归档和 SHA-256 校验和；安装脚本只有在发布产物签名与校验流程确定后再提供。

## 10. 测试与 CI

每项实现必须先增加失败测试，再实现，再运行全量门禁：

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
```

CI 矩阵：

- macOS arm64：主构建、测试、凭据适配；
- Linux x86_64：主构建、测试；
- Windows x86_64：构建、单元测试、路径策略；
- 不注入真实 API Key，不访问公网模型服务；
- Release tag 才构建归档和校验和。

## 11. 实施顺序

1. M2-T01：拆分 Provider 模块，仅做结构重构；
2. M2-T02：实现配置模型、合并、来源追踪和配置命令；
3. M2-T03：实现 SecretStore、auth 命令与全链路脱敏；
4. M2-T04：实现 Provider Factory；
5. M2-T05：定义 AgentEvent/EventSink 并改造非流式主路径；
6. M2-T06：实现 Renderer 和 JSON 输出；
7. M2-T07：实现 Anthropic 与 DeepSeek 流式协议；
8. M2-T08：实现重试、退避和限流；
9. M2-T09：实现 doctor 与安装检查；
10. M2-T10：建立跨平台 CI 和发布产物草案。

每个任务独立提交；结构重构与行为变化不能混在同一提交。

## 12. v0.3.0 完成门槛

- 从任意工作区运行全局 `xycli`；
- API Key 可存入系统凭据库，且日志与会话无泄漏；
- CLI、环境、项目、用户和默认配置优先级有完整测试；
- 两个 Provider 的流式文本和工具调用 E2E 通过；
- 可重试与不可重试错误行为确定；
- TTY、管道、`NO_COLOR` 和 JSON 输出稳定；
- macOS、Linux、Windows CI 通过；
- 文档命令与真实二进制一致；
- 未增加新的默认权限。
