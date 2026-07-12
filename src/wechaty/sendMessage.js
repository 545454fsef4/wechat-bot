import { getServe } from './serve.js'
import { getGeminiVisionReply, getVideoVisionReply, getWhisperASR } from '../dual-model/index.js'
import { getWechatRuntimeConfig } from '../config/env.js'
import { handleWechatCommand } from '../platforms/wechat/commandRouter.js'
import { parseStickerTag } from './sticker.js'
import { FileBox } from 'file-box'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// AI 生成免责声明
const AI_DISCLAIMER = '\n\n——此内容为AI生成，本人不对其一切言论负责'
const addDisclaimer = (text) => (text && typeof text === 'string' && !text.startsWith('[') ? text + AI_DISCLAIMER : text)

/**
 * 默认消息发送
 * @param msg
 * @param bot
 * @param ServiceType 服务类型
 * @returns {Promise<void>}
 */
export async function defaultMessage(msg, bot, ServiceType = 'GPT') {
  // 不处理自己发出的消息（防止自我识别幻觉/循环）
  if (msg.self()) return

  const { botName, autoReplyPrefix, aliasWhiteList, aliasBlackList, tagWhiteList, roomWhiteList, commandPrefix } = getWechatRuntimeConfig()
  const getReply = getServe(ServiceType)
  const contact = msg.talker()
  const content = msg.text()
  const room = msg.room()
  const roomName = (await room?.topic()) || null
  const alias = (await contact.alias()) || (await contact.name())
  const remarkName = await contact.alias()
  const name = await contact.name()
  const isText = msg.type() === bot.Message.Type.Text
  const isImage = msg.type() === bot.Message.Type.Image
  const isVideo = msg.type() === bot.Message.Type.Video
  const isAudio = msg.type() === bot.Message.Type.Audio
  const isRoom = (roomWhiteList.length === 0 || roomWhiteList.includes(roomName)) && content.includes(`${botName}`)
  const isAlias = aliasWhiteList.length === 0 || aliasWhiteList.includes(remarkName) || aliasWhiteList.includes(name)
  const isBotSelf = botName === `@${remarkName}` || botName === `@${name}`
  const isBotSelfDebug = content.trimStart().startsWith('你是谁')

  // ── 标签白名单检查（wechat4u 不支持标签API，此处仅做占位）──
  // 如需按标签过滤，请改用 ALIAS_WHITELIST 配置备注名白名单
  let isTagAllowed = true
  if (tagWhiteList.length > 0) {
    try {
      const tags = await contact.tags()
      const tagNames = tags.map((t) => t.id)
      isTagAllowed = tagWhiteList.some((tag) => tagNames.includes(tag))
      console.log(`🏷️ 标签检查: ${name} → [${tagNames.join(',')}] | 要求: [${tagWhiteList.join(',')}] | ${isTagAllowed ? '✅' : '❌'}`)
      if (!isTagAllowed) return // 标签不匹配，跳过
    } catch (e) {
      // 标签API不可用时降级：打印警告但允许通过
      console.warn(`🏷️ 标签查询不可用: ${e.message} → 已降级放行（请用 ALIAS_WHITELIST 替代标签过滤）`)
      // isTagAllowed 保持 true，不阻断消息
    }
  }

  if (room) return // 不回复群聊消息

  // ── 黑名单检查 ──
  const isBlacklisted = aliasBlackList.length > 0 && aliasBlackList.some((item) => alias?.includes(item) || name?.includes(item))
  if (isBlacklisted) {
    console.log(`🚫 黑名单拦截: ${alias || name}`)
    return
  }

  const isAuthorized = isTagAllowed && (aliasWhiteList.length === 0 || isAlias)

  // ── 图片消息 → Gemini Vision ──
  if (isImage && isAuthorized && !isBotSelf) {
    try {
      console.log('🖼️ 收到图片，调用 Gemini Vision...')
      const fileBox = await msg.toFileBox()
      const base64 = await fileBox.toBase64()
      const mimeType = fileBox.mediaType || 'image/jpeg'
      const visionResult = await getGeminiVisionReply(base64, mimeType)
      console.log('👁️ Vision 结果:', visionResult)
      await contact.say(addDisclaimer(visionResult))
    } catch (e) {
      console.error('图片识别出错:', e.message)
    }
    return
  }

  // ── 视频消息 → 提取帧 → Vision ──
  if (isVideo && isAuthorized && !isBotSelf) {
    try {
      console.log('🎬 收到视频，提取关键帧...')
      await contact.say('收到视频，正在识别中...')
      const fileBox = await msg.toFileBox()
      const tmpPath = join(tmpdir(), `wechat-video-${Date.now()}.mp4`)
      await fileBox.toFile(tmpPath)
      const videoResult = await getVideoVisionReply(tmpPath)
      console.log('🎬 视频识别结果:', videoResult)
      await contact.say(addDisclaimer(videoResult))
    } catch (e) {
      console.error('视频识别出错:', e.message)
      await contact.say(`视频识别失败: ${e.message}`)
    }
    return
  }

  // ── 语音消息 → Whisper ASR → 文字 → DeepSeek ──
  if (isAudio && isAuthorized && !isBotSelf) {
    try {
      console.log('🎤 收到语音，转文字中...')
      await contact.say('🎤 正在听...')
      const fileBox = await msg.toFileBox()
      const tmpPath = join(tmpdir(), `wechat-audio-${Date.now()}.slk`)
      await fileBox.toFile(tmpPath)
      const transcript = await getWhisperASR(tmpPath)
      console.log('📝 语音识别:', transcript)

      if (transcript.startsWith('[')) {
        // ASR 失败
        await contact.say(transcript)
        return
      }

      if (!transcript || transcript === '[未识别到语音内容]') {
        await contact.say('没听清，再说一遍？')
        return
      }

      // 将识别文字作为输入，调用 AI 回复
      const response = await getReply(transcript, alias)
      const { text, stickerFile } = parseStickerTag(response)
      if (text) await contact.say(addDisclaimer(text))
      if (stickerFile) {
        try {
          await contact.say(FileBox.fromFile(stickerFile))
        } catch (e) {
          console.error('表情包发送失败:', e.message)
        }
      }
    } catch (e) {
      console.error('语音处理出错:', e.message)
      await contact.say(`语音识别失败: ${e.message}`)
    }
    return
  }

  // ── 文字消息 → DeepSeek ──
  if ((isBotSelf && !isBotSelfDebug) || !isText) return

  try {
    if (content.replace(`${botName}`, '').trimStart().startsWith(commandPrefix)) {
      if (!isAuthorized) return
      const commandResult = await handleWechatCommand(content, {
        serviceType: ServiceType,
        roomName,
        alias,
        name,
      })
      if (commandResult.handled) {
        if (commandResult.reply) {
          await (room || contact).say(addDisclaimer(commandResult.reply))
        }
        return
      }
    }

    if (isRoom && room && content.replace(`${botName}`, '').trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question = (await msg.mentionText()) || content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '')
      console.log('🌸🌸🌸 / question: ', question)
      const response = await getReply(question, alias)
      await room.say(addDisclaimer(response))
    }

    if (isAlias && isTagAllowed && !room && content.trimStart().startsWith(`${autoReplyPrefix}`)) {
      const question = content.replace(`${autoReplyPrefix}`, '')
      console.log('🌸🌸🌸 / content: ', question)
      const response = await getReply(question, alias)
      // ── 检测表情包标记 [sticker:名称] ──
      const { text, stickerFile } = parseStickerTag(response)
      if (text) await contact.say(addDisclaimer(text))
      if (stickerFile) {
        try {
          await contact.say(FileBox.fromFile(stickerFile))
        } catch (e) {
          console.error('表情包发送失败:', e.message)
          await contact.say(`[${e.message}]`)
        }
      }
    }
  } catch (e) {
    console.error(e)
  }
}
