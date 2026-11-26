// שליחה לרו"ח: חשבונית אחת למייל, רק עבור entity=osek ו-status=approved.
import fs from 'node:fs';
import { clients } from '../lib/google.js';
import { config } from '../config.js';
import { db } from '../db.js';

const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;

function buildMime({ to, from, subject, body, filename, mime, data }) {
  const boundary = `osek_${Date.now().toString(36)}`;
  const lines = [
    `From: ${from}`, `To: ${to}`, `Subject: ${enc(subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(body).toString('base64'), '',
    `--${boundary}`, `Content-Type: ${mime}; name="${enc(filename)}"`,
    `Content-Disposition: attachment; filename="${enc(filename)}"`, 'Content-Transfer-Encoding: base64', '',
    data.toString('base64').replace(/.{76}/g, '$&\r\n'), `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function sendInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!inv) throw new Error('לא נמצא');
  if (inv.entity !== 'osek') throw new Error('נשלח רק מסמך של העוסק המורשה');
  if (inv.status !== 'approved') throw new Error(`סטטוס ${inv.status} — נדרש אישור`);

  const { gmail } = clients();
  const subject = `חשבונית - עוסק מורשה ${config.osek.name} ${config.osek.id} - ${inv.supplier || ''} - ${inv.doc_date || inv.month}`;
  const body = [
    `מצורפת חשבונית הוצאה לעוסק מורשה ${config.osek.name}, ע.מ. ${config.osek.id}.`,
    `ספק: ${inv.supplier || '-'}`, `תאריך: ${inv.doc_date || '-'}`, `סכום: ${inv.amount ?? '-'}`, `חודש: ${inv.month}`,
  ].join('\n');
  const raw = buildMime({
    to: config.accountant.email, from: config.gmail.user, subject, body,
    filename: inv.filename, mime: inv.mime, data: fs.readFileSync(inv.local_path),
  });
  try {
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    db.prepare("UPDATE invoices SET status='sent', sent_at=datetime('now'), sent_msg_id=?, error=NULL WHERE id=?").run(res.data.id, id);
  } catch (e) {
    db.prepare('UPDATE invoices SET error=? WHERE id=?').run(String(e.message), id);
    throw e;
  }
}

export function approve(ids) {
  const stmt = db.prepare("UPDATE invoices SET status='approved' WHERE id=? AND entity='osek' AND status='pending'");
  return ids.reduce((n, id) => n + stmt.run(id).changes, 0);
}

export async function sendApproved() {
  const rows = db.prepare("SELECT id FROM invoices WHERE status='approved' AND entity='osek'").all();
  const out = { sent: 0, failed: 0 };
  for (const { id } of rows) {
    try { await sendInvoice(id); out.sent++; } catch { out.failed++; }
  }
  return out;
}
