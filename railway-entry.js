// Railway entry - imports bot directly, no CLI/Commander
// All config from Railway env vars (or defaults)
process.env.SERVICE_TYPE = process.env.SERVICE_TYPE || 'deepseek-free'

async function main() {
  const { startWechatBot } = await import('./src/platforms/wechat/bot.js')
  console.log('Starting WeChat bot...')
  startWechatBot({ serviceType: process.env.SERVICE_TYPE })
}
main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
