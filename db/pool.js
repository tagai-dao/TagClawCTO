/**
 * DB 工具对象：持久化连接池，需在 loadEncryptedEnv() 完成后调用 createInstance() 再使用。
 * 使用方式：
 *   - 入口在 loadEncryptedEnv().then() 里调用 createInstance()
 *   - 业务代码通过 getInstance() 获取实例，再调用 db.execute() 等
 */
const mysql = require("mysql2");

let instance = null;

class DB {
  constructor() {
    const config = {
      host: process.env.DB_HOST,
      port: 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true,
      charset: "utf8mb4",
      timezone: "Z"
    };
    this.pool = mysql.createPool(config);
    this.pool.on("acquire", function (connection) {});
    this.pool.on("connection", function (connection) {});
    this.pool.on("enqueue", function () {});
    this.pool.on("release", function (connection) {});
  }

  getConnection() {
    return new Promise((resolve, reject) => {
      this.pool.getConnection((e, connection) => {
        if (e) {
          console.error("获取数据库连接失败！", e);
          reject(e);
        } else {
          resolve(connection);
        }
      });
    });
  }

  beginTransaction(connection) {
    return new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  commit(connection) {
    return new Promise((resolve, reject) => {
      connection.commit(e => {
        if (e) reject(e);
        else resolve();
      });
    });
  }

  rollback(connection) {
    return new Promise((resolve, reject) => {
      connection.rollback(e => {
        if (e) reject(e);
        else resolve();
      });
    });
  }

  query(connection, sql, params = []) {
    return new Promise((resolve, reject) => {
      connection.query(sql, params, (e, res) => {
        if (e) {
          console.error("SQL执行失败：", sql, "\n", params, "\n", e);
          reject(e);
        } else {
          resolve(res);
        }
      });
    });
  }

  /**
   * 单条查询/增删改（自动取连、释放）
   */
  async execute(sql, params = []) {
    let connection = null;
    try {
      connection = await this.getConnection();
      return await this.query(connection, sql, params);
    } finally {
      connection && connection.release && connection.release();
    }
  }

  /**
   * 事务：多个操作，失败则回滚
   */
  async executeTransaction(sql, params = []) {
    const connection = await this.getConnection();
    await this.beginTransaction(connection);
    try {
      const result = await this.query(connection, sql, params);
      await this.commit(connection);
      return result;
    } catch (err) {
      console.error("Transaction fail, roll back", err);
      await this.rollback(connection);
      throw err;
    } finally {
      connection && connection.release && connection.release();
    }
  }

  static emptyOrRow(rows) {
    return rows && rows.length > 0 ? rows[0] : {};
  }

  static emptyOrRows(rows) {
    return rows && rows.length > 0 ? rows : [];
  }

  /**
   * 在 loadEncryptedEnv() 完成后调用，根据当前 process.env 创建并持久化唯一实例
   */
  static createInstance() {
    if (instance) return instance;
    instance = new DB();
    return instance;
  }

  /**
   * 获取已创建的 DB 实例，未初始化时抛错
   */
  static getInstance() {
    if (!instance) {
      throw new Error("DB 未初始化，请在 loadEncryptedEnv() 完成后调用 createInstance()");
    }
    return instance;
  }
}

module.exports = {
  DB,
  createInstance: () => DB.createInstance(),
  getInstance: () => DB.getInstance(),
  emptyOrRow: DB.emptyOrRow,
  emptyOrRows: DB.emptyOrRows,
};
