const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/customer_management',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

async function initialize() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      approved INTEGER DEFAULT 0,
      "dataEntryAccess" INTEGER DEFAULT 0,
      "excelAccess" INTEGER DEFAULT 0,
      "auditAccess" INTEGER DEFAULT 0,
      "analyticsAccess" INTEGER DEFAULT 0,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pending_signups (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      "newPassword" TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT NOW(),
      status TEXT DEFAULT 'pending'
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS "loginFrom" TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "loginTo" TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS "timezone" TEXT DEFAULT 'UTC';

    CREATE TABLE IF NOT EXISTS customer_records (
      id TEXT PRIMARY KEY,
      "billNo" TEXT NOT NULL,
      "billDate" TEXT,
      "customerName" TEXT NOT NULL,
      "phoneNumber" TEXT,
      address TEXT NOT NULL,
      "itemName" TEXT NOT NULL,
      "itemType" TEXT NOT NULL,
      "itemAmount" REAL NOT NULL,
      interest REAL NOT NULL,
      weight REAL NOT NULL,
      purity TEXT,
      notes TEXT,
      "pendingMoney" REAL DEFAULT 0,
      "extraMoneyCount" INTEGER DEFAULT 0,
      "extraMoney" JSONB DEFAULT '[]'::jsonb,
      "moneyBackCount" INTEGER DEFAULT 0,
      "moneyBack" JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'active',
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW(),
      "soldAt" TIMESTAMP,
      "createdBy" TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMP DEFAULT NOW(),
      "user" TEXT,
      "userRole" TEXT,
      action TEXT,
      "recordId" TEXT,
      "recordData" JSONB DEFAULT '{}'::jsonb,
      details JSONB DEFAULT '{}'::jsonb,
      "billNumber" TEXT,
      "customerName" TEXT
    );

    CREATE TABLE IF NOT EXISTS record_histories (
      id TEXT,
      "recordId" TEXT,
      timestamp TIMESTAMP DEFAULT NOW(),
      "user" TEXT,
      "userRole" TEXT,
      action TEXT,
      "recordData" JSONB DEFAULT '{}'::jsonb,
      details JSONB DEFAULT '{}'::jsonb,
      "billNumber" TEXT,
      "customerName" TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_records_billNo ON customer_records("billNo");
    CREATE INDEX IF NOT EXISTS idx_records_customerName ON customer_records("customerName");
    CREATE INDEX IF NOT EXISTS idx_records_status ON customer_records(status);
    CREATE INDEX IF NOT EXISTS idx_records_itemType ON customer_records("itemType");
    CREATE INDEX IF NOT EXISTS idx_audit_recordId ON audit_logs("recordId");
    CREATE INDEX IF NOT EXISTS idx_history_recordId ON record_histories("recordId");
  `);

  const result = await query('SELECT id FROM users WHERE username = $1', ['gowricharan']);
  if (result.rows.length === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('@8978523646ddD', 10);
    await query(
      `INSERT INTO users (username, password, role, approved, "dataEntryAccess", "excelAccess", "auditAccess", "analyticsAccess")
       VALUES ($1, $2, 'admin', 1, 1, 1, 1, 1)`,
      ['gowricharan', hash]
    );
  }
}

initialize().catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

module.exports = { pool, query, getClient };
