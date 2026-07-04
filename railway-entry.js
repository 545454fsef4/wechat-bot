// Railway entry - starts bot directly, no CLI needed
async function main() {
  const { startWechat } = await import('./src/index.js')
  const serviceType = process.env.SERVICE_TYPE || 'deepseek-free'
  console.log('Starting bot with service:', serviceType)
  await startWechat(serviceType)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
