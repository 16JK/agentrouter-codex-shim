/**
 * agentrouter-shim 启动器 / 守护进程
 * - 自动读取 Windows 系统代理（Clash / v2rayN 等），传给 shim 的 --proxy
 * - shim 崩溃后自动重启（指数退避，最长 60s）
 * - 输出写入 shim.log
 *
 * 手动运行：node launch.mjs
 * 静默运行：start-shim-hidden.vbs
 */
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(here, 'node_modules', 'agentrouter-responses-shim', 'bin', 'agentrouter-shim.mjs')
const LOG = path.join(here, 'shim.log')

const PORT = process.env.SHIM_PORT || '18080'
const UPSTREAM = process.env.SHIM_UPSTREAM || 'https://agentrouter.org/v1'
const RETRY = process.env.SHIM_RETRY_429 || '4'
const MAX_IMAGES = process.env.SHIM_MAX_IMAGES || '45'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stdout.write(line)
  try {
    appendFileSync(LOG, line)
  } catch {}
}

/** 探测 127.0.0.1:port 是否有服务在听 */
function portOpen(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** 从注册表读系统代理（沙箱或安全软件可能禁止 reg.exe，失败即跳过） */
function registryProxy() {
  try {
    const q = (name) =>
      execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      })
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(q('ProxyEnable'))) return ''
    const raw = (q('ProxyServer').match(/ProxyServer\s+REG_SZ\s+(\S+)/i) || [])[1] || ''
    if (!raw) return ''
    const pick = /https=([^;\s]+)/i.exec(raw)?.[1] ?? (raw.includes('=') ? null : raw)
    return pick ? (/^https?:\/\//i.test(pick) ? pick : `http://${pick}`) : ''
  } catch {
    return ''
  }
}

/**
 * 出站代理解析顺序：环境变量 → proxy.txt → 系统注册表 → 常见本地端口探测。
 * 全部失败则直连（返回 ''）。
 */
async function resolveProxy() {
  if (process.env.SHIM_PROXY) return { url: process.env.SHIM_PROXY, from: 'env SHIM_PROXY' }
  if (process.env.SHIM_NO_PROXY === '1') return { url: '', from: 'SHIM_NO_PROXY=1（强制直连）' }

  const cfgFile = path.join(here, 'proxy.txt')
  if (existsSync(cfgFile)) {
    const text = readFileSync(cfgFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? ''
    if (text) return { url: /^https?:\/\//i.test(text) ? text : `http://${text}`, from: 'proxy.txt' }
  }

  const reg = registryProxy()
  if (reg) return { url: reg, from: '系统注册表' }

  for (const port of [7897, 7890, 7891, 10809, 10808, 1080, 2080, 8889]) {
    if (await portOpen(port)) return { url: `http://127.0.0.1:${port}`, from: `端口探测 ${port}` }
  }
  return { url: '', from: '直连（未发现代理）' }
}

if (!existsSync(BIN)) {
  log(`找不到 shim 入口: ${BIN}`)
  process.exit(1)
}

const { url: proxy, from: proxyFrom } = await resolveProxy()
const args = [
  BIN,
  '--host', '127.0.0.1',
  '--port', PORT,
  '--upstream', UPSTREAM,
  '--retry-429', RETRY,
  '--retry-backoff-ms', '8000',
  '--retry-max-wait-ms', '30000',
  '--max-images', MAX_IMAGES,
  '--log-usage',
]
if (proxy) args.push('--proxy', proxy)

log(`启动 shim  端口=${PORT}  上游=${UPSTREAM}  出站代理=${proxy || '直连'}（来源：${proxyFrom}）`)

let backoff = 2000
let child = null
let stopping = false

function start() {
  child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', (d) => process.stdout.write(d))
  child.stderr.on('data', (d) => {
    const text = d.toString()
    process.stderr.write(text)
    try {
      appendFileSync(LOG, text)
    } catch {}
  })
  child.on('spawn', () => {
    log('shim 已启动')
  })
  child.on('exit', (code, signal) => {
    if (stopping) return
    log(`shim 退出 code=${code} signal=${signal}，${backoff / 1000}s 后重启`)
    setTimeout(start, backoff)
    backoff = Math.min(backoff * 2, 60000)
  })
  // 稳定运行 60s 后重置退避
  setTimeout(() => {
    if (child && child.exitCode === null) backoff = 2000
  }, 60000).unref?.()
}

process.on('SIGINT', () => {
  stopping = true
  child?.kill()
  process.exit(0)
})
process.on('SIGTERM', () => {
  stopping = true
  child?.kill()
  process.exit(0)
})

start()
