DROP TABLE IF EXISTS `tiptag_reply_task`;
CREATE TABLE `tiptag_reply_task` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` int NOT NULL DEFAULT '0' COMMENT '由哪个账号进行回复\n0: tiptag\n1: launchonbnb\n2: tiptagx\n3: tiptagai',
  `tweet_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原推文id,conversation_id',
  `parent_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reply_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reply_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Farcaster hash\n如果是同步farcaster的回复到tiptag，该字段有值，推特回复后，将该记录同步到relation_reply表',
  `state` tinyint(1) NOT NULL DEFAULT '0',
  `create_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique` (`tweet_id`)
) ENGINE=InnoDB AUTO_INCREMENT=232036 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='需要由tiptag官方回复的任务加入到该表，由单独的服务按顺序回复推特\n可能有多种回复的主体，目前有tiptagai，用户对使用tiptagai部署代币的推文进行回复';

DROP TABLE IF EXISTS `all_tweets`;
CREATE TABLE `all_tweets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tweet_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `synced` tinyint(1) NOT NULL DEFAULT '0',
  `create_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=14847 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC COMMENT='所有被抓取的twitter会显示在这里\n抓取的clanker相关的帖子从这里获取';


-- ----------------------------
-- Table structure for account
-- ----------------------------
DROP TABLE IF EXISTS `account`;
CREATE TABLE `account` (
  `id` int NOT NULL AUTO_INCREMENT,
  `twitter_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '当账号类型是email时，这里存邮箱地址',
  `account_type` int NOT NULL DEFAULT '0' COMMENT '账号类型：\n0， twitter\n1，email',
  `btc_addr` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nuls_addr` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eth_addr` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sol_addr` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `steem_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twitter_name` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `twitter_username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `profile` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `followers` int NOT NULL DEFAULT '0',
  `followings` int NOT NULL DEFAULT '0',
  `hide_mindshare` tinyint(1) NOT NULL DEFAULT '0' COMMENT '屏蔽计算mindshare分数',
  `is_project` tinyint(1) NOT NULL DEFAULT '0' COMMENT '该账号是否是项目方账号\n在计算账号mindshare的时候，项目方数据和个人数据是分开的',
  `last_read_message_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `wallet_type` int NOT NULL DEFAULT '1' COMMENT '钱包类型：\n0：插件钱包\n1：privy推特授权',
  `in_steem_white_list` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否加入steem注册白名单\n用户可以免费注册steem账号，只需要前端签名就可以',
  `vp` int NOT NULL DEFAULT '200',
  `op` int NOT NULL DEFAULT '2000',
  `last_update_vp_stamp` bigint NOT NULL DEFAULT '0',
  `last_update_op_stamp` bigint NOT NULL DEFAULT '0',
  `is_del` tinyint(1) NOT NULL DEFAULT '0',
  `verified` tinyint(1) NOT NULL DEFAULT '0',
  `twitter_reputation` double NOT NULL DEFAULT '0',
  `last_update_rep_time` datetime DEFAULT NULL COMMENT '最后更新推特声誉的时间',
  `tweet_count` int NOT NULL DEFAULT '0',
  `listed_count` int NOT NULL DEFAULT '0',
  `like_count` int NOT NULL DEFAULT '0',
  `update_eth_addr_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `create_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique` (`twitter_id`),
  UNIQUE KEY `eth` (`eth_addr`) USING BTREE
) 