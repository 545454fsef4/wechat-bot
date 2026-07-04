# 🤖 WeChat Bot — 微信 AI 机器人

基于 [Wechaty](https://wechaty.js.org/) 的微信个人号 AI 机器人，支持 DeepSeek / ChatGPT / Claude / Ollama 等 AI 后端。**支持 Railway 云端 24 小时部署。**

---

## 🚀 快速开始

### 本地部署（3 分钟）

```bash
git clone https://github.com/545454fsef4/wechat-bot.git
cd wechat-bot
npm install
cp .env.example .env
# 编辑 .env 填入配置
npm start
```

终端出现二维码后，微信扫码登录。

### ☁️ Railway 云端部署（24 小时在线，关机也能用）

> 免费额度：每月 $5 或 30 天，足够微信机器人运行

**Step 1: Fork 仓库** 点击右上角 Fork → 复制到你的 GitHub

**Step 2: 连接 Railway**

1. 打开 [Railway](https://railway.com) → Login with GitHub
2. New Project → Deploy from GitHub → 选择 `wechat-bot`
3. 部署会自动开始

**Step 3: 配置环境变量** 在 Railway 项目 → 微信机器人 → Variables 添加：

| 变量名                | 值                                          |
| --------------------- | ------------------------------------------- |
| `DEEPSEEK_FREE_URL`   | `https://api.deepseek.com/chat/completions` |
| `DEEPSEEK_FREE_MODEL` | `deepseek-chat`                             |
| `DEEPSEEK_FREE_TOKEN` | 你的 DeepSeek API Key                       |
| `BOT_NAME`            | `@你的微信昵称`                             |

**Step 4: 扫码登录**

1. Railway → Logs → 找到 `onScan: https://api.qrserver.com/...` 链接
2. 浏览器打开链接 → 微信扫码 → 手机上确认登录
3. 看到 `Contact<xxx> has logged in` 即成功

---

## 📋 全部部署流程（本次实际操作记录）

### 环境

- Windows 10, Node.js v24, Git
- DeepSeek API（deepseek-chat 模型）

### 1. 克隆并安装

```bash
git clone https://github.com/wangrongding/wechat-bot.git
cd wechat-bot
npm install
```

### 2. 配置 .env

```env
SERVICE_TYPE=deepseek-free
DEEPSEEK_FREE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_FREE_MODEL=deepseek-chat
DEEPSEEK_FREE_TOKEN=sk-xxxxxxxx
BOT_NAME=@微信昵称
ALIAS_WHITELIST=
ROOM_WHITELIST=
```

### 3. 修复空白名单 Bug

`src/wechaty/sendMessage.js` 第 24-25 行：

```js
// 修改前（空名单 = 谁都触发不了）
const isRoom = roomWhiteList.includes(roomName) && ...
const isAlias = aliasWhiteList.includes(remarkName) || ...

// 修改后（空名单 = 全部开放）
const isRoom = (roomWhiteList.length === 0 || roomWhiteList.includes(roomName)) && ...
const isAlias = aliasWhiteList.length === 0 || aliasWhiteList.includes(remarkName) || ...
```

### 4. Railway 适配

**railway-entry.js** — 绕过 CLI，直接启动 + HTTP 健康检查：

```js
import http from 'http'

const PORT = process.env.PORT || 3000
http
  .createServer((req, res) => {
    res.writeHead(200)
    res.end('OK')
  })
  .listen(PORT)

async function main() {
  const { startWechatBot } = await import('./src/platforms/wechat/bot.js')
  startWechatBot({ serviceType: 'deepseek-free' })
}
main()
```

### 5. 修复 wechat4u 400 错误

`patches/wechat4u+0.7.14.patch` — 用 `patch-package` 固化：

```js
// node_modules/wechat4u/lib/core.js:139
// 改前：_util.assert.notEqual(window.code, 400, res);
// 改后：
if (window.code === 400) {
  console.log('WeChat returned 400, retrying...')
  throw new Error('WeChat login returned 400, will retry')
}
```

### 6. 推送并部署

```bash
git remote set-url origin https://github.com/545454fsef4/wechat-bot.git
git add -A && git commit -m "fix: railway deploy" && git push
# Railway 自动部署
```

---

## ⚙️ 配置说明

| 变量                  | 说明                    | 默认值          |
| --------------------- | ----------------------- | --------------- |
| `SERVICE_TYPE`        | AI 服务类型             | `deepseek-free` |
| `DEEPSEEK_FREE_TOKEN` | DeepSeek API Key        | 必填            |
| `DEEPSEEK_FREE_MODEL` | 模型名                  | `deepseek-chat` |
| `BOT_NAME`            | 群聊 @触发名            | 必填            |
| `ALIAS_WHITELIST`     | 联系人白名单，空=全开放 | 空              |
| `ROOM_WHITELIST`      | 群聊白名单，空=全开放   | 空              |

---

## 🔧 支持的 AI 服务

| 服务     | `SERVICE_TYPE`  |
| -------- | --------------- |
| DeepSeek | `deepseek-free` |
| ChatGPT  | `ChatGPT`       |
| Claude   | `claude`        |
| Kimi     | `Kimi`          |
| 豆包     | `doubao`        |
| 通义千问 | `tongyi`        |
| Ollama   | `ollama`        |

---

## ❓ 常见问题

**群聊不回复？** 需要 @机器人名称，且白名单为空或包含群名

**私聊不回复？** 白名单为空或包含联系人昵称

**Railway 部署崩溃？** 确保设置了环境变量，且已 Fork 本仓库（包含修复补丁）

**会封号吗？** Web 协议存在风控风险，建议用小号测试

---

## 📦 技术栈

- Node.js + Wechaty
- patch-package（固化依赖补丁）
- Railway 云端托管
