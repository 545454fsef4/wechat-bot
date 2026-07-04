// Railway entry - starts bot + dummy HTTP server to keep Railway happy
import http from 'http'

// Dummy HTTP server - Railway health check
const PORT = process.env.PORT || 3000
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('OK')
  })
  .listen(PORT, () => console.log(`Health check server on port ${PORT}`))

// Start WeChat bot
async function main() {
  const { startWechatBot } = await import('./src/platforms/wechat/bot.js')
  console.log('Starting WeChat bot...')
  startWechatBot({ serviceType: process.env.SERVICE_TYPE || 'deepseek-free' })
}
main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
