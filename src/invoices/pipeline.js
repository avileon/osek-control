// נקודת כניסה אחת לכל חשבונית, לא משנה מאיפה הגיעה (Gmail / העלאה / VEX).
import fs from 'node:fs';
import path from 'node:path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { db } from '../db.js';
import { config } from '../config.js';
import { sha256 } from '../lib/crypto.js';
import { classify } from './classify.js';
import { uploadToDrive } from './drive.js';

const FILES_DIR = path.join(path.dirname(config.dbPath), 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

async function extractText(buffer, mime) {
  if (mime === 'application/pdf') {
    try { return (await pdfParse(buffer)).text || ''; } catch { return ''; }
  }
  return ''; // תמונות: אין OCR ב-V1 → נכנס ל"לבדיקה"
}

const monthOf = (isoDate) => isoDate.slice(0, 7);

function safeName(s) {
  return (s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * @param {{buffer:Buffer, filename:string, mime:string, source:string, sourceRef?:string, sender?:string, subject?:string, receivedAt?:string, forceEntity?:string}} input
 * @returns {Promise<{id:number, duplicate?:boolean, entity:string}>}
 */
export async function ingestInvoice(input) {
  const hash = sha256(input.buffer);
  const dup = db.prepare('SELECT id, entity FROM invoices WHERE sha256=?').get(hash);
  if (dup) return { ...dup, duplicate: true };

  const text = await extractText(input.buffer, input.mime);
  const c = classify(text, { osek: config.osek, company: config.company });
  const entity = input.forceEntity || c.entity;
  const receivedAt = input.receivedAt || new Date().toISOString();
  // חודש לפי תאריך המסמך אם הוא סביר (עד 120 יום אחורה), אחרת לפי תאריך הקבלה
  const docOk = c.docDate && Math.abs(new Date(c.docDate) - new Date(receivedAt)) < 120 * 864e5;
  const month = monthOf(docOk ? c.docDate : receivedAt);

  const supplier = safeName(input.sender?.replace(/<.*>/, '').replace(/"/g, '') || 'unknown');
  const ext = path.extname(input.filename) || (input.mime === 'application/pdf' ? '.pdf' : '');
  const driveName = `${docOk ? c.docDate : receivedAt.slice(0, 10)}_${supplier}${c.amount ? `_${c.amount}` : ''}${ext}`;

  const localPath = path.join(FILES_DIR, `${hash.slice(0, 16)}${ext}`);
  fs.writeFileSync(localPath, input.buffer);

  const up = await uploadToDrive({ entity, month, filename: driveName, mime: input.mime, buffer: input.buffer });

  const status = entity === 'osek' ? (config.accountant.requireApproval ? 'pending' : 'approved') : 'stored';
  const info = db.prepare(`INSERT INTO invoices
    (sha256, source, source_ref, filename, mime, sender, subject, received_at, entity, entity_reason, doc_type,
     supplier, doc_number, doc_date, amount, month, drive_file_id, drive_link, status, local_path)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    hash, input.source, input.sourceRef || null, driveName, input.mime, input.sender || null, input.subject || null,
    receivedAt, entity, input.forceEntity ? 'סיווג ידני' : c.reason, c.docType, supplier, c.docNumber,
    docOk ? c.docDate : null, c.amount, month, up.id, up.link, status, localPath);

  return { id: Number(info.lastInsertRowid), entity };
}
