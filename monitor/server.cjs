/**
 * 微信机器人实时监控面板 - 后端服务 v2
 * 功能：模型监控 · 实时聊天消息 · Token 消耗追踪 · 毫秒级更新
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const WebSocket = require('ws')
const os = require('os')

// ============ 配置 ============
const MONITOR_PORT = parseInt(process.env.MONITOR_PORT || '3002', 10)
const BOT_API_PORT = parseInt(process.env.BOT_API_PORT || '3001', 10)
const BOT_DIR = path.resolve(__dirname, '..')
const DATA_DIR = path.join(BOT_DIR, '.data', 'wechat')
const MESSAGE_FILE = path.join(DATA_DIR, 'messages.jsonl')
const TOKEN_TRACKER_FILE = path.join(DATA_DIR, 'token-usage.json')

const HEALTH_INTERVAL = 2000      // 完整健康检查 2 秒（netstat/wmic 较重）
const FAST_PING_INTERVAL = 100   // 快速 API ping 100ms（毫秒级响应时间追踪）
const FILE_POLL_INTERVAL = 100   // 文件变更轮询 100ms（毫秒级）
const WS_PUSH_INTERVAL = 33      // WebSocket 推送间隔 33ms ≈ 30fps
const MAX_LOGS = 500
const MAX_MESSAGES = 200

// ============ 状态存储 ============
let status = {
  bot: {
    online: false,
    processRunning: false,
    pid: null,
    memory: null,
    uptime: null,
    startTime: null,
    loginUser: null,
  },
  api: {
    reachable: false,
    lastCheck: null,
    responseTime: null,
    responseHistory: [],  // 最近 N 次响应时间（毫秒级 sparkline）
    pingCount: 0,         // ping 计数
  },
  system: {
    hostname: os.hostname(),
    platform: process.platform,
    nodeVersion: process.version,
    monitorUptime: 0,
    cpuUsage: null,
    totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1) + ' GB',
    freeMem: null,
  },
  models: {
    text: { name: '—', provider: '—' },
    vision: { name: '—', provider: '—' },
    asr: { name: '—', provider: '—' },
  },
  tokens: {
    today: { prompt: 0, completion: 0, total: 0 },
    total: { prompt: 0, completion: 0, total: 0 },
    requests: 0,
    lastUpdate: null,
  },
}

// 事件日志
const logs = []
// 聊天消息缓存
let chatMessages = []
let messageFileSize = 0
let tokenData = { today: { prompt: 0, completion: 0, total: 0 }, total: { prompt: 0, completion: 0, total: 0 }, requests: 0 }

// ============ 日志 ============
function addLog(level, source, message) {
  const entry = {
    time: new Date().toISOString(),
    timeMs: Date.now(),
    level,
    source,
    message,
  }
  logs.unshift(entry)
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS
  return entry
}

// ============ 模型信息 ============
function loadModelInfo() {
  try {
    // 尝试从 bot 的 .env 读取
    const envPath = path.join(BOT_DIR, '.env')
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8')
      const getEnv = (key) => {
        const match = envContent.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))
        return match ? match[1].replace(/["']/g, '').trim() : null
      }

      const serviceType = getEnv('SERVICE_TYPE') || 'dual-model'
      const textModel = getEnv('DEEPSEEK_FREE_MODEL') || 'deepseek-chat'
      const textUrl = getEnv('DEEPSEEK_FREE_URL') || 'https://api.deepseek.com/chat/completions'
      const visionModel = getEnv('VISION_MODEL') || 'gpt-4o'
      const asrModel = getEnv('ASR_MODEL') || 'whisper-1'

      // 判断 provider
      let visionProvider = 'OpenRouter'
      if (getEnv('FREELY_API_KEY')) visionProvider = 'Freely AI'
      const textProvider = textUrl.includes('deepseek') ? 'DeepSeek' :
                           textUrl.includes('openrouter') ? 'OpenRouter' :
                           textUrl.includes('freely') || textUrl.includes('openai-labs') ? 'Freely AI' : 'Custom'

      status.models = {
        text: { name: textModel, provider: textProvider, serviceType },
        vision: { name: visionModel, provider: visionProvider },
        asr: { name: asrModel, provider: visionProvider },
      }

      addLog('info', 'monitor', `📋 模型配置: 文字=${textModel}(${textProvider}) | 视觉=${visionModel}(${visionProvider}) | 语音=${asrModel}`)
      return
    }
  } catch (e) {
    console.error('[models] Failed to load .env:', e.message)
  }
  addLog('warn', 'monitor', '⚠️ 无法读取模型配置（.env 不可达）')
}

// ============ Token 追踪 ============
function estimateTokens(text) {
  // 粗略估算：中文≈1.5字符/token，英文≈4字符/token
  let chars = 0
  let cjkChars = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F)) {
      cjkChars++
    }
    chars++
  }
  const nonCjk = chars - cjkChars
  return Math.ceil(cjkChars / 1.5 + nonCjk / 4)
}

function updateTokenUsage(type, text) {
  const tokens = estimateTokens(text)
  tokenData.today[type] += tokens
  tokenData.today.total += tokens
  tokenData.total[type] += tokens
  tokenData.total.total += tokens

  status.tokens = JSON.parse(JSON.stringify(tokenData))
  status.tokens.lastUpdate = new Date().toISOString()
}

function resetDailyTokens() {
  const now = new Date()
  // 午夜重置
  if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 5) {
    tokenData.today = { prompt: 0, completion: 0, total: 0 }
    tokenData.total.requests = 0
    addLog('info', 'monitor', '🔄 每日 Token 计数已重置')
  }
}

// 持久化 token 数据（跨重启保持）
function saveTokenData() {
  try {
    const dir = path.dirname(TOKEN_TRACKER_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(TOKEN_TRACKER_FILE, JSON.stringify({
      ...tokenData,
      lastSaved: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
    }, null, 2))
  } catch (e) { /* ignore */ }
}

