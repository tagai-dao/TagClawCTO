// 启动时从终端输入密码解密 .env，不落盘、不写入 process.env
const { loadEncryptedEnv } = require('./env_crypto');

const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3123;

const { createInstance: createDb, getInstance: getDb, emptyOrRow, emptyOrRows } = require('./db/pool');

// 解析 JSON 格式的请求体
app.use(express.json());

const BotManager = require('./bot_manager');
let botManager;
var isRun = true;
const TwitterAccount = 'TagClaw_CTO';

process.on('SIGINT', () => {
    console.log('Polling tweets stopping');
    isRun = false;
});

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从 Twitter API 原始响应中解析出 BotManager 需要的规范化推文
 * raw 形如 { data, includes: { users, tweets } }
 * 支持所有类型的 referenced_tweets：replied_to（回复）、quoted（引用）、retweeted（转推）
 */
function normalizeTweetPayload(rowId, raw) {
    const data = raw?.data;
    const includes = raw?.includes || {};
    if (!data?.id || !data?.author_id) return null;

    const author = (includes.users || []).find(u => u.id === data.author_id) || {};
    const refs = data.referenced_tweets || [];
    const allTweets = includes.tweets || [];
    const allUsers = includes.users || [];

    // 收集所有类型的相关推文：回复、引用、转推等
    const relatedTweets = [];
    for (const ref of refs) {
        const relatedTweet = allTweets.find(t => t.id === ref.id);
        if (relatedTweet) {
            const relatedAuthor = allUsers.find(u => u.id === relatedTweet.author_id) || {};
            relatedTweets.push({
                type: ref.type, // 'replied_to', 'quoted', 'retweeted'
                id: relatedTweet.id,
                text: relatedTweet.text || '',
                author_id: relatedTweet.author_id,
                author_username: relatedAuthor.username || '',
                author_name: relatedAuthor.name || '',
                created_at: relatedTweet.created_at
            });
        }
    }

    return {
        id: data.id,
        text: data.text || '',
        conversationId: data.conversation_id || data.id,
        author: {
            id: data.author_id,
            name: author.name || '',
            username: author.username || '',
            public_metrics: author.public_metrics || {}
        },
        // 所有相关推文（回复、引用、转推等）
        relatedTweets: relatedTweets.length > 0 ? relatedTweets : null,
        _rowId: rowId
    };
}

/**
 * 检查推文是否 @ 了指定 bot 账号（不区分大小写）
 */
function mentionsBot(data, botUsername) {
    const mentions = data?.entities?.mentions || [];
    return mentions.some(m => (m.username || '').toLowerCase() === (botUsername || '').toLowerCase());
}

async function pollingTweets() {
    console.log('Polling tweets started');
    const botUsername = TwitterAccount; // 与 process 内常量一致，用于 @ 判断

    while (isRun) {
        try {
            // 读取上次处理到的 all_tweets.id 游标
            let sql = `SELECT \`val\` FROM global WHERE \`name\` = 'bsc_tagclaw_cto_tweet_idx'`;
            const idxRow = emptyOrRow(await getDb().execute(sql));
            const idx = idxRow?.val != null ? Number(idxRow.val) : 0;
            console.log('idx', idx);

            sql = `SELECT * FROM all_tweets WHERE id > ? ORDER BY id ASC LIMIT 10`;
            const rows = emptyOrRows(await getDb().execute(sql, [idx]));
            console.log('rows', rows.length);
            if (rows.length === 0) {
                await sleep(3000);
                continue;
            }

            let maxRowId = idx;
            for (const row of rows) {
                let raw;
                try {
                    raw = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
                } catch (e) {
                    console.warn('[Polling] 解析推文 content 失败, id=', row.id, e.message);
                    maxRowId = Math.max(maxRowId, row.id);
                    continue;
                }
                console.log('raw', raw);

                const data = raw?.data;
                if (!data) {
                    maxRowId = Math.max(maxRowId, row.id);
                    continue;
                }

                // 只处理 @ 了 bot 的推文
                if (!mentionsBot(data, botUsername)) {
                    maxRowId = Math.max(maxRowId, row.id);
                    continue;
                }

                // 发布者声誉：若 account 表有该用户且 twitter_reputation < 10 则跳过
                const authorId = data.author_id;
                try {
                    const accSql = `SELECT twitter_reputation FROM account WHERE twitter_id = ? AND is_del = 0 LIMIT 1`;
                    const accRows = await getDb().execute(accSql, [authorId]);
                    console.log('accRows', accRows);
                    const acc = emptyOrRow(accRows);
                    if (acc && acc.twitter_reputation != null && Number(acc.twitter_reputation) < 10) {
                        console.log(`[Polling] 跳过低声誉用户 author_id=${authorId}, rep=${acc.twitter_reputation}`);
                        maxRowId = Math.max(maxRowId, row.id);
                        continue;
                    }
                } catch (e) {
                    // 无 account 表或查询失败时不影响处理
                }

                const normalized = normalizeTweetPayload(row.id, raw);
                if (!normalized) {
                    maxRowId = Math.max(maxRowId, row.id);
                    continue;
                }
                maxRowId = Math.max(maxRowId, row.id);

                await botManager.handleTweet(normalized);
            }

            // 更新游标
            if (maxRowId > idx) {
                try {
                    await getDb().execute(
                        `UPDATE global SET \`val\` = ? WHERE \`name\` = 'bsc_tagclaw_cto_tweet_idx'`,
                        [maxRowId]
                    );
                    console.log('updated idx to', maxRowId);
                } catch (e) {
                    console.warn('[Polling] 更新 global 游标失败:', e.message);
                }
            }
        } catch (error) {
            console.error('[Polling] 轮询异常:', error.message);
        }
        await sleep(3000);
    }
}

// 先解密 .env 再启动服务器
loadEncryptedEnv()
    .then(() => {
        createDb(); // env 已解密，实例化持久化 DB 连接
        botManager = new BotManager();
        pollingTweets().finally(() => {
            console.log('Polling tweets stopped');
            process.exit(0);
        });
    })
    .catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
