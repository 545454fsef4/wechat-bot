import { getServe } from './serve.js'
import { getWechatRuntimeConfig } from '../config/env.js'
import { handleWechatCommand } from '../platforms/wechat/commandRouter.js'

/**
 * 默认消息发送
 * @param msg
 * @param bot
 * @param ServiceType 服务类型 'GPT' | 'Kimi'
 * @returns {Promise<void>}
 */
export async function defaultMessage(msg, bot, ServiceType = 'GPT') {
  const { botName, autoReplyPrefix, aliasWhiteList, roomWhiteList, commandPrefix } = getWechatRuntimeConfig()
  const getReply = getServe(ServiceType)
  const contact = msg.talker() // 发消息人
  const receiver = msg.to() // 消息接收人
  const content = msg.text() // 消息内容
  const room = msg.room() // 是否是群消息
  const roomName = (await room?.topic()) || null // 群名称
  const alias = (await contact.alias()) || (await contact.name()) // 发消息人昵称
  const remarkName = await contact.alias() // 备注名称
  const name = await contact.name() // 微信名称
  const isText = msg.type() === bot.Message.Type.Text // 消息类型是否为文本
  const isRoom = (roomWhiteList.length === 0 || roomWhiteList.includes(roomName)) && content.includes(`${botName}`) // 是否在群聊白名单内并且艾特了机器人(空白名单=全部开放)
  const isAlias = aliasWhiteList.length === 0 || aliasWhiteList.includes(remarkName) || aliasWhiteList.includes(name) // 发消息的人是否在联系人白名单内(空白名单=全部开放)
  const isBotSelf = botName === `@${remarkName}` || botName === `@${name}` // 是否是机器人自己
  const isBotSelfDebug = content.trimStart().startsWith('你是谁') // 是否是机器人自己的调试消息
  const isAuthorizedCommand = (room && isRoom) || (!room && isAlias)
  // TODO 你们可以根据自己的需求修改这里的逻辑
  if ((isBotSelf && !isBotSelfDebug) || !isText) return // 如果是机器人自己发送的消息或者消息类型不是文本则不处理
  try {
    if (content.replace(`${botName}`, '').trimStart().startsWith(commandPrefix)) {
      if (!isAuthorizedCommand) return
      const commandResult = await handleWechatCommand(content, {
        serviceType: ServiceType,
        roomName,
        alias,
        name,
      })
      if (commandResult.handled) {
        if (commandResult.reply) {
          await (room || contact).say(commandResult.reply)
        }
        return
      }
    }

    // 区分群聊和私聊
    // 群聊消息去掉艾特主体后，匹配自动回复前缀
    if (isRoom && room && content.replace(`${botName}`, '').trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question = (await msg.mentionText()) || content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '') // 去掉艾特的消息主体
      console.log('🌸🌸🌸 / question: ', question)
      const response = await getReply(question)
      await room.say(response)
    }
    // 私人聊天，白名单内的直接发送
    // 私人聊天直接匹配自动回复前缀
    if (isAlias && !room && content.trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question = content.replace(`${autoReplyPrefix}`, '')
      console.log('🌸🌸🌸 / content: ', question)
      const response = await getReply(question)
      await contact.say(response)
    }
  } catch (e) {
    console.error(e)
  }
}

// shardingMessage / trySay / splitMessage removed — dead code referencing undefined
// imports (getChatGPTReply, botName) and never imported by any other module.
