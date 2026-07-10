import axios from 'axios'
import dotenv from 'dotenv'
// 加载环境变量
dotenv.config()
const env = dotenv.config().parsed // 环境参数
const token = env.DEEPSEEK_FREE_TOKEN
const model = env.DEEPSEEK_FREE_MODEL
const url = env.DEEPSEEK_FREE_URL
const syscontent = env.DEEPSEEK_FREE_SYSTEM_MESSAGE

function setConfig(prompt, userName) {
  const userMessage = userName ? `[对话者: ${userName}] ${prompt}` : prompt
  return {
    method: 'post',
    maxBodyLength: Infinity,
    url: url,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    data: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: syscontent,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      stream: false,
    }),
  }
}

export async function getDeepSeekFreeReply(prompt, userName = '') {
  try {
    const config = setConfig(prompt, userName)
    const response = await axios(config)
    const { choices } = response.data
    return choices[0].message.content
  } catch (error) {
    console.error(error.code)
    console.error(error.message)
  }
}
