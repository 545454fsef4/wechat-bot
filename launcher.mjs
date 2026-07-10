import { spawn, execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BOT_DIR = resolve(__dirname)

console.log('[launcher] 启动微信机器人...')

const bot = spawn(
  'node',
  [
    '-e',
    `
import('./src/platforms/wechat/bot.js').then(({ startWechatBot }) => {
  startWechatBot({ serviceType: process.env.SERVICE_TYPE || 'deepseek-free' })
}).catch(e => console.error(e))
`,
  ],
  {
    cwd: BOT_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  },
)

bot.stdout.on('data', (data) => {
  const text = data.toString()
  process.stdout.write(text)

  // 捕获二维码 URL → 立刻打开 Chrome
  const match = text.match(/onScan:\s*(https:\/\/api\.qrserver\.com[^\s]+)/)
  if (match) {
    const qrUrl = match[1]
    console.log(`\n[launcher] 🔗 二维码: ${qrUrl}`)
    console.log('[launcher] 🚀 正在打开 Chrome...')
    try {
      execSync(`start chrome "${qrUrl}"`, { shell: 'cmd.exe' })
      console.log('[launcher] ✅ Chrome 已打开，请扫码！')
    } catch (e) {
      console.error('[launcher] 打开 Chrome 失败:', e.message)
    }
  }

  // 登录成功
  if (text.includes('has logged in')) {
    console.log('\n[launcher] ✅ 微信登录成功！机器人持续运行中...')
    console.log('[launcher] 📡 HTTP API: http://127.0.0.1:3001/send')
    console.log('[launcher] ⏰ 每小时定时消息任务已就绪')
  }
})

bot.stderr.on('data', (data) => {
  process.stderr.write(data)
})

bot.on('close', (code) => {
  console.log(`\n[launcher] 机器人进程退出, code=${code}`)
  process.exit(code || 0)
})

// 优雅退出
process.on('SIGINT', () => {
  bot.kill()
  process.exit(0)
})
process.on('SIGTERM', () => {
  bot.kill()
  process.exit(0)
})
