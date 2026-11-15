# agentrouter-codex-shim

> 让 **ChatGPT 桌面版 / Codex（CLI 与桌面）** 通过本地 shim 使用 AgentRouter 这类「资源池」网关时，不再出现
> `The requested item was created under a different ... resource` 的 400 报错。
>
> A local HTTP shim that strips resource-bound replay handles from OpenAI **Responses** requests, fixing HTTP 400
> cross-resource errors on pooled gateways (AgentRouter, Azure OpenAI pools, etc.). Works with the ChatGPT desktop
> app and Codex because both share `~/.codex/config.toml`.

---

## 症状

连续对话或工具调用之后，续聊必定失败：

```
400 invalid_request_error
The requested item was created under a different Azure OpenAI resource.
Use the same resource that created the item to access it. [trace_id=...]
```

同一根因还会派生出这几种「看起来不一样」的故障：

```
stream disconnected before completion: response.failed event received
  -> 内部真错：invalid_encrypted_content / Encrypted function output content could not be decrypted

Item with id 'msg_xxx' not found.
Previous response with id 'resp_xxx' not found.
```

新建对话正常，聊几轮就崩 —— 这是最典型的特征。

---

## 根因

AgentRouter 这类网关背后是**多个上游资源轮转**（Azure/OpenAI 资源池）。Codex 回放历史时，会把上游返回的
服务端句柄原样带回请求：

| 字段 | 形态 | 问题 |
|---|---|---|
| `previous_response_id` | `resp_...` | 只在创建它的那个资源上存在 |
| `input[].id` | `msg_` / `fc_` / `rs_` / `amsg_` ... | 资源内主键 |
| `item_reference` | 纯 ID 指针（无内容） | 只在原资源存在 |
| `type: "reasoning"` | 携带 `encrypted_content`（`gAAAAA...`） | 密文与资源绑定，别处解不开 |

下一个请求被调度到另一个资源时，这些句柄全部失效 → 400 或流中断。

**关键前提**：Codex 每次都发送**完整的内联历史**（`store: false`）。既然正文、工具参数、`call_id`
都在请求体里，这些句柄本身不携带任何对话信息 —— 删掉它们，上下文一点不丢。

---

## 工作方式

```
ChatGPT 桌面版 / Codex
        │  POST http://127.0.0.1:18080/v1/responses   （完整内联历史 + 资源句柄）
        ▼
  本地 shim（本项目）
        │  删 previous_response_id / input[].id / item_reference / reasoning 项 / 嵌套密文
        ▼
  AgentRouter（资源池）
```

shim 只做最小侵入的改写：正文、`call_id` 配对、工具参数与结果、`encrypted_content` 之外的字段全部原样透传；
响应（含 SSE 流）逐字节回流，不缓存、不重试正文、不改写返回。

---

## 快速开始

前置：Node.js ≥ 18（Windows / macOS / Linux 均可）。

```bash
git clone <your-repo-url> agentrouter-codex-shim
cd agentrouter-codex-shim
node install.mjs
```

`install.mjs` 会做三件事：

1. `npm install agentrouter-responses-shim@2.0.1 undici`（装上上游 shim）
2. 把 `overrides/` 里打好补丁的文件覆盖进去
3. 生成 `proxy.txt`（出站代理配置，默认注释状态）

接着让客户端指向本地 shim，编辑 `~/.codex/config.toml`（Windows：`%USERPROFILE%\.codex\config.toml`）：

```toml
model = "gpt-6-astra"                 # 换成你网关上的实际模型 ID
model_provider = "agentrouter"

[model_providers.agentrouter]
name = "AgentRouter"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
experimental_bearer_token = "sk-your-key"
requires_openai_auth = false
```

最后启动 shim，并**完全退出**再重开桌面版：

```bash
# Windows：双击 start-shim-hidden.vbs（无窗口）；或
node launch.mjs

# macOS / Linux
node launch.mjs
```

> **必须完全退出客户端再启动。** ChatGPT 桌面版在进程启动时读取 provider 配置并缓存，只关窗口不重启进程，
> 仍然是旧配置直连网关，shim 日志里一条请求都不会有 —— 这是最常见的「装了没用」原因。

验证是否走通：`shim.log` 里出现 `/responses` 记录即成功。

```bash
tail -f shim.log
```

---

## 启动与运维

| 操作 | Windows | 通用 |
|---|---|---|
| 静默启动 | 双击 `start-shim-hidden.vbs` | `node launch.mjs` |
| 前台调试 | 双击 `start-shim.cmd` | `node launch.mjs` |
| 停止 | 双击 `stop-shim.cmd` | `Ctrl+C` |
| 开机自启 | 双击 `install-autostart.cmd` | systemd / launchd 自行配置 |
| 日志 | `shim.log` | 同 |

`launch.mjs` 是守护进程：崩溃自动重启（指数退避，上限 60 秒），并自动解析出站代理。

### 出站代理

Node 的 `fetch` **不读**系统代理设置，这是本方案最容易踩的坑。`launch.mjs` 按以下顺序解析：

