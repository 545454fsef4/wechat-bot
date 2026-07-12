import axios from 'axios'
import dotenv from 'dotenv'
import { execSync } from 'child_process'
import { readFileSync, createReadStream, unlinkSync, mkdtempSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
dotenv.config()
const env = dotenv.config().parsed

const _BASE_SYSTEM = env.DUAL_MODEL_SYSTEM_MESSAGE || env.DEEPSEEK_FREE_SYSTEM_MESSAGE || ''
const SYSTEM_MESSAGE = _BASE_SYSTEM || ''

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
  const visionSystem = env.VISION_SYSTEM_MESSAGE || ''

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
      execSync(`ffmpeg -y -ss ${t} -i "${filePath}" -vframes 1 "${frameDir}/frame_${i}.png"`, {
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
      image_url: { url: `data:image/png;base64,${buf.toString('base64')}` },
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

  const visionSystem = env.VIDEO_VISION_SYSTEM_MESSAGE || env.VISION_SYSTEM_MESSAGE || ''

  const isFreely = !!env.FREELY_API_KEY
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
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

// ========== 语音识别（Whisper ASR） ==========
const MAX_AUDIO_SIZE_MB = 25
const ASR_LANGUAGE = 'zh' // 中文识别

/**
 * 将微信语音文件转为文字
 * @param {string} filePath - 音频文件路径 (.slk / .amr / .mp3 / .wav)
 * @returns {Promise<string>} 识别出的文字，失败返回错误提示
 */
export async function getWhisperASR(filePath) {
  const apiKey = env.FREELY_API_KEY || env.VISION_API_KEY || env.OPENROUTER_API_KEY || ''
  if (!apiKey) return '[ASR API Key 未配置]'

  const baseUrl = env.FREELY_BASE_URL || env.VISION_BASE_URL || 'https://openrouter.ai/api/v1'
  const model = env.ASR_MODEL || 'whisper-1'

  // 1. 转码为 16kHz mono wav（Whisper 最优格式）
  let wavPath
  try {
    wavPath = join(tmpdir(), `wechat-asr-${Date.now()}.wav`)
    execSync(`ffmpeg -y -i "${filePath}" -ar 16000 -ac 1 -sample_fmt s16 "${wavPath}"`, { stdio: 'pipe', timeout: 30000 })
  } catch (e) {
    console.error('[asr] 音频转码失败:', e.message)
    try {
      unlinkSync(filePath)
    } catch (_) {}
    return '[音频转码失败]'
  }

  // 2. 构造 multipart/form-data
  const FormData = (await import('form-data')).default
  const form = new FormData()
  form.append('file', createReadStream(wavPath), { filename: 'audio.wav', contentType: 'audio/wav' })
  form.append('model', model)
  form.append('language', ASR_LANGUAGE)
  form.append('response_format', 'json')

  // 3. 调用 Whisper API
  const isFreely = !!env.FREELY_API_KEY
  const headers = {
    ...form.getHeaders(),
    Authorization: `Bearer ${apiKey}`,
  }
  if (!isFreely) {
    headers['HTTP-Referer'] = 'https://github.com/wangrongding/wechat-bot'
    headers['X-Title'] = 'WeChat Bot (ASR)'
  }

  try {
    const response = await axios.post(`${baseUrl}/audio/transcriptions`, form, {
      headers,
      timeout: 30000,
      maxBodyLength: MAX_AUDIO_SIZE_MB * 1024 * 1024,
    })
    const text = response.data?.text?.trim()
    console.log('[asr] 识别结果:', text)
    return text || '[未识别到语音内容]'
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.response?.data || error.message
    console.error('[asr] Error:', JSON.stringify(detail).substring(0, 300))
    return `[语音识别失败: ${typeof detail === 'string' ? detail.substring(0, 100) : 'API错误'}]`
  } finally {
    // 清理临时文件
    try {
      unlinkSync(filePath)
    } catch (_) {}
    try {
      unlinkSync(wavPath)
    } catch (_) {}
  }
}
