import axios from 'axios'
import dotenv from 'dotenv'
import { execSync } from 'child_process'
import { readFileSync, unlinkSync, mkdtempSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
dotenv.config()
const env = dotenv.config().parsed

const _BASE_SYSTEM = env.DUAL_MODEL_SYSTEM_MESSAGE || env.DEEPSEEK_FREE_SYSTEM_MESSAGE || ''
const STICKER_HINT =
  '\n\n回复时可适当用 emoji 让聊天更生动。如需发图片表情包，加 [sticker:名称]，可用: ok / no / laugh / cry / angry / love / sleep / bye / question / thumbsup。'
const SYSTEM_MESSAGE = _BASE_SYSTEM ? _BASE_SYSTEM + STICKER_HINT : ''

// ========== DeepSeek 文字回复（直连） ==========
export async function getDualModelReply(prompt, userName = '') {
  const apiKey = env.DEEPSEEK_FREE_TOKEN || ''
  const baseUrl = env.DEEPSEEK_FREE_URL || 'https://api.deepseek.com/chat/completions'
  const model = env.DEEPSEEK_FREE_MODEL || 'deepseek-chat'
  const userMessage = userName ? `[对话者: ${userName}] ${prompt}` : prompt

  const config = {
    method: 'post',
    url: baseUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    data: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: userMessage },
      ],
      stream: false,
    }),
  }
  const response = await axios(config)
  return response.data.choices[0].message.content
}

// ========== Vision 图片理解（非描述，理解意图后自然回复） ==========
// 优先级: FREELY_API_KEY > VISION_API_KEY > OPENROUTER_API_KEY
export async function getGeminiVisionReply(imageBase64, mimeType = 'image/jpeg') {
  const apiKey = env.FREELY_API_KEY || env.VISION_API_KEY || env.OPENROUTER_API_KEY || ''
  if (!apiKey) return '[Vision API Key 未配置]'

  const baseUrl = env.FREELY_BASE_URL || env.VISION_BASE_URL || 'https://openrouter.ai/api/v1'
  const model = env.VISION_MODEL || 'gpt-4o'

  // 图片回复 persona：理解发图意图，像真人朋友一样简短回应
  const visionSystem = `你是ʎʇuǝɹɐɟ，一个普通人在微信聊天。
朋友给你发了一张图片。你不是AI，不要说"这张图片显示""图片内容是"之类的话。
你要像真人看到朋友发来的图一样，理解对方为什么发这张图，然后给出自然的回应。
- 如果对方是分享生活（自拍/风景/美食）→ 简短夸赞或回应
- 如果对方是求助/提问 → 直接帮忙
- 如果对方是表情包/梗图 → 接梗或用表情回应
- 不要描述图片，直接像聊天一样回复
- 保持回复简短，除非对方在图片中包含了大量文字需要认真回应`

  const isFreely = !!env.FREELY_API_KEY
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (!isFreely) {
    headers['HTTP-Referer'] = 'https://github.com/wangrongding/wechat-bot'
    headers['X-Title'] = 'WeChat Bot (vision)'
  }

  const config = {
    method: 'post',
    url: `${baseUrl}/chat/completions`,
    headers,
    data: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        { role: 'system', content: visionSystem },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }],
        },
      ],
      stream: false,
    }),
  }

  try {
    const response = await axios(config)
    const choice = response.data.choices?.[0]
    if (!choice) return '[Vision 无返回]'
    return choice.message.content
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.response?.data || error.message
    console.error('[vision] Error:', JSON.stringify(detail).substring(0, 300))
    return `[图片识别失败: ${typeof detail === 'string' ? detail.substring(0, 100) : 'API错误'}]`
  }
}

// ========== 视频理解（提取关键帧 → Vision） ==========
const MAX_VIDEO_FRAMES = 5
const MAX_VIDEO_SIZE_MB = 50

export async function getVideoVisionReply(filePath) {
  const apiKey = env.FREELY_API_KEY || env.VISION_API_KEY || env.OPENROUTER_API_KEY || ''
  if (!apiKey) return '[Vision API Key 未配置]'

  const baseUrl = env.FREELY_BASE_URL || env.VISION_BASE_URL || 'https://openrouter.ai/api/v1'
  const model = env.VISION_MODEL || 'gpt-4o'

  // 提取关键帧
  let frameDir
  try {
    frameDir = mkdtempSync(join(tmpdir(), 'wechat-video-'))
    // 获取视频时长
    const durOut = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    })
    const duration = parseFloat(durOut.trim())
    console.log(`[video] 视频时长: ${duration.toFixed(1)}s`)

    // 提取 MAX_VIDEO_FRAMES 个均匀帧
    const interval = Math.max(0.5, duration / (MAX_VIDEO_FRAMES + 1))
    for (let i = 1; i <= MAX_VIDEO_FRAMES; i++) {
      const t = Math.min(interval * i, duration - 0.1)
      execSync(`ffmpeg -y -ss ${t} -i "${filePath}" -vframes 1 -q:v 3 "${frameDir}/frame_${i}.jpg"`, {
        stdio: 'pipe',
        timeout: 15000,
      })
    }
  } catch (e) {
    console.error('[video] 帧提取失败:', e.message)
    return '[视频帧提取失败，请确认 ffmpeg/ffprobe 已安装]'
  }

  // 读取帧并编码为 base64
  const frames = readdirSync(frameDir).sort()
  if (!frames.length) return '[视频帧提取为空]'

  const imageContents = frames.map((f) => {
    const buf = readFileSync(join(frameDir, f))
    return {
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
    }
  })

  // 清理临时文件
  try {
    frames.forEach((f) => unlinkSync(join(frameDir, f)))
    unlinkSync(filePath)
  } catch (_) {
    /* ignore */
  }

  console.log(`[video] 提取了 ${imageContents.length} 帧，发送至 Vision...`)

  const visionSystem = `你是ʎʇuǝɹɐɟ，一个普通人在微信聊天。
朋友给你发了一个视频（按时间顺序排列的${imageContents.length}帧截图）。你不是AI，不要说"这个视频显示"之类的话。
你要像真人看到朋友发来的视频一样，理解对方为什么发这个视频，然后给出自然的回应。
- 分享生活/自拍/风景 → 简短夸赞或回应
- 求助/提问 → 直接帮忙
- 搞笑/梗视频 → 接梗
- 不要逐帧描述，直接像聊天一样回复
- 保持回复简短`

  const isFreely = !!env.FREELY_API_KEY
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `*** ${apiKey}`,
  }
  if (!isFreely) {
    headers['HTTP-Referer'] = 'https://github.com/wangrongding/wechat-bot'
    headers['X-Title'] = 'WeChat Bot (video vision)'
  }

  const config = {
    method: 'post',
    url: `${baseUrl}/chat/completions`,
    headers,
    data: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [
        { role: 'system', content: visionSystem },
        { role: 'user', content: imageContents },
      ],
      stream: false,
    }),
  }

  try {
    const response = await axios(config)
    const choice = response.data.choices?.[0]
    if (!choice) return '[Vision 无返回]'
    return choice.message.content
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.response?.data || error.message
    console.error('[video vision] Error:', JSON.stringify(detail).substring(0, 300))
    return `[视频识别失败: ${typeof detail === 'string' ? detail.substring(0, 100) : 'API错误'}]`
  }
}
