import { createServer } from 'http'
import { WechatyBuilder, ScanStatus, log } from 'wechaty'
import qrTerminal from 'qrcode-terminal'
import { defaultMessage } from '../../wechaty/sendMessage.js'
import { captureWechatMessage } from './messageStore.js'
import { getWechatRuntimeConfig } from '../../config/env.js'

/**
 * HTTP API 端口，可通过环境变量 WECHAT_API_PORT 覆盖
 */
const API_PORT = parseInt(process.env.WECHAT_API_PORT || '3001', 10)

/**
 * 启动一个简单的 HTTP API，用于定时发送消息等外部触发
 */
function startHttpApi(bot) {
  const server = createServer(async (req, res) => {
    // 只处理 POST /send
    if (req.method !== 'POST' || req.url !== '/send') {
      res.writeHead(404)
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      try {
        const { contact, message, room } = JSON.parse(body)
        if (!message) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'message is required' }))
          return
        }

        if (room) {
          // 发送到群聊 — 按群名查找
          const roomList = await bot.Room.findAll({ topic: room })
          if (roomList.length === 0) {
            res.writeHead(404)
            res.end(JSON.stringify({ error: `room "${room}" not found` }))
            return
          }
          await roomList[0].say(message)
          res.end(JSON.stringify({ ok: true, target: `room:${room}` }))
          return
        }

        if (!contact) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'contact or room is required' }))
          return
        }

        // 发送给联系人 — 按备注/昵称查找
        const contactList = await bot.Contact.findAll()
        let target = null
        for (const c of contactList) {
          const alias = await c.alias()
          const name = c.name()
          if ((alias && alias.includes(contact)) || name.includes(contact)) {
            target = c
            break
          }
        }
        if (!target) {
          res.writeHead(404)
          res.end(
            JSON.stringify({ error: `contact "${contact}" not found`, contacts: contactList.map((c) => ({ name: c.name(), alias: c.alias() })) }),
          )
          return
        }
        await target.say(message)
        res.end(JSON.stringify({ ok: true, target: `contact:${target.name()}` }))
      } catch (e) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  })

  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`[bot-api] HTTP API listening on http://127.0.0.1:${API_PORT}/send`)
  })
}

function onScan(qrcode, status) {
  if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
    qrTerminal.generate(qrcode, { small: true })
    const qrcodeImageUrl = ['https://api.qrserver.com/v1/create-qr-code/?data=', encodeURIComponent(qrcode)].join('')
    console.log('onScan:', qrcodeImageUrl, ScanStatus[status], status)
  } else {
    log.info('onScan: %s(%s)', ScanStatus[status], status)
  }
}

function onLogin(user) {
  console.log(`${user} has logged in`)
  const date = new Date()
  console.log(`Current time:${date}`)
  console.log('Automatic robot chat mode has been activated')
}

function onLogout(user) {
  console.log(`${user} has logged out`)
  // 清除全局引用
  globalThis.__wechatBot = null
}

async function onFriendShip(friendship) {
  const friendShipRe = /chatgpt|chat/
  if (friendship.type() === 2 && friendShipRe.test(friendship.hello())) {
    await friendship.accept()
  }
}

export function createWechatBot(options = {}) {
  const config = getWechatRuntimeConfig()
  const chromeBin = process.env.CHROME_BIN ? { endpoint: process.env.CHROME_BIN } : {}
  const serviceType = options.serviceType || ''

  const bot = WechatyBuilder.build({
    name: 'WechatEveryDay',
    puppet: 'wechaty-puppet-wechat4u',
    puppetOptions: {
      uos: true,
      ...chromeBin,
    },
  })

  bot.on('scan', onScan)
  bot.on('login', onLogin)
  bot.on('logout', onLogout)
  bot.on('friendship', onFriendShip)
  bot.on('message', async (message) => {
    await captureWechatMessage(message, bot, {
      dataDir: config.dataDir,
      storeMessages: config.storeMessages,
    })
    await defaultMessage(message, bot, serviceType)
  })
  bot.on('error', (error) => {
    console.error('bot error handle: ', error)
  })

  return bot
}

export function startWechatBot(options = {}) {
  const bot = createWechatBot(options)

  // 暴露到全局，方便同一进程的其他模块访问
  globalThis.__wechatBot = bot

  // 启动 HTTP API（定时消息用）
  startHttpApi(bot)

  bot
    .start()
    .then(() => console.log('Start to log in wechat...'))
    .catch((error) => console.error('botStart error: ', error))

  return bot
}
