# XYCLI 开发报告

> 更新时间：2026-07-21

## 总结

XYCLI 已完成 Rust 核心迁移和旧 TypeScript 运行时退役。当前仓库只有 Cargo workspace 一条构建、测试和运行链路，避免双实现继续产生行为漂移。

项目远端：`https://github.com/HEXXX09/xycli`

## 已完成

| 项目 | 状态 |
| --- | --- |
| Rust workspace 与工具链配置 | 已完成 |
| 独立 `xycli-core` 和 `xycli` CLI | 已完成 |
| Agent 循环、终态、轮次与取消 | 已完成 |
| Anthropic 与 DeepSeek HTTP Provider | 已完成 |
| 权限矩阵和严格工具输入校验 | 已完成 |
| 工作区路径与符号链接隔离 | 已完成 |
| 原子文件写入和哈希冲突检查 | 已完成 |
| 无 shell 子进程、白名单、超时和输出上限 | 已完成 |
| JSON 会话兼容与原子持久化 | 已完成 |
| Rust 单元、HTTP、Agent、安全和 CLI 测试 | 已完成 |
| 旧 TypeScript 源码、测试与 npm 构建链删除 | 已完成 |
| Rust-only 中文文档和调整后的路线图 | 已完成 |

## 当前架构

```text
Rust CLI
  → Agent Loop
    → Anthropic / DeepSeek Provider
    → PermissionMode + ToolRegistry
      → file_read / file_write / terminal_exec
    → JsonSessionStore
```

## 验收命令

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
./target/release/xycli --help
```

## 当前主要边界

- Provider 主路径仍为非流式请求；
- 密钥只能通过环境变量提供；
- Provider 没有统一配置工厂、重试、限流和 fallback；
- JSON 会话没有跨进程并发控制、查询命令和上下文压缩；
- 写操作尚无交互式审批、敏感信息脱敏和可验证撤销；
- 尚未实现 MCP、插件、Web、浏览器和 Computer Use。

## 下一步

先完成配置与凭据、全局安装体验、统一事件流和 CI，再实现 Provider 流式与容错。审批、变更账本和撤销提前到扩展高风险工具之前。具体边界和验收条件见 `docs/NEXT_PHASE_DESIGN.md`。
