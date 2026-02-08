const axios = require('axios');
const { getInstance: getDb } = require('./db/pool');
// env 由入口（server.js）通过 loadEncryptedEnv 加载，此处不再加载

class BotManager {
    constructor() {
        this.OPENCLAW_API_URL = 'http://127.0.0.1:18789/v1/chat/completions';
        
        // 状态
        this.processedTweets = new Set(); // Set<tweetId>
        this.sessions = new Map(); // Map<userId, { sessionId: string, createdAt: number }>
        
        // 限流 - 天级
        this.dailyStats = {
            date: new Date().toDateString(),
            globalCount: 0,
            userCounts: new Map() // Map<userId, number>
        };

        // 限流 - 分钟级
        this.minuteStats = new Map(); // Map<userId, { windowStart: number, count: number }>
        
        // 队列
        this.queues = new Map(); // Map<userId, Array<tweet>>
        
        // 启动队列消费者
        // 每 5 秒尝试处理积压的消息
        setInterval(() => this.processQueues(), 5000); 
        
        console.log('🤖 BotManager initialized');
    }

    /**
     * 处理推文入口
     */
    async handleTweet(tweet) {
        if (!tweet || !tweet.id || !tweet.author || !tweet.author.id) {
            console.warn('[Bot] 无效的推文数据', tweet);
            return;
        }

        // 1. 去重
        if (this.processedTweets.has(tweet.id)) {
            console.log(`[Bot] ⚠️ 推文 ${tweet.id} 已处理，跳过`);
            return;
        }
        this.processedTweets.add(tweet.id);

        const userId = tweet.author.id;
        
        // 2. 检查天级限流
        this.checkDailyReset();
        
        if (this.dailyStats.globalCount >= 100) {
            console.log(`[Bot] 🛑 全局日限额已达 (100)，忽略推文`);
            return;
        }
        
        const userDailyCount = this.dailyStats.userCounts.get(userId) || 0;
        if (userDailyCount >= 20) {
            console.log(`[Bot] 🛑 用户 ${userId} 日限额已达 (20)，忽略推文`);
            return;
        }

        // 3. 检查分钟级限流 & 决定是否入队
        if (this.canProcessImmediately(userId)) {
            // 立即执行
            await this.executeReply(tweet);
        } else {
            // 入队
            console.log(`[Bot] ⏳ 用户 ${userId} 触发频控 (>10/min)，加入队列`);
            this.enqueue(userId, tweet);
        }
    }

    /**
     * 判断用户当前分钟是否还有额度
     */
    canProcessImmediately(userId) {
        const now = Date.now();
        let stat = this.minuteStats.get(userId);
        
        // 如果没有记录，或者记录已经是 60秒 之前的了，重置窗口
        if (!stat || (now - stat.windowStart > 60000)) {
            stat = { windowStart: now, count: 0 };
            this.minuteStats.set(userId, stat);
        }
        
        // 检查额度
        if (stat.count < 10) {
            stat.count++;
            return true;
        }
        
        return false;
    }

    enqueue(userId, tweet) {
        if (!this.queues.has(userId)) {
            this.queues.set(userId, []);
        }
        this.queues.get(userId).push(tweet);
    }

    async processQueues() {
        for (const [userId, queue] of this.queues) {
            if (queue.length === 0) continue;

            // 再次检查日限额
            if (this.dailyStats.globalCount >= 100 || (this.dailyStats.userCounts.get(userId) || 0) >= 20) {
                console.log(`[Bot] 用户 ${userId} 日限额已满，清空队列 (${queue.length} 条)`);
                queue.length = 0; 
                continue;
            }

            // 循环尝试消费
            while (queue.length > 0) {
                if (this.canProcessImmediately(userId)) {
                    const tweet = queue.shift();
                    console.log(`[Bot] 🚀 从队列处理用户 ${userId} 的任务`);
                    await this.executeReply(tweet);
                } else {
                    break;
                }
            }
        }
    }

    checkDailyReset() {
        const today = new Date().toDateString();
        if (this.dailyStats.date !== today) {
            console.log(`[Bot] 🌅 新的一天 (${today})，重置日限额计数`);
            this.dailyStats.date = today;
            this.dailyStats.globalCount = 0;
            this.dailyStats.userCounts.clear();
        }
    }

    getSessionId(userId) {
        const now = Date.now();
        let session = this.sessions.get(userId);
        
        // 如果没有session或者session超过2小时
        if (!session || (now - session.createdAt > 2 * 60 * 60 * 1000)) {
            const newSessionId = `u_${userId}_${now}`;
            session = { sessionId: newSessionId, createdAt: now };
            this.sessions.set(userId, session);
            console.log(`[Bot] 🔄 用户 ${userId} 会话过期/新建: ${newSessionId}`);
        }
        
        return session.sessionId;
    }

    async executeReply(tweet) {
        const userId = tweet.author.id;
        
        if (this.dailyStats.globalCount >= 100) return;
        const currentUserCount = this.dailyStats.userCounts.get(userId) || 0;
        if (currentUserCount >= 20) return;

        this.dailyStats.globalCount++;
        this.dailyStats.userCounts.set(userId, currentUserCount + 1);

        const sessionId = this.getSessionId(userId);
        const prompt = '查看该推文的text内容，根据其内容要求，做出回复，有必要的话进行一些网页搜索。比如用户需要你分析回复的原推文是否是真实事件，或者给出一些关于原推文的详细描述，你需要去查询对应的推文来做出回复。回复不超过280个字符。以下是推文数据：\n'
        const message = prompt + tweet.text;

        console.log(`[Bot] 🤖 正在调用 AI (Session: ${sessionId}) 回复推文: ${tweet.id}`);

        try {
            const response = await axios.post(this.OPENCLAW_API_URL, {
                messages: [
                    { role: 'user', content: message }
                ],
                model: "openclaw",
                user: sessionId,
                max_tokens: 200,
                stream: false
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.API_TOKEN}`,
                    'x-openclaw-agent-id': 'main'
                },
                timeout: 60000
            });

            let aiReply = response.data.choices?.[0]?.message?.content || "";
            
            if (aiReply.length > 280) {
                aiReply = aiReply.substring(0, 280);
            }

            console.log(`[Bot] ✅ AI 回复成功: ${aiReply.substring(0, 50).replace(/\n/g, ' ')}...`);

            // 写入数据库任务表
            // type默认填4，parent_id是需要直接回复的推文id，content是需要回复的内容
            // tweet_id 填 conversationId
            try {
                const sql = `INSERT INTO tiptag_reply_task (type, tweet_id, parent_id, content) VALUES (?, ?, ?, ?)`;
                // 注意：tweet.conversationId 必须存在，否则可能会有问题，这里假设数据结构符合 demo
                const params = [4, tweet.conversationId, tweet.id, aiReply];
                await getDb().execute(sql, params);
                console.log(`[Bot] 💾 回复任务已写入数据库 (type=4, parent_id=${tweet.id})`);
            } catch (dbError) {
                // 如果是重复键错误(ER_DUP_ENTRY)，说明该 conversation 已经有任务了，记录一下即可
                if (dbError.code === 'ER_DUP_ENTRY') {
                    console.log(`[Bot] ⚠️ 任务写入跳过: 该 Conversation (${tweet.conversationId}) 已存在回复任务`);
                } else {
                    console.error(`[Bot] ❌ 任务写入数据库失败: ${dbError.message}`);
                }
            }

        } catch (error) {
            console.error(`[Bot] ❌ AI 调用失败: ${error.message}`);
        }
    }
}

module.exports = BotManager;
