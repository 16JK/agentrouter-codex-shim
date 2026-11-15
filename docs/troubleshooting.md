# 排错手册

## 判断请求有没有走 shim

```bash
tail -f shim.log
```

- **没有任何 `/responses` 记录** → 请求没走 shim。九成是客户端没真正重启（配置在进程启动时读取并缓存）。
  托盘右键退出，确认进程全部结束，再启动。
- **有记录但 `status` 是 400** → 走通了但仍有句柄漏网，看下面的「句柄覆盖表」。
- **没有记录且报 `ECONNREFUSED`** → shim 没启动，或比客户端晚启动。

## 句柄覆盖表

`shim.log` 的 `sanitized` 字段说明这次删了什么。若仍报跨资源错误，对照下表找出没被处理的类型：

| 位置 | 处理方式 | 日志字段 |
|---|---|---|
| 顶层 `previous_response_id`（有内联历史时） | 删除 | `state_refs_dropped` |
| `input[]` 中 `type: "reasoning"` 的项 | 整项删除 | `reasoning_items_removed` |
| `input[]` 中 `item_reference` 项 | 删除 | `item_references_dropped` |
| `input[]` 中内联项（`message` / `function_call` / `function_call_output` / `custom_tool_call` / `custom_tool_call_output` / `agent_message`）的 `id` | 剥离 | `item_ids_removed` |
| 任意深度的 `encrypted_content` 块 | 删除（保留明文外壳） | `nested_encrypted_blocks_removed` |
| 保留不动的 | `call_id`、`file_id`、工具参数、正文、`encrypted_content` 之外的字段 | — |

**若出现未覆盖的类型**：在 `overrides/src/sanitize.mjs` 的 `inlineItems` 里加一条判定，然后重跑
`node install.mjs`。判定函数只应返回 true（可安全内联回放）——即该项的内容完全在请求体里、`id` 纯属
服务端句柄。

## 常见错误对照

| 报错 | 原因 | 处理 |
|---|---|---|
| `401 unauthorized client detected` | 网关按 User-Agent 识别客户端（用 curl 裸测必然触发） | 用客户端本身请求；调试用 curl 时带上 `-H "user-agent: codex_cli_rs/..."` |
| `502 upstream connect failed ... os error 10061` | shim 出不去：没配代理 / 代理端口变了 / 上游不通 | 检查 `proxy.txt`；临时 `SHIM_NO_PROXY=1` 试直连 |
| `429` 反复出现 | 网关限流 | `SHIM_RETRY_429` 调大（默认 4），配合 `--retry-backoff-ms` |
| `Exceeded maximum number of images (50)` | 历史截图过多 | 默认 `SHIM_MAX_IMAGES=45` 已处理；若仍超可降到 30 |
| `invalid_encrypted_content` 导致流中断 | 嵌套密文跨资源 | 已由补丁递归清理；确认 `nested_encrypted_blocks_removed > 0` |

## 抓真实请求体

需要看客户端到底发了什么时，用一个会落盘的中间代理：

```bash
# 在 shim 前面再套一层，把请求体写到文件
node -e "
const http=require('http'),fs=require('fs');
http.createServer((req,res)=>{
  let b='';req.on('data',c=>b+=c);req.on('end',()=>{
    if(b)fs.appendFileSync('dump.jsonl',b+'\n');
    res.writeHead(502);res.end('dumped');
  });
}).listen(18081);
"
```

把客户端临时指向 `http://127.0.0.1:18081/v1`，复现一次，然后分析 `dump.jsonl`。

> 注意：请求体里有你的对话内容和工具输出，分析完请删除，不要提交到仓库。

## 回滚到直连

把 `~/.codex/config.toml` 的 `base_url` 改回网关地址，停掉 shim。补丁只影响本地运行，不改客户端任何文件。
