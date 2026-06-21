const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      approved INTEGER DEFAULT 0,
      dataEntryAccess INTEGER DEFAULT 0,
      excelAccess INTEGER DEFAULT 0,
      auditAccess INTEGER DEFAULT 0,
      analyticsAccess INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      newPassword TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS customer_records (
      id TEXT PRIMARY KEY,
      billNo TEXT NOT NULL,
      billDate TEXT,
      customerName TEXT NOT NULL,
      phoneNumber TEXT,
      address TEXT NOT NULL,
      itemName TEXT NOT NULL,
      itemType TEXT NOT NULL,
      itemAmount REAL NOT NULL,
      interest REAL NOT NULL,
      weight REAL NOT NULL,
      purity TEXT,
      notes TEXT,
      pendingMoney REAL DEFAULT 0,
      extraMoneyCount INTEGER DEFAULT 0,
      extraMoney TEXT DEFAULT '[]',
      moneyBackCount INTEGER DEFAULT 0,
      moneyBack TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      soldAt TEXT,
      createdBy TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT DEFAULT (datetime('now')),
      user TEXT,
      userRole TEXT,
      action TEXT,
      recordId TEXT,
      recordData TEXT,
      details TEXT,
      billNumber TEXT,
      customerName TEXT
    );

    CREATE TABLE IF NOT EXISTS record_histories (
      id TEXT,
      recordId TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      user TEXT,
      userRole TEXT,
      action TEXT,
      recordData TEXT,
      details TEXT,
      billNumber TEXT,
      customerName TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_records_billNo ON customer_records(billNo);
    CREATE INDEX IF NOT EXISTS idx_records_customerName ON customer_records(customerName);
    CREATE INDEX IF NOT EXISTS idx_records_status ON customer_records(status);
    CREATE INDEX IF NOT EXISTS idx_records_itemType ON customer_records(itemType);
    CREATE INDEX IF NOT EXISTS idx_audit_recordId ON audit_logs(recordId);
    CREATE INDEX IF NOT EXISTS idx_history_recordId ON record_histories(recordId);
  `);

  const masterExists = db.prepare('SELECT id FROM users WHERE username = ?').get('gowricharan');
  if (!masterExists) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('@8978523646ddD', 10);
    db.prepare(`INSERT INTO users (username, password, role, approved, dataEntryAccess, excelAccess, auditAccess, analyticsAccess)
      VALUES (?, ?, 'admin', 1, 1, 1, 1, 1)`).run('gowricharan', hash);
  }
}

initialize();

module.exports = db;
