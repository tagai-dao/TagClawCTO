const axios = require('axios');
// env 由入口（server.js）通过 loadEncryptedEnv 加载，此处不再加载

class BotManager {
    constructor() {
        this.CLAWDBOT_API_URL = 'http://127.0.0.1:18789/v1/chat/completions';
        
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
        const message = tweet.text;

        console.log(`[Bot] 🤖 正在调用 AI (Session: ${sessionId}) 回复推文: ${tweet.id}`);

        try {
            const response = await axios.post(this.CLAWDBOT_API_URL, {
                messages: [
                    { role: 'user', content: message }
                ],
                model: "clawdbot:safe-response",
                user: sessionId,
                max_tokens: 200,
                stream: false
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer 75d4d71d41614528a031c98b55ba99a6c03c4c918522eb57',
                    'x-clawdbot-agent-restrictions': 'exec:deny,read:deny,write:deny,browser:deny,nodes:deny,memory_search:deny,web_fetch:deny',
                    'x-clawdbot-session-max-turns': '1'
                },
                timeout: 60000
            });

            let aiReply = response.data.choices?.[0]?.message?.content || "";
            
            if (aiReply.length > 280) {
                aiReply = aiReply.substring(0, 280);
            }

            console.log(`[Bot] ✅ AI 回复成功: ${aiReply.substring(0, 50).replace(/\n/g, ' ')}...`);

        } catch (error) {
            console.error(`[Bot] ❌ AI 调用失败: ${error.message}`);
        }
    }
}

module.exports = BotManager;
