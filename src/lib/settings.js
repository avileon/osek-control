// הגדרות שנערכות מהדשבורד: נשמרות מוצפנות (AES-256-GCM) בטבלת secrets עם קידומת cfg:
// סדר עדיפות: DB → משתני סביבה → ברירת מחדל.
import { setResolver } from '../config.js';
import { db } from '../db.js';
import { getSecret, setSecret } from './crypto.js';

export const FIELDS = [
  { group: 'זהות', key: 'OSEK_ID', label: 'מספר עוסק מורשה' },
  { group: 'זהות', key: 'OSEK_NAME', label: 'שם העוסק (כפי שמופיע בחשבוניות)' },
  { group: 'זהות', key: 'COMPANY_ID', label: 'ח.פ. החברה (להפרדה)' },
  { group: 'זהות', key: 'COMPANY_NAME', label: 'שם החברה' },
  { group: 'רו״ח ו-Drive', key: 'ACCOUNTANT_EMAIL', label: 'מייל רואה חשבון' },
  { group: 'רו״ח ו-Drive', key: 'DRIVE_OSEK_FOLDER_ID', label: 'מזהה תיקיית העוסק ב-Drive (או קישור)' },
  { group: 'רו״ח ו-Drive', key: 'GMAIL_USER', label: 'תיבת המייל', placeholder: 'avi@vibit.co.il' },
  { group: 'כרטיסי אשראי', key: 'MAX_USERNAME', label: 'מקס - שם משתמש' },
  { group: 'כרטיסי אשראי', key: 'MAX_PASSWORD', label: 'מקס - סיסמה', secret: true },
  { group: 'כרטיסי אשראי', key: 'VISACAL_USERNAME', label: 'כאל - שם משתמש' },
  { group: 'כרטיסי אשראי', key: 'VISACAL_PASSWORD', label: 'כאל - סיסמה', secret: true },
  { group: 'וואטסאפ (VEX)', key: 'VEX_WEBHOOK_SECRET', label: 'סוד webhook', secret: true },
];

const cache = new Map();
function readDb(k) {
  if (!cache.has(k)) {
    try { cache.set(k, getSecret(`cfg:${k}`)); } catch { cache.set(k, null); }
  }
  return cache.get(k);
}

setResolver((k, d = '') => readDb(k) || (process.env[k] ?? '').trim() || d);

export function getSetting(k) { return readDb(k) || (process.env[k] ?? '').trim(); }
export function hasSetting(k) { return Boolean(getSetting(k)); }

export function saveSetting(k, v) {
  let val = String(v ?? '').trim();
  if (k === 'DRIVE_OSEK_FOLDER_ID') val = val.replace(/^.*\/folders\//, '').replace(/[?#].*$/, '');
  if (val === '') db.prepare('DELETE FROM secrets WHERE key=?').run(`cfg:${k}`);
  else setSecret(`cfg:${k}`, val);
  cache.delete(k);
}
