// 启动时从终端输入密码解密 .env，不落盘、不写入 process.env
const { loadEncryptedEnv } = require('./env_crypto');

const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3123;

const { createInstance: createDb } = require('./db/pool');

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

async function pollingTweets() {
    console.log('Polling tweets started');
    while(isRun) {
        try {
            // get new tweets from db

            // 解析推文

            // 是否@了bot账号

            // 发布者的推特声誉是否超过10 

            // 加入处理队列
        } catch (error) {
            
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
