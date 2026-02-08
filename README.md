# OpenXclaw

基于 Twitter Webhook 的回复机器人服务：接收推文事件，调用 Openclaw AI 生成回复，并将回复任务写入数据库，由下游服务完成发推。

---

## 功能概览

- **Webhook 接收**：提供 `/webhook` 接口接收 Twitter 平台推送的推文事件
- **AI 回复**：通过 Openclaw HTTP 接口生成回复内容，支持日/分钟级限流与按用户队列
- **任务落库**：将待回复任务写入 MySQL 表 `tiptag_reply_task`，供其他服务消费
- **中转服务**：`proxy.js` 提供 `/chat` HTTP 接口，对外封装与 Openclaw 的对话能力
- **配置加密**：`.env` 以密码加密存储，启动时由管理员在终端输入密码解密，秘钥不落盘、不写入环境变量，降低服务器被入侵后的泄露风险

---

## 环境要求

- Node.js（建议 18+）
- MySQL 5.7+（用于 `tiptag_reply_task` 等表）
- 本地或内网可访问的 Openclaw 服务（默认 `http://127.0.0.1:18789`）

---

## 安装

```bash
git clone <repo>
cd openxclaw
npm install
```

---

## 配置

### 1. 明文 .env（仅用于首次加密）

在**本机或安全环境**创建明文 `.env`，例如：

```env
PORT=3123
TWITTER_API_KEY=你的_Twitter_Webhook_校验密钥
API_TOKEN=Openclaw_API_令牌

DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=你的数据库名
```

### 2. 加密 .env（必做一步）

运行加密脚本，将明文 `.env` 用密码加密并**覆盖**为密文（Base64 字符串，可读）：

```bash
node encrypt_env.js
```

按提示输入加密密码（此密码需牢记，每次启动服务都要输入）。执行完成后，当前目录的 `.env` 已变为密文，可将该文件部署到服务器，**不要在服务器上保留明文 .env**。

### 3. 启动时解密

运行 `server.js` 或 `proxy.js` 时，程序会提示：

```
请输入 .env 解密密码:
```

输入加密时使用的密码（输入不回显），解密成功后服务才会启动。密码仅用于本次进程解密，不会写入 `process.env` 或任何文件。

---

## 数据库

- 使用前请先创建库并执行建表 SQL：
  - 表结构见 `db/replyTask.sql`（`tiptag_reply_task`）
- 连接信息来自解密后的 `.env`：`DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`
- DB 连接池在 **loadEncryptedEnv 完成后** 才实例化，确保用到的已是解密后的配置

---

## AI 回复的限流与队列

Webhook 收到推文后，由 `bot_manager.js` 统一处理，在调用 AI 前会做限流与排队（以代码中实际配置为准）。

### 限流规则

| 类型     | 限制说明 |
|----------|----------|
| **日级 · 全局** | 全站每天最多处理 **100** 条推文，达限后新推文直接忽略 |
| **日级 · 单用户** | 同一用户（按 `author.id`）每天最多 **20** 条，达限后该用户新推文忽略 |
| **分钟级 · 单用户** | 同一用户在同一 **60 秒** 窗口内最多 **10** 条，超出部分不立即执行，进入该用户队列 |

日级统计在每天 0 点（按 `Date.toDateString()`）自动重置；分钟级按 60 秒滑动窗口重置。

### 队列行为

- **入队条件**：某用户在当前分钟窗口内已处理满 10 条时，新推文会进入该用户专属队列（按 `userId` 分队列）。
- **消费时机**：每 **5 秒** 执行一次队列消费；每次消费时仍受「分钟级 10 条」限制，有额度则从该用户队列里取一条调用 AI 并写库，直到本分钟额度用尽或队列空。
- **日限与队列**：若消费时发现该用户或全局已达日限额，会清空该用户队列并不再处理其积压任务。

### 其他

- 推文按 `tweet.id` 去重，同一条推文只会处理一次。

---

## 启动方式

### Webhook 服务（主入口）

接收 Twitter Webhook，处理推文并写回复任务到 DB：

```bash
node server.js
```

启动时会先要求输入 `.env` 解密密码，再监听 `PORT`（默认 3123）。  
本地测试 Webhook 地址：`http://localhost:3123/webhook`。

### 中转服务（可选）

对外提供 HTTP `/chat`，转发到 Openclaw：

```bash
node proxy.js
```

同样会先提示输入解密密码，再监听配置的端口（见 `proxy.js` 内 `PROXY_PORT`）。  
请求示例：`POST /chat`，Body：`{ "userId": "user_123", "message": "你好" }`。

---

## 项目结构

```
openxbot/
├── server.js          # Webhook 服务入口，/webhook 接收推文
├── proxy.js           # 对外 /chat 中转，调用 Openclaw
├── bot_manager.js     # 推文处理逻辑：限流、队列、AI 回复、写 DB
├── env_crypto.js      # .env 加解密（PBKDF2 + AES-256-GCM）
├── encrypt_env.js     # 加密脚本：明文 .env → 密文 .env
├── db/
│   ├── pool.js        # DB 工具对象，持久化连接池，需在 loadEncryptedEnv 后 createInstance
│   └── replyTask.sql  # tiptag_reply_task 建表语句
├── package.json
└── README.md
```

---

## 安全说明

- **秘钥存储**：服务器上只存放加密后的 `.env`（Base64 密文），不存明文
- **密码输入**：仅通过终端交互输入，不写入环境变量、不写文件、不记日志
- **威胁模型**：即使服务器被登录，没有解密密码也无法还原 API 密钥与 DB 密码
- **加密算法**：PBKDF2(100000) + AES-256-GCM，密文带 salt/iv/authTag

---

## 依赖

- express：HTTP 服务
- axios：请求 Openclaw
- mysql2：MySQL 连接池
- body-parser、cors：proxy 请求解析与跨域
- dotenv：仅作可选依赖保留，实际配置由 env_crypto 解密后注入 `process.env`

---

## License

ISC
