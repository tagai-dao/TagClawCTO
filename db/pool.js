var mysql = require("mysql2");

// 不在加载时读 process.env，避免在 loadEncryptedEnv() 之前被 require 时拿到空 env
// 延迟初始化：首次调用 getPool() 时再根据当前 process.env 创建连接池
var writePool = null;

function getPool() {
  if (writePool) return writePool;
  var config = {
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: "utf8mb4",
    timezone: "Z"
  };
  writePool = mysql.createPool(config);
  writePool.on("acquire", function (connection) {});
  writePool.on("connection", function (connection) {});
  writePool.on("enqueue", function () {});
  writePool.on("release", function (connection) {});
  return writePool;
}

function getConnection() {
  return new Promise((resolve, reject) => {
    getPool().getConnection((e, connection) => {
      if (e) {
        logger.error("获取数据库连接失败！", e);
        reject(e);
      } else {
        resolve(connection);
      }
    });
  });
}

// 开始数据库事务
function beginTransaction(connection) {
  return new Promise((resolve, reject) => {
    connection.beginTransaction(err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// 提交数据库操作
function commit(connection) {
  return new Promise((resolve, reject) => {
    connection.commit(e => {
      if (e) {
        reject(e);
      } else {
        resolve();
      }
    });
  });
}

// 回滚数据库操作
function rollback(connection) {
  return new Promise((resolve, reject) => {
    connection.rollback(e => {
      if (e) {
        reject(e);
      } else {
        resolve();
      }
    });
  });
}

/**
 * 执行数据库操作【适用于不需要事务的查询以及单条的增、删、改操作】
 * 示例：
 * let func = async function(conn, projectId, memberId) { ... };
 * await execute( func, projectId, memberId);
 * @param func 具体的数据库操作异步方法（第一个参数必须为数据库连接对象connection）
 * @param params func方法的参数（不包含第一个参数 connection）
 * @returns {Promise.<*>} func方法执行后的返回值
 */
async function execute(sql, params = []) {
  let connection = null;
  try {
    connection = await getConnection();
    let result = await query(connection, sql, params);
    return result;
  } finally {
    connection && connection.release && connection.release();
  }
}

function query(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (e, res) => {
      if (e) {
        logger.error("SQL执行失败：", sql, "\n", params, "\n", e);
        reject(e);
      } else {
        resolve(res);
      }
    });
  });
}

/**
 * 执行数据库事务操作【适用于增、删、改多个操作的执行，如果中间数据操作出现异常则之前的数据库操作全部回滚】
 * 示例：
 * let func = async function(conn) { ... };
 * await executeTransaction(func);
 * @param func 具体的数据库操作异步方法（第一个参数必须为数据库连接对象connection）
 * @returns {Promise.<*>} func方法执行后的返回值
 */
async function executeTransaction(...params) {
  let isRead = false;
  if (params.length > 0 && typeof params[0] === "boolean") {
    isRead = params.shift();
  }
  const connection = await getConnection(isRead);
  await beginTransaction(connection);

  let result = null;
  try {
    result = await query(connection, ...params);
    await commit(connection);
    return result;
  } catch (err) {
    logger.error("Transaction fail, roll back");
    await rollback(connection);
    throw err;
  } finally {
    connection && connection.release && connection.release();
  }
}

function emptyOrRow(rows) {
  if (rows && rows.length > 0) {
    return rows[0];
  } else {
    return {};
  }
}

function emptyOrRows(rows) {
  if (rows && rows.length > 0) {
    return rows;
  } else {
    return [];
  }
}

module.exports = {
  getPool,
  query,
  getConnection,
  execute,
  beginTransaction,
  commit,
  rollback,
  executeTransaction,
  emptyOrRow,
  emptyOrRows,
};
