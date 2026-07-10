#!/usr/bin/env node
/**
 * 通过微信机器人 HTTP API 发送消息
 *
 * 用法:
 *   node send-wechat.js --contact "联系人" --message "你好"
 *   node send-wechat.js --room "群名" --message "大家好"
 *   node send-wechat.js --contact "某人" --message "早安" --api-port 3001
 *
 * 配合 cron 定时使用:
 *   WECHAT_API_PORT=3001 node send-wechat.js --contact "名字" --message "消息"
 */

const http = require('http')

const args = process.argv.slice(2)

function getArg(name) {
  const idx = args.indexOf(name)
  if (idx === -1 || idx + 1 >= args.length) return null
  return args[idx + 1]
}

async function main() {
  const contact = getArg('--contact')
  const room = getArg('--room')
  const message = getArg('--message')
  const apiPort = parseInt(getArg('--api-port') || process.env.WECHAT_API_PORT || '3001', 10)

  if (!message) {
    console.error('错误: --message 是必填参数')
    console.error('用法: node send-wechat.js --contact "姓名" --message "内容"')
    console.error('  或: node send-wechat.js --room "群名" --message "内容"')
    process.exit(1)
  }

  if (!contact && !room) {
    console.error('错误: --contact 或 --room 必须提供一个')
    process.exit(1)
  }

  const body = JSON.stringify(contact ? { contact, message } : { room, message })

  const options = {
    hostname: '127.0.0.1',
    port: apiPort,
    path: '/send',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }

  const result = await new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', (err) => reject(err))
    req.write(body)
    req.end()
  })

  if (result.status === 200) {
    console.log(`✓ 消息已发送: ${result.body.target}`)
    process.exit(0)
  } else {
    console.error(`✗ 发送失败 [${result.status}]:`, JSON.stringify(result.body))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('脚本异常:', err.message)
  process.exit(1)
})