1. 环境变量 `SHIM_PROXY`
2. 同目录 `proxy.txt` 的第一条非注释行
3. Windows 系统代理（注册表 `Internet Settings`）
4. 常见本地端口探测：`7897 7890 7891 10809 10808 1080 2080 8889`

强制直连：设置 `SHIM_NO_PROXY=1`。

### 其他环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SHIM_PORT` | `18080` | 监听端口 |
| `SHIM_UPSTREAM` | `https://agentrouter.org/v1` | 上游地址 |
| `SHIM_RETRY_429` | `4` | 429/5xx 首字节前重试次数 |
| `SHIM_MAX_IMAGES` | `45` | 保留最新 N 张图片（规避网关 50 张上限） |

---

## 相对上游的 4 个补丁

基础方案：[`agentrouter-responses-shim@2.0.1`](https://www.npmjs.com/package/agentrouter-responses-shim)
（作者 stevenarai，MIT）+ [`sentry-fix` 补丁集](https://github.com/yunhanhai/agentrouter-responses-shim-sentry-fix)
（递归清嵌套 `encrypted_content`、429 重试、多上游路由、出站代理、图片上限）。

在此之上，`overrides/` 里的改动修掉了上游实测仍会 400 的三处漏网，以及一处判定遗漏：

| # | 文件 | 改动 | 不加会怎样 |
|---|---|---|---|
| 1 | `src/sanitize.mjs` | 删除顶层 `previous_response_id`（仅当请求已带内联历史） | 上游只计数不删，实测 400 `Previous response with id ... not found` |
| 2 | `src/sanitize.mjs` | 删除 `item_reference` 输入项 | 上游保留该纯 ID 指针，实测 400 `Item with id ... not found` |
| 3 | `src/sanitize.mjs` | 剥离 `agent_message` 的 `amsg_*` id | 多智能体消息 id 同样绑定资源，未剥离 |
| 4 | `src/server.mjs` | `changed` 判定纳入上述新统计 | 只删这几类时不会重新序列化请求体，改动静默失效 |

> 第 1 条的思路参考了 [`dsh-agentrouter-compat`](https://github.com/HELLOWORLDZQY/dsh-agentrouter-compat)
> （一个 DSH 插件，删除的也是这三类句柄）。本项目把它做成与客户端无关的本地 shim。

### 重新安装 / 升级上游

`npm install` 升级上游包会覆盖补丁，重新跑一次 `node install.mjs` 即可。

---

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 改了配置但 `shim.log` 没记录 | 客户端没真正重启 | 托盘退出，确认进程全部结束再启动 |
| `401 unauthorized client detected` | 网关按 User-Agent 识别客户端 | 必须用客户端本身发请求；用 curl 裸测会被拦 |
| `ECONNREFUSED 127.0.0.1:18080` | shim 没起，或比客户端晚起 | 先起 shim，或装开机自启 |
| shim 返回 `502 upstream connect failed` | 出站代理未配置 / 上游不通 | 检查 `proxy.txt`，或 `SHIM_NO_PROXY=1` 试直连 |
| 仍然偶发跨资源 400 | 有未覆盖的句柄类型 | 看 `shim.log` 里该请求的 `sanitized` 统计，对照 [docs/troubleshooting.md](docs/troubleshooting.md) |

日志里每条请求一行 JSON，`sanitized` 字段会告诉你这次删了什么：

```json
{"event":"request","path":"/responses","status":200,
 "sanitized":{"reasoning_items_removed":1,"item_ids_removed":4,
              "nested_encrypted_blocks_removed":2,"item_references_dropped":1}}
```

---

## 已知限制

- **被删的密文内容确实丢失**。推理/多智能体密文属于「换资源即不可解」的状态，客户端侧只能删；明文外壳
  （`Message Type` / `Payload` 头等）与正文均保留，对话可继续。这是池化网关的固有限制。
- **依赖完整内联历史**。若某客户端只用 `previous_response_id` 而不发历史，删掉该字段会让请求失去上下文；
  shim 在这种情况下（`input` 为空）会保留该字段不动。
- **不处理非 Responses 协议**。只改写 `POST /v1/responses`；`/v1/chat/completions` 原样透传。
- **仅修复资源绑定类错误**。限流、配额、模型不支持等错误不在范围内（仅做 429/5xx 重试）。
- 补丁针对 `agentrouter-responses-shim@2.0.1` 编写并验证；上游大版本变更后需重新核对。

---

## 已验证场景

上游 `agentrouter.org`，模型 `gpt-6-astra`：

| 场景 | 结果 |
|---|---|
| 带 `previous_response_id` + `rs_` 密文 / 工具配对的历史 | 补丁前 400 → 补丁后 200 |
| 长会话回放：reasoning + 工具调用 + `agent_message` 嵌套密文 + `item_reference` | 200 |
| Codex CLI 单轮对话 | 200 |
| Codex CLI 多轮 + 工具调用（读文件后作答） | 200，正确读到文件内容 |

---

## 许可证

MIT。本项目修改的上游代码同样为 MIT，版权归属见 [NOTICE.md](NOTICE.md)。
