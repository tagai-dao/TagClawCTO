const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 配置区域 ---
const CLAWDBOT_API_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const PROXY_PORT = 3000;

/**
 * API 接口: POST /chat
 * 请求体: { "userId": "user_123", "message": "你好" }
 */
app.post('/chat', async (req, res) => {
    const { userId, message } = req.body;

    if (!userId || !message) {
        return res.status(400).json({ error: '缺少 userId 或 message' });
    }

    console.log(`[请求] 用户: ${userId} | 内容: ${message}`);

    try {
        // 直接调用 Clawdbot 的 HTTP 接口
        const response = await axios.post(CLAWDBOT_API_URL, {
            // 构造符合 OpenAI 标准的消息格式
            messages: [
                { role: 'user', content: message }
            ],
            // 使用 model 字段指定 agent
            model: "clawdbot:main",
            // OpenAI user 字段用于生成稳定 sessionId
            user: `app_user_${userId}`,
            max_tokens: 200,  // 限制回复长度
            stream: false // 设置为 false 方便中转层直接获取完整回复
        }, {
            headers: {
                'Authorization': 'Bearer 75d4d71d41614528a031c98b55ba99a6c03c4c918522eb57',
                'Content-Type': 'application/json',
                // 👇 安全限制：禁止危险工具
                'x-clawdbot-agent-restrictions': 'exec:deny,read:deny,write:deny,browser:deny,nodes:deny,memory_search:deny,web_fetch:deny',
                // 👇 只允许一次回复
                'x-clawdbot-session-max-turns': '1'
            },
            timeout: 60000 // 设置 60 秒超时，防止长文本生成过慢
        });

        // 提取 AI 的回复内容
        let aiReply = response.data.choices[0].message.content;
        
        // 确保不超过 280 个中文字符
        if (aiReply.length > 280) {
            aiReply = aiReply.substring(0, 280) + '...';
        }

        console.log(`[成功] 回复用户: ${userId}`);
        
        res.json({
            status: 'success',
            reply: aiReply,
            length: aiReply.length
        });

    } catch (error) {
        console.error(`[错误] 用户: ${userId} | 原因:`, error.message);
        
        if (error.response) {
            // Clawdbot 返回了错误
            res.status(error.response.status).json({ error: 'AI 服务响应错误', details: error.response.data });
        } else {
            // 网络或其他错误
            res.status(500).json({ error: '无法连接到 AI 服务' });
        }
    }
});

// ✅ 添加根路径响应
app.get('/', (req, res) => {
    res.json({ status: 'proxy running', endpoint: '/chat' });
});

app.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------------`);
    console.log(`🚀 稳定版中转服务已启动 (HTTP 模式)`);
    console.log(`👉 端口: ${PROXY_PORT}`);
    console.log(`👉 地址: http://[2a02:c207:2244:7382::1]:${PROXY_PORT}/chat`);
    console.log(`👉 根路径: http://[2a02:c207:2244:7382::1]:${PROXY_PORT}/`);
    console.log(`-----------------------------------------`);
})