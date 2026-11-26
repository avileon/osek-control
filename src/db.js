import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
// SQLite מובנה ב-Node (22.13+) — בלי קומפילציה, עובד זהה ב-Windows ובשרת
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// עטיפה בסגנון better-sqlite3: db.transaction(fn)() מריץ את fn בתוך טרנזקציה
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY,
  sha256        TEXT UNIQUE NOT NULL,         -- מניעת כפילויות
  source        TEXT NOT NULL,                -- gmail | upload | vex
  source_ref    TEXT,                         -- gmail message id / vex message id
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  sender        TEXT,
  subject       TEXT,
  received_at   TEXT NOT NULL,                -- ISO
  entity        TEXT NOT NULL,                -- osek | company | review
  entity_reason TEXT,
  doc_type      TEXT,                         -- tax_invoice | receipt | tax_invoice_receipt | quote | unknown
  supplier      TEXT,
  doc_number    TEXT,
  doc_date      TEXT,                         -- YYYY-MM-DD אם זוהה
  amount        REAL,                         -- סה"כ כולל מע"מ אם זוהה
  vat           REAL,
  month         TEXT NOT NULL,                -- YYYY-MM (לפי תאריך מסמך, אחרת קבלה)
  drive_file_id TEXT,
  drive_link    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | sent | rejected | stored
  sent_at       TEXT,
  sent_msg_id   TEXT,
  error         TEXT,
  local_path    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status, entity);
CREATE INDEX IF NOT EXISTS idx_inv_month ON invoices(month);

CREATE TABLE IF NOT EXISTS processed_messages (
  source     TEXT NOT NULL,
  ref        TEXT NOT NULL,
  result     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, ref)
);

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY,
  provider    TEXT NOT NULL,                 -- oneZero | max | visaCal
  number      TEXT NOT NULL,                 -- מספר חשבון/4 ספרות אחרונות כפי שהסקרייפר מחזיר
  label       TEXT,
  balance     REAL,
  updated_at  TEXT,
  UNIQUE(provider, number)
);

CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY,
  hash           TEXT UNIQUE NOT NULL,
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  date           TEXT NOT NULL,              -- YYYY-MM-DD
  processed_date TEXT,
  description    TEXT,
  memo           TEXT,
  amount         REAL NOT NULL,              -- שלילי = הוצאה
  orig_amount    REAL,
  orig_currency  TEXT,
  status         TEXT,                       -- completed | pending
  installments   TEXT,
  category       TEXT,
  scope          TEXT NOT NULL DEFAULT 'unknown', -- business | private | unknown
  needs_invoice  INTEGER NOT NULL DEFAULT 1,
  invoice_id     INTEGER REFERENCES invoices(id),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);

CREATE TABLE IF NOT EXISTS income (
  id          INTEGER PRIMARY KEY,
  hash        TEXT UNIQUE NOT NULL,
  source      TEXT NOT NULL DEFAULT 'cardcom',
  doc_type    TEXT,
  doc_number  TEXT,
  doc_date    TEXT NOT NULL,
  customer    TEXT,
  amount      REAL NOT NULL,                 -- כולל מע"מ
  vat         REAL,
  month       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secrets (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,                       -- מוצפן AES-256-GCM
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY,
  job        TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  ok         INTEGER,
  summary    TEXT
);
`);
