/**
 * 将当前目录的明文 .env 用密码加密后写回 .env（覆盖）
 * 使用方式：先确保 .env 为明文，运行 node encrypt_env.js，按提示输入密码
 * 运行后 .env 变为密文，请勿再在服务器上保留明文 .env
 */

const fs = require('fs');
const path = require('path');
const { encrypt, promptPassword } = require('./env_crypto');

const envPath = path.join(process.cwd(), '.env');

async function main() {
  if (!fs.existsSync(envPath)) {
    console.error('未找到 .env 文件');
    process.exit(1);
  }
  const plainText = fs.readFileSync(envPath, 'utf8');
  if (!plainText.trim()) {
    console.error('.env 为空，无需加密');
    process.exit(1);
  }
  const password = await promptPassword('请输入加密密码（将用于以后启动时解密）: ');
  if (!password) {
    console.error('密码不能为空');
    process.exit(1);
  }
  const cipherBuffer = encrypt(plainText, password);
  // 转为 Base64 字符串再写入，便于查看/版本管理
  const base64 = cipherBuffer.toString('base64');
  fs.writeFileSync(envPath, base64, 'utf8');
  console.log('已加密并写回 .env（Base64 格式），请勿在服务器上保留明文备份。');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
