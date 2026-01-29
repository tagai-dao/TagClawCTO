/**
 * env 加密/解密模块
 * - 磁盘只存密文 .env，密码仅由管理员在启动时从终端输入，不落盘、不写入 process.env
 * - 使用 PBKDF2 + AES-256-GCM，密文格式: salt(16) + iv(12) + ciphertext + authTag(16)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const PBKDF2_ITERATIONS = 100000;

/**
 * 从密码和盐派生 AES 密钥
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

/**
 * 加密明文（.env 全文）
 * @param {string} plainText - 明文内容
 * @param {string} password - 用户密码
 * @returns {Buffer} 密文：salt(16) + iv(12) + ciphertext + tag(16)
 */
function encrypt(plainText, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, encrypted, tag]);
}

/**
 * 解密密文为明文
 * @param {Buffer} cipherBuffer - 密文（含 salt + iv + ciphertext + tag）
 * @param {string} password - 用户密码
 * @returns {string} 明文
 */
function decrypt(cipherBuffer, password) {
  const salt = cipherBuffer.subarray(0, SALT_LEN);
  const iv = cipherBuffer.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = cipherBuffer.subarray(cipherBuffer.length - TAG_LEN);
  const encrypted = cipherBuffer.subarray(SALT_LEN + IV_LEN, cipherBuffer.length - TAG_LEN);

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * 解析 .env 格式文本为键值对（简单实现：KEY=VALUE，支持引号、忽略 # 注释与空行）
 */
function parseEnvText(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * 从终端读取密码（不回显，不写入任何地方）
 * @param {string} [promptText] - 提示文案，默认「请输入 .env 解密密码: 」
 */
function promptPassword(promptText) {
  const msg = promptText || '请输入 .env 解密密码: ';
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY && stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    process.stdout.write(msg);
    let password = '';
    const onData = (ch) => {
      const s = ch.toString();
      if (s === '\n' || s === '\r' || s === '\u0004') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw);
        stdin.removeListener('data', onData);
        stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else {
        password += s;
      }
    };
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  }).then((pwd) => pwd.replace(/\r?\n?$/, '').trim());
}

/**
 * 读取加密的 .env，提示输入密码，解密并填充 process.env
 * 密码仅用于本次解密，不写入 process.env 或任何文件
 * @param {string} [envPath] - 加密的 .env 文件路径，默认项目根目录 .env
 * @returns {Promise<void>}
 */
/**
 * 将文件内容转为密文 Buffer：支持 Base64 字符串（可读）或原始二进制（兼容旧格式）
 */
function toCipherBuffer(data) {
  if (Buffer.isBuffer(data)) {
    const str = data.toString('utf8').replace(/\s/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(str) && str.length > 0) {
      return Buffer.from(str, 'base64');
    }
    return data;
  }
  const str = String(data).trim().replace(/\s/g, '');
  return Buffer.from(str, 'base64');
}

function loadEncryptedEnv(envPath) {
  const filePath = envPath || path.join(process.cwd(), '.env');
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) return reject(new Error(`无法读取 .env: ${err.message}`));

      promptPassword()
        .then((password) => {
          try {
            const cipherBuffer = toCipherBuffer(data);
            const plainText = decrypt(cipherBuffer, password);
            const parsed = parseEnvText(plainText);
            for (const [k, v] of Object.entries(parsed)) {
              process.env[k] = v;
            }
            resolve();
          } catch (e) {
            reject(new Error('解密失败，请检查密码是否正确'));
          }
        })
        .catch(reject);
    });
  });
}

module.exports = {
  encrypt,
  decrypt,
  parseEnvText,
  loadEncryptedEnv,
  promptPassword,
};