function loadTokenData() {
  try {
    if (fs.existsSync(TOKEN_TRACKER_FILE)) {
      const saved = JSON.parse(fs.readFileSync(TOKEN_TRACKER_FILE, 'utf8'))
      // 如果日期不同则重置今日数据
      const today = new Date().toISOString().split('T')[0]
      if (saved.date !== today) {
        saved.today = { prompt: 0, completion: 0, total: 0 }
        saved.date = today
      }
      tokenData = {
        today: saved.today || { prompt: 0, completion: 0, total: 0 },
        total: saved.total || { prompt: 0, completion: 0, total: 0 },
        requests: saved.requests || 0,
      }
      status.tokens = JSON.parse(JSON.stringify(tokenData))
    }
  } catch (e) { /* ignore */ }
}

// ============ 聊天消息监控 ============
function loadRecentMessages(limit = 50) {
  try {
    if (!fs.existsSync(MESSAGE_FILE)) return []
    const content = fs.readFileSync(MESSAGE_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch (e) {
    return []
  }
}

function watchMessagesFile() {
  try {
    if (!fs.existsSync(MESSAGE_FILE)) return
    const stat = fs.statSync(MESSAGE_FILE)
    if (stat.size > messageFileSize) {
      // 有新消息写入
      const content = fs.readFileSync(MESSAGE_FILE, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)
      const newLines = lines.slice(-10) // 取最新 10 条

      for (const line of newLines) {
        try {
          const msg = JSON.parse(line)
          // 避免重复（用 id 判断）
          if (!chatMessages.find(m => m.id === msg.id)) {
            chatMessages.unshift(msg)
            if (chatMessages.length > MAX_MESSAGES) chatMessages.length = MAX_MESSAGES
          }
        } catch { /* skip malformed */ }
      }

      messageFileSize = stat.size

      // 广播新消息到所有 WebSocket 客户端
      broadcastDelta('messages', chatMessages.slice(0, 30));

      // 估算 token：用户消息=prompt，如果此消息触发了 AI 回复，计数
      if (newLines.length > 0) {
        const lastMsg = newLines[newLines.length - 1]
        try {
          const parsed = JSON.parse(lastMsg)
          if (parsed.isText && !parsed.self && parsed.text) {
            tokenData.requests++
            updateTokenUsage('prompt', parsed.text)
          }
        } catch {}
      }
    }
  } catch (e) { /* file may not exist yet */ }
}

// ============ 健康检查 ============
function checkBotProcess() {
  try {
    const result = execSync(
      `netstat -ano | findstr ":${BOT_API_PORT}" | findstr "LISTENING"`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim()

    if (result) {
      const pid = result.split(/\s+/).pop()
      status.bot.pid = parseInt(pid, 10)
      status.bot.processRunning = true

      try {
        const taskInfo = execSync(
          `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
          { encoding: 'utf8', timeout: 3000 }
        ).trim()
        if (taskInfo) {
          const parts = taskInfo.replace(/"/g, '').split(',')
          status.bot.memory = parts[4] || 'N/A'
        }
      } catch (e) { /* ignore */ }

      // 获取 CPU 使用率（近似）
      try {
        const wmicOut = execSync(
          `wmic path Win32_PerfFormattedData_PerfProc_Process where "IDProcess=${pid}" get PercentProcessorTime /value`,
          { encoding: 'utf8', timeout: 3000 }
        ).trim()
        const match = wmicOut.match(/PercentProcessorTime=(\d+)/)
        if (match) status.bot.cpu = match[1] + '%'
      } catch (e) { status.bot.cpu = null }

      return true
    }
  } catch (e) { /* netstat failed */ }
  status.bot.processRunning = false
  status.bot.pid = null
  status.bot.memory = null
  status.bot.cpu = null
  return false
}

async function checkApiHealth() {
  const start = Date.now()
  try {
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: BOT_API_PORT,
        path: '/',
        method: 'GET',
        timeout: 1000,
      }, (res) => { resolve(res.statusCode) })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      req.end()
    })
    const elapsed = Date.now() - start
    status.api.reachable = true
    status.api.responseTime = elapsed
    status.api.pingCount++

    // 毫秒级响应历史（最多 300 点 = 30 秒 @ 100ms）
    status.api.responseHistory.push({ t: Date.now(), ms: elapsed })
    if (status.api.responseHistory.length > 300) status.api.responseHistory.shift()
    return true
  } catch (e) {
    status.api.reachable = false
    status.api.responseTime = null
    status.api.pingCount++

    // 超时/失败记录为高值
    status.api.responseHistory.push({ t: Date.now(), ms: 1000 })
    if (status.api.responseHistory.length > 300) status.api.responseHistory.shift()
    return false
  }
}

// 快速 ping（仅 API 可达性 + 响应时间，不做 netstat）
async function fastPing() {
  await checkApiHealth()

  // 实时更新系统资源
  status.system.freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  status.system.monitorUptime += FAST_PING_INTERVAL / 1000
}

async function checkAll() {
  const procRunning = checkBotProcess()
  const apiReachable = await checkApiHealth()

  status.api.lastCheck = new Date().toISOString()

  const wasOnline = status.bot.online
  status.bot.online = procRunning && apiReachable

  if (status.bot.online && !wasOnline) {
    status.bot.startTime = status.bot.startTime || new Date().toISOString()
    addLog('success', 'bot', '🤖 微信机器人已上线')
  } else if (!status.bot.online && wasOnline) {
    status.bot.uptime = null
    status.bot.startTime = null
    addLog('error', 'bot', '🔴 微信机器人已离线')
  }

  if (status.bot.online && status.bot.startTime) {
    const uptimeMs = Date.now() - new Date(status.bot.startTime).getTime()
    const hours = Math.floor(uptimeMs / 3600000)
    const mins = Math.floor((uptimeMs % 3600000) / 60000)
    const secs = Math.floor((uptimeMs % 60000) / 1000)
    status.bot.uptime = `${hours}h ${mins}m ${secs}s`
  }

  // 系统资源
  status.system.freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  status.system.monitorUptime += HEALTH_INTERVAL / 1000
}

// ============ HTTP Server ============
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return
  }

  const url = new URL(req.url, `http://localhost:${MONITOR_PORT}`)

  // ── API: 完整状态（含模型、token、消息） ──
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ...status,
      serverTime: new Date().toISOString(),
      serverTimeMs: Date.now(),
      chatMessages: chatMessages.slice(0, 30),
    }))
    return
  }

  // ── API: 日志 ──
  if (url.pathname === '/api/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(logs.slice(0, limit)))
    return
  }

  // ── API: 聊天消息 ──
  if (url.pathname === '/api/messages') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    const since = url.searchParams.get('since') // timestamp ms
    let msgs = chatMessages.slice(0, limit)
    if (since) msgs = msgs.filter(m => new Date(m.timestamp).getTime() > parseInt(since))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(msgs))
    return
  }

  // ── API: Token 统计 ──
  if (url.pathname === '/api/tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ...tokenData,
      lastUpdate: status.tokens.lastUpdate,
      serverTimeMs: Date.now(),
    }))
    return
  }

  // ── API: 模型信息 ──
  if (url.pathname === '/api/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(status.models))
    return
  }

  // ── API: 发送消息（代理到机器人） ──
  if (url.pathname === '/api/send' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      try {
        const { contact, message } = JSON.parse(body)
        const result = await new Promise((resolve, reject) => {
          const postData = JSON.stringify({ contact, message })
          const botReq = http.request({
            hostname: '127.0.0.1', port: BOT_API_PORT, path: '/send',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 10000,
          }, (botRes) => {
            let data = ''
            botRes.on('data', (chunk) => (data += chunk))
            botRes.on('end', () => {
              try { resolve(JSON.parse(data)) } catch { resolve({ raw: data }) }
            })
          })
          botReq.on('error', reject)
          botReq.write(postData)
          botReq.end()
        })

        // 记录发送的消息 token
        updateTokenUsage('completion', message)

        addLog('info', 'api', `📤 发送消息给 "${contact}": ${message.slice(0, 40)}...`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        addLog('error', 'api', `发送失败: ${e.message}`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── 静态文件 ──
  let filePath = url.pathname === '/' ? '/dashboard.html' : url.pathname
  const fullPath = path.join(__dirname, filePath)

  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const ext = path.extname(fullPath)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' })
      fs.createReadStream(fullPath).pipe(res)
    } else {
      res.writeHead(404); res.end('Not Found')
    }
  } catch (e) {
    res.writeHead(500); res.end('Internal Error')
  }
})

