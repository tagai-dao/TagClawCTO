// 启动时从终端输入密码解密 .env，不落盘、不写入 process.env
const { loadEncryptedEnv } = require('./env_crypto');

const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const { execute } = require('./db/pool');

// 解析 JSON 格式的请求体
app.use(express.json());

const BotManager = require('./bot_manager');
let botManager;

// --- Express Routes ---

// 首页路由
app.get('/', async (req, res) => {
    res.status(200).send('Twitter Webhook Receiver is running! 🚀');
});

app.post('/', (req, res) => {
    res.status(200).send('Test received successfully');
});

// 核心 Webhook 接收接口
app.post('/webhook', (req, res) => {
    console.log('[Debug] 收到 Webhook 请求');
    // 1. 快速响应 200 OK (平台要求)
    res.status(200).send('Webhook received successfully');

    // 2. 异步处理逻辑
    (async () => {
        try {
            const receivedKey = req.headers['x-api-key'];
            const myApiKey = process.env.TWITTER_API_KEY;
        
            if (myApiKey && receivedKey !== myApiKey) {
                console.warn(`⚠️ 警告: 收到未授权的请求!`);
                return;
            }
        
            const payload = req.body;
            
            if (payload.event_type === 'tweet' && payload.tweets) {
                console.log(`\n[Webhook] 收到 ${payload.tweets.length} 条推文`);
                
                for (const tweet of payload.tweets) {
                    // 调用 BotManager 处理
                    // 注意：不需要 await，让它后台跑，以免阻塞（其实已经 res.send 了，也不会阻塞 HTTP，但最好捕获异常）
                    botManager.handleTweet(tweet).catch(err => {
                        console.error('[Bot] 处理推文异常:', err);
                    });
                }
            }
        } catch (error) {
            console.error('[Webhook] 处理流程错误:', error);
        }
    })();
});

// 先解密 .env 再启动服务器
loadEncryptedEnv()
    .then(() => {
        console.log('🔑 .env 解密成功', process.env);
        botManager = new BotManager();
        app.listen(PORT, () => {
            console.log(`\n🚀 服务已启动! 监听端口: ${PORT}`);
            console.log(`👉 本地测试地址: http://localhost:${PORT}/webhook`);
        });
    })
    .catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
