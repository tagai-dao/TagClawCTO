const axios = require('axios');
const { getInstance: getDb } = require('./db/pool');
// env 由入口（server.js）通过 loadEncryptedEnv 加载，此处不再加载

/** 每次请求时发给 agent 的固定提示词：角色、任务与约束 */
const AGENT_REPLY_PROMPT = `你是 TagClaw CTO 的推特回复助手，风格专业、简洁，像 Grok 一样直接回应用户需求。

任务：根据下面给出的「推文数据」理解发推者的意图（提问、求分析、求链接、求解释等），生成一条可直接发布的回复。必要时可基于上下文推断或说明你会基于公开信息/常识回答；若需要更具体的推特数据才能准确回答，可尝试查询推文信息。
如果用户的推文没有明确的提问需求，或者一些你看起来不用回复的推文，你也可以不用回复，直接返回空字符串。

硬性约束：
- 只输出一条回复，不要输出多条或元描述（如「我会去查……」）。
- 回复总字数（含标点、@）严格不超过 200 字。
- 直接给出可发出去的回复正文，不要加引号或「回复：」等前缀。`;

/** 将规范化推文格式化为供 agent 阅读的文本 */
function buildTweetContext(tweet) {
    const lines = [];
    lines.push('【发推者】');
    lines.push(`  @${tweet.author?.username || 'unknown'} (${tweet.author?.name || ''}), id=${tweet.author?.id || ''}`);
    const metrics = tweet.author?.public_metrics || {};
    if (Object.keys(metrics).length) {
        lines.push(`  粉丝/关注/推文数: ${metrics.followers_count ?? '-'}/${metrics.following_count ?? '-'}/${metrics.tweet_count ?? '-'}`);
    }
    lines.push('');
    lines.push('【当前推文】（用户 @ 你的这条）');
    lines.push(`  ${tweet.text || '(无正文)'}`);
    
    // 展示所有相关推文（回复、引用、转推等）
    if (tweet.relatedTweets && tweet.relatedTweets.length > 0) {
        lines.push('');
        lines.push('【相关推文】（用户引用的推文，供参考）');
        
        // 按类型分组展示
        const typeLabels = {
            'replied_to': '回复的原推',
            'quoted': '引用的推文',
            'retweeted': '转推的原推'
        };
        
        for (const related of tweet.relatedTweets) {
            const typeLabel = typeLabels[related.type] || related.type;
            lines.push(`  [${typeLabel}] @${related.author_username || 'unknown'} (${related.author_name || ''}):`);
            lines.push(`    ${related.text || '(无正文)'}`);
        }
    }
    
    lines.push('');
    lines.push('请根据上述内容生成一条回复（仅一条，≤200 字）：');
    return lines.join('\n');
}

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
        const message = AGENT_REPLY_PROMPT + '\n\n' + buildTweetContext(tweet);

        console.log(`[Bot] 🤖 正在调用 AI (Session: ${sessionId}) 回复推文: ${tweet.id}`);

        try {
            const response = await axios.post(this.OPENCLAW_API_URL, {
                messages: [
                    { role: 'user', content: message }
                ],
                model: "openclaw:tagclaw-cto",
                user: sessionId,
                max_tokens: 256,
                stream: false
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.API_TOKEN}`,
                    'x-openclaw-agent-id': 'tagclaw-cto'
                },
                timeout: 60000
            });

            let aiReply = (response.data.choices?.[0]?.message?.content || '').trim();
            // 只回复一条：取首行，字数严格 ≤200，且不超过推特 280
            const firstLine = (aiReply.split(/\r?\n/)[0] || aiReply).trim();
            aiReply = firstLine || aiReply;
            if (aiReply.length > 200) aiReply = aiReply.substring(0, 200);
            if (aiReply.length > 280) aiReply = aiReply.substring(0, 280);

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
