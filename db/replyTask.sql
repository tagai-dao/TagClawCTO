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
