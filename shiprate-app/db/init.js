/**
 * Database initialization — creates tables if they don't exist
 * Using SQLite (better-sqlite3) for simplicity and zero-config hosting
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

try { require('dotenv').config(); } catch (e) {}

const DB_PATH = process.env.DB_PATH || './data/shiprate.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Create tables ───
db.exec(`

  -- Merchants (one per Shopify store)
  CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop TEXT UNIQUE NOT NULL,
    access_token TEXT,
    scope TEXT,
    plan TEXT DEFAULT 'free',
    credits_used INTEGER DEFAULT 0,
    credits_limit INTEGER DEFAULT 500,
    billing_charge_id TEXT,
    billing_status TEXT DEFAULT 'free',
    carrier_service_id TEXT,
    origin_city TEXT DEFAULT '',
    origin_state TEXT DEFAULT '',
    origin_postcode TEXT DEFAULT '',
    origin_country TEXT DEFAULT 'AU',
    installed_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Carrier credentials (one per carrier per merchant)
  CREATE TABLE IF NOT EXISTS carrier_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    carrier TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    extra_config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
    UNIQUE(merchant_id, carrier)
  );

  -- Shipping tiers (multiple per merchant)
  CREATE TABLE IF NOT EXISTS shipping_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    max_carrier_cost REAL NOT NULL,
    customer_price REAL NOT NULL,
    service_name TEXT DEFAULT 'Standard Shipping',
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
  );

  -- Usage log (for credit tracking)
  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    carrier TEXT,
    origin_postcode TEXT,
    dest_postcode TEXT,
    carrier_cost REAL,
    customer_price REAL,
    credits_used INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
  );

`);

console.log('✅ Database initialized at ' + DB_PATH);

module.exports = db;
