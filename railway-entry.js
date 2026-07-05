// Railway entry — WeChat bot with global error handling
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack)
  // Don't exit — let the bot try to recover
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason)
})

async function main() {
  const { startWechatBot } = await import('./src/platforms/wechat/bot.js')
  console.log('Starting WeChat bot...')
  startWechatBot({ serviceType: process.env.SERVICE_TYPE || 'deepseek-free' })
}
main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
