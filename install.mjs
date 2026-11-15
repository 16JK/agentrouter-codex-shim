#!/usr/bin/env node
/**
 * install.mjs —— 一键安装
 *
 * 1) 安装上游 agentrouter-responses-shim@2.0.1 与 undici
 * 2) 用 overrides/ 里打好补丁的文件覆盖上游
 * 3) 生成 proxy.txt（出站代理配置，默认留空=自动探测）
 *
 * 用法：node install.mjs [--force]
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PKG = 'agentrouter-responses-shim'
const VERSION = '2.0.1'
const TARGET = path.join(here, 'node_modules', PKG)
const FORCE = process.argv.includes('--force')

const log = (m = '') => process.stdout.write(`${m}\n`)
const fail = (m) => {
  log(`\n[错误] ${m}`)
  process.exit(1)
}

// ---------- 0. 环境检查 ----------
const major = Number(process.versions.node.split('.')[0])
log(`Node.js ${process.versions.node}`)
if (major < 18) fail(`需要 Node.js >= 18，当前为 ${process.versions.node}`)

// ---------- 1. 安装依赖 ----------
log(`\n[1/3] 安装 ${PKG}@${VERSION} 与 undici ...`)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const res = spawnSync(
  npm,
  ['install', '--no-audit', '--no-fund', `${PKG}@${VERSION}`, 'undici'],
  { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' },
)
if (res.status !== 0) fail('npm install 失败，请检查网络或代理设置')
if (!existsSync(TARGET)) fail(`安装后仍找不到 ${TARGET}`)

const installed = JSON.parse(readFileSync(path.join(TARGET, 'package.json'), 'utf8')).version
if (installed !== VERSION) {
  log(`\n[警告] 上游版本为 ${installed}，补丁针对 ${VERSION} 编写。继续覆盖，请自行验证。`)
}

// ---------- 2. 覆盖补丁文件 ----------
log(`\n[2/3] 应用补丁 ...`)
const overrides = path.join(here, 'overrides')
const copied = []
for (const sub of ['src', 'bin']) {
  const dir = path.join(overrides, sub)
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isFile())) {
    const from = path.join(dir, file)
    const to = path.join(TARGET, sub, file)
    cpSync(from, to)
    copied.push(`${sub}/${file}`)
  }
}
copied.forEach((f) => log(`  -> ${f}`))
if (copied.length === 0) fail('overrides/ 下没有可覆盖的文件，仓库可能不完整')

// ---------- 3. 自检 + 生成 proxy.txt ----------
log(`\n[3/3] 自检 ...`)
const sanitizePath = path.join(TARGET, 'src', 'sanitize.mjs')
const sanitize = readFileSync(sanitizePath, 'utf8')
const checks = [
  ['previous_response_id 清理', 'state_refs_dropped'],
  ['item_reference 清理', 'item_references_dropped'],
  ['agent_message id 剥离', 'agent_message'],
  ['嵌套密文清理（sentry-fix）', 'nested_encrypted_blocks_removed'],
]
let ok = true
for (const [name, marker] of checks) {
  const hit = sanitize.includes(marker)
  log(`  ${hit ? '✓' : '✗'} ${name}`)
  if (!hit) ok = false
}
if (!ok) fail('补丁自检未通过，请确认 overrides/ 与上游版本是否匹配')

const proxyTxt = path.join(here, 'proxy.txt')
if (!existsSync(proxyTxt) || FORCE) {
  copyFileSync(path.join(here, 'proxy.example.txt'), proxyTxt)
  log(`  已生成 proxy.txt（默认自动探测；如需固定代理请写入一行地址）`)
} else {
  log(`  proxy.txt 已存在，保留不动（--force 可覆盖）`)
}

// ---------- 完成 ----------
log(`
安装完成。

下一步：
  1. 编辑客户端配置（ChatGPT 桌面版与 Codex CLI 共用）：
       Windows: %USERPROFILE%\\.codex\\config.toml
       macOS/Linux: ~/.codex/config.toml
     把 base_url 指向 http://127.0.0.1:18080/v1，示例见 docs/codex-config.example.toml

  2. 启动 shim：
       node launch.mjs            （前台，看日志）
       Windows 可双击 start-shim-hidden.vbs（无窗口）

  3. 完全退出并重新打开桌面版客户端（只关窗口无效）。

  4. 验证：tail -f shim.log，出现 /responses 记录即走通。
`)
