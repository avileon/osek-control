// הכנסות מקארדקום.
// V1: ייבוא CSV של "דוח מסמכים" מממשק קארדקום (העלאה בדשבורד).
// V2: משיכה אוטומטית ב-API ברגע שנאמת את ה-endpoint מול התיעוד/תמיכה של קארדקום (fetchFromApi למטה).
import { db } from '../db.js';
import { sha256 } from '../lib/crypto.js';

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true; // מרכאות פותחות רק בתחילת תא (מע"מ / סה"כ)
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// שמות עמודות אפשריים בדוח (עברית/אנגלית). התאמה גמישה.
const COLS = {
  docNumber: ['מספר מסמך', 'מס מסמך', 'מספר', 'DocumentNumber', 'Number'],
  docType: ['סוג מסמך', 'סוג', 'DocumentType', 'Type'],
  date: ['תאריך', 'תאריך מסמך', 'Date', 'DocumentDate'],
  customer: ['שם לקוח', 'לקוח', 'Customer', 'CustomerName'],
  amount: ['סכום כולל', 'סה"כ', 'סכום', 'Total', 'Amount'],
  vat: ['מע"מ', 'מעמ', 'VAT'],
};

function toIsoDate(s) {
  const m = String(s).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[^\d.-]/g, '')); return isNaN(n) ? null : n; };

export function importCardcomCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('קובץ ריק');
  const head = rows[0].map((h) => h.trim().replace(/[״]/g, '"'));
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (idx.date < 0 || idx.amount < 0) throw new Error(`לא זוהו עמודות תאריך/סכום. כותרות: ${head.join(' | ')}`);

  const ins = db.prepare(`INSERT OR IGNORE INTO income(hash, source, doc_type, doc_number, doc_date, customer, amount, vat, month)
    VALUES(?, 'cardcom', ?, ?, ?, ?, ?, ?, ?)`);
  let added = 0, skipped = 0;
  db.transaction(() => {
    for (const r of rows.slice(1)) {
      const date = toIsoDate(r[idx.date]); const amount = num(r[idx.amount]);
      if (!date || amount == null) { skipped++; continue; }
      const docNumber = idx.docNumber >= 0 ? r[idx.docNumber] : null;
      const hash = sha256(Buffer.from(['cardcom', docNumber, date, amount].join('|')));
      const res = ins.run(hash, idx.docType >= 0 ? r[idx.docType] : null, docNumber, date,
        idx.customer >= 0 ? r[idx.customer] : null, amount, idx.vat >= 0 ? num(r[idx.vat]) : null, date.slice(0, 7));
      res.changes ? added++ : skipped++;
    }
  })();
  return { added, skipped };
}

// eslint-disable-next-line no-unused-vars
export async function fetchFromApi(_from, _to) {
  throw new Error('Cardcom API עדיין לא מחובר — דרוש terminal number + API name/password ואימות ה-endpoint למסמכים');
}
