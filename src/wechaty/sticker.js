// 表情包名称 → 本地图片路径 映射
// 图片放在 stickers/ 目录下，在 sendMessage.js 同级用 FileBox.fromFile() 发送
// 添加新表情：放图片到 stickers/，在下面加一行映射即可
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const S = (name) => join(__dirname, '..', '..', 'stickers', name)

export const stickerMap = {
  ok: S('ok.gif'),
  no: S('no.gif'),
  laugh: S('laugh.gif'),
  cry: S('cry.gif'),
  angry: S('angry.gif'),
  love: S('love.gif'),
  sleep: S('sleep.gif'),
  bye: S('bye.gif'),
  question: S('question.gif'),
  thumbsup: S('thumbsup.gif'),
}

// 检查 AI 回复中是否包含 [sticker:名称] 标记
// 返回 { text: 清理后的文字, stickerFile: 表情包路径|null }
export function parseStickerTag(text) {
  const m = text.match(/\[sticker:(\w+)\]/)
  if (!m) return { text, stickerFile: null }
  const name = m[1].toLowerCase()
  const stickerFile = stickerMap[name] || null
  return { text: text.replace(m[0], '').trim(), stickerFile }
}