// ============ WebSocket ============
const wss = new WebSocket.Server({ server })
let lastBroadcastMs = 0
const MIN_BROADCAST_GAP = 50 // 最小广播间隔 50ms（毫秒级，避免过于密集）

wss.on('connection', (ws) => {
  console.log('[monitor] WebSocket client connected')
  addLog('info', 'monitor', '📡 新监控客户端已连接')

  // 立即推送完整状态
  ws.send(JSON.stringify({
    type: 'full',
    data: status,
    logs: logs.slice(0, 30),
    messages: chatMessages.slice(0, 30),
    serverTimeMs: Date.now(),
  }))

  ws.on('close', () => {
    console.log('[monitor] WebSocket client disconnected')
  })
})

function broadcast(data) {
  const now = Date.now()
  if (now - lastBroadcastMs < WS_PUSH_INTERVAL) return // 33ms 节流 ≈ 30fps
  lastBroadcastMs = now

  const payload = JSON.stringify({ ...data, serverTimeMs: now })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  })
}

// 广播增量更新（轻量级，高频 — 用于快速 ping 数据推送，不节流）
function broadcastDelta(type, data) {
  const now = Date.now()
  const payload = JSON.stringify({ type, data, serverTimeMs: now })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  })
}

// ============ 主循环 ============
async function monitorLoop() {
  await checkAll()
  broadcast({ type: 'status', data: status })
  saveTokenData()
}

