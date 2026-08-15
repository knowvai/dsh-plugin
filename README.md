# KnowV MCP for DeepSeek Harness

`@knowvai/dsh-mcp` 是一个可安装的 DeepSeek Harness bundle。它通过 Harness 官方的 `@deepseek-ai/dsh-mcp-client` 连接 KnowV MCP Server，并将 KnowV 的只读知识工具注册为 Harness 原生工具。

插件本身不实现 MCP 协议，也不包含 URL、API Key 或租户信息。

## 前提

- DeepSeek Harness `0.1.0-rc.5` 或兼容版本。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 客户端可以访问经 AuthGate 暴露的 KnowV MCP endpoint。
- 当前用户在目标租户下创建的 active USER API Key。

MCP endpoint 必须是 AuthGate 或其前置网关暴露的精确 `/mcp` 地址，例如：

```text
https://knowv.internal.example/mcp
```

不要配置 `http://mcpserver:8081`。这是只信任 AuthGate 已验证身份头的内部服务地址，不能作为客户端认证边界。

## 配置凭据

在启动 DeepSeek Harness 的同一个 shell 或进程环境中设置：

```bash
export KNOWV_MCP_SERVER_URL="https://knowv.internal.example/mcp"
export KNOWV_MCP_API_KEY="<local-secret>"
```

两个变量都必须为非空值。API Key 会作为静态 Bearer credential 发送：

```http
Authorization: Bearer <knowv-api-key>
```

KnowV 当前不提供 MCP OAuth discovery 或浏览器授权流程。API Key 必须属于 USER，并固定绑定一个租户；不能通过 URL、header 或工具参数切换租户。访问另一个租户时，应使用绑定到该租户的另一个 API Key 和唯一的 Harness `serverName`。

不要把真实 Key 写入本仓库、profile patch、命令历史、日志或工单。`dsh --dump-config` 不会执行 bundle 中的 `!!js` 表达式，因此只会显示环境变量引用，不会展开 Key。

## 本地安装

在 KnowV 仓库根目录执行：

```bash
dsh plugin --profile web add ./deepseek-harness-plugin
dsh --profile web --dump-config
dsh --profile web
```

也可以安装到其他 profile，例如 `headless`。配置 dump 中应出现 `@knowvai/dsh-mcp` layer，以及 id 为 `knowv-mcp`、name 为 `@deepseek-ai/dsh-mcp-client` 的插件行。

从 DeepSeek Harness 源码运行时，将上面的 `dsh` 替换为该仓库约定的 `pnpm dsh`。

## Tarball 安装

生成本地 tarball：

```bash
cd deepseek-harness-plugin
pnpm pack
```

然后从 KnowV 仓库根目录安装生成的包：

```bash
dsh plugin --profile web add ./deepseek-harness-plugin/knowvai-dsh-mcp-0.1.0.tgz
```

本包标记为 private，用于阻止意外发布到 npm；本地目录和 tarball 安装不受影响。

## 可用工具

连接和 `tools/list` 成功后，Harness 会注册以下工具：

| Harness 工具名 | 用途 |
| --- | --- |
| `mcp__knowv__knowv_list_knowledge_bases` | 列出当前用户可访问的知识库 |
| `mcp__knowv__knowv_list_files` | 列出指定授权知识库中的文件 |
| `mcp__knowv__knowv_get_file` | 获取指定授权文件的元数据 |
| `mcp__knowv__knowv_search_knowledge` | 在授权知识范围内检索候选证据 |

可以用下面的请求验证工具发现和基本调用：

```text
使用 KnowV MCP 列出我可以访问的知识库。
```

工具身份和租户范围始终来自 AuthGate 验证后的 USER API Key。工具参数只能缩小检索范围，不能扩大权限。

## 启动和重连策略

- 单次工具调用超时为 60 秒。
- 初始连接失败不会阻止 Harness 启动；此时不会注册 KnowV 工具。
- 插件启用自动重连，初始延迟 500 ms，指数退避上限 30 秒，每次中断最多连续尝试 10 次。
- URL 或 API Key 缺失/空白属于本地配置错误，会在插件配置校验阶段直接失败。
- 修改环境变量后需要重启 Harness；环境变量变化本身不会触发 profile HMR。

## Profile 覆盖

DSH 的后续 patch 会替换目标行的整个 `config`，不会按字段深度合并。若在 profile 的 `cordis.patch.yml` 中覆盖 `knowv-mcp`，必须重述所有必需字段，而不是只写被修改的字段：

```yaml
- id: knowv-mcp
  config:
    serverName: knowv
    transport: streamable-http
    url: !!js >-
      process.env.KNOWV_MCP_SERVER_URL?.trim()
        && process.env.KNOWV_MCP_API_KEY?.trim()
        ? process.env.KNOWV_MCP_SERVER_URL.trim()
        : undefined
    headers:
      Authorization: !!js >-
        process.env.KNOWV_MCP_SERVER_URL?.trim()
          && process.env.KNOWV_MCP_API_KEY?.trim()
          ? `Bearer ${process.env.KNOWV_MCP_API_KEY.trim()}`
          : undefined
    toolCallTimeoutMs: 60000
    failOnStartupError: false
    reconnect:
      enabled: true
      initialDelayMs: 500
      maxDelayMs: 30000
      maxAttempts: 10
```

## 卸载

```bash
dsh plugin --profile web remove @knowvai/dsh-mcp
```

卸载 bundle 或通过 HMR 替换配置时，Harness 会释放 MCP 连接并注销该实例注册的工具。

## 当前限制

- 首版只桥接 MCP Tools。
- DeepSeek Harness 当前没有 MCP Resources 和 Prompts 的消费接口，因此 `knowv://...` Resources 不会出现在 Harness 中。
- KnowV MCP Server 必须独立部署并保持可访问；本 bundle 不启动、迁移或管理服务端。
- Streamable HTTP 连接需要系统信任 endpoint 的 TLS 证书；不要长期关闭证书校验。

KnowV MCP 的完整客户端合同和排障信息见仓库中的 `docs/mcp-server-usage-guide.md`。
