# NOTICE

本项目包含并修改了以下 MIT 许可的第三方代码。原始版权归原作者所有。

## agentrouter-responses-shim

- 作者：stevenarai
- 来源：https://www.npmjs.com/package/agentrouter-responses-shim （版本 2.0.1）
- 许可：MIT

`overrides/src/sanitize.mjs`、`overrides/src/server.mjs` 基于该包的 `src/sanitize.mjs`、`src/server.mjs`
修改而来。修改内容见 README「相对上游的 4 个补丁」一节。

## agentrouter-responses-shim sentry-fix 补丁集

- 作者：yunhanhai
- 来源：https://github.com/yunhanhai/agentrouter-responses-shim-sentry-fix
- 许可：MIT

`overrides/src/retry-cli.mjs`、`overrides/src/retry-routing.mjs`、`overrides/bin/agentrouter-shim.mjs`
以及 `overrides/src/sanitize.mjs` 中的嵌套 `encrypted_content` 清理、`overrides/src/server.mjs` 中的
重试与多路由接线，来自该补丁集。

## 思路参考

- https://github.com/HELLOWORLDZQY/dsh-agentrouter-compat （MIT）
  —— 该项目用 DSH 插件形式删除 `previous_response_id` / `input[].id` / `item_reference`，
  本项目的第一项补丁参考了它的清理范围。本项目与该项目无代码复用关系。

---

以上项目的完整许可证文本请参见各自仓库。本项目的修改部分同样以 MIT 发布。
