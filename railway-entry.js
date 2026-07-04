// Railway entry - minimal, no HTTP server
async function main() {
  const { startWechatBot } = await import('./src/platforms/wechat/bot.js')
  console.log('Starting WeChat bot...')
  startWechatBot({ serviceType: process.env.SERVICE_TYPE || 'deepseek-free' })
}
main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