// 毫秒级快速 ping 循环 — 推送增量响应时间数据
async function fastPingLoop() {
  // 快速 ping 更新（不阻塞消息监控）
  checkApiHealth().then(() => {
    status.system.freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1) + ' GB'
    status.system.monitorUptime += FAST_PING_INTERVAL / 1000
    // 增量推送响应时间（轻量）
    broadcastDelta('ping', {
      responseTime: status.api.responseTime,
      reachable: status.api.reachable,
      pingCount: status.api.pingCount,
      responseHistory: status.api.responseHistory.slice(-60), // 只推最近 60 点 ≈ 6 秒
      freeMem: status.system.freeMem,
      monitorUptime: status.system.monitorUptime,
    })
  }).catch(() => {})
}

// 高频消息监控
function messageWatchLoop() {
  watchMessagesFile()
  resetDailyTokens()
}

// ============ 启动 ============
addLog('info', 'monitor', '🚀 监控服务启动中...')

// 初始化
loadTokenData()
loadModelInfo()
chatMessages = loadRecentMessages(50)
try {
  if (fs.existsSync(MESSAGE_FILE)) {
    messageFileSize = fs.statSync(MESSAGE_FILE).size
  }
} catch (e) {}

// 首次检查
checkAll().then(() => {
  addLog('info', 'monitor', `✅ 监控服务已就绪，端口 ${MONITOR_PORT}`)
  addLog('info', 'monitor',
    `机器人 API: ${status.api.reachable ? '可达 ✅' : '不可达 ❌'} | ` +
    `进程: ${status.bot.processRunning ? '运行中' : '未运行'}`)
  addLog('info', 'monitor',
    `📊 模型: ${status.models.text.name}(${status.models.text.provider}) | ` +
    `视觉: ${status.models.vision.name} | ` +
    `累计 Token: ${tokenData.total.total.toLocaleString()}`)
})

// 定时器
setInterval(monitorLoop, HEALTH_INTERVAL)          // 完整健康检查 2s
setInterval(fastPingLoop, FAST_PING_INTERVAL)       // 快速 API ping 100ms ⚡
setInterval(messageWatchLoop, FILE_POLL_INTERVAL)   // 消息监控 100ms
setInterval(saveTokenData, 30000)                   // Token 持久化 30s

server.listen(MONITOR_PORT, '0.0.0.0', () => {
  console.log(`[monitor] Dashboard: http://localhost:${MONITOR_PORT}`)
  console.log(`[monitor] API:      http://localhost:${MONITOR_PORT}/api/status`)
  console.log(`[monitor] WebSocket: ws://localhost:${MONITOR_PORT}`)
  console.log(`[monitor] Fast ping: ${FAST_PING_INTERVAL}ms | Health: ${HEALTH_INTERVAL}ms | Messages: ${FILE_POLL_INTERVAL}ms | WS push: ${WS_PUSH_INTERVAL}ms`)
})
