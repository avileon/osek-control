import { clients } from '../lib/google.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { ingestInvoice } from './pipeline.js';

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function walkParts(part, out = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push(part);
  for (const p of part.parts || []) walkParts(p, out);
  return out;
}

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || '';

async function ensureLabel() {
  const { gmail } = clients();
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const found = data.labels?.find((l) => l.name === config.gmail.processedLabel);
  if (found) return found.id;
  const res = await gmail.users.labels.create({ userId: 'me', requestBody: { name: config.gmail.processedLabel } });
  return res.data.id;
}

export async function syncGmail() {
  const { gmail } = clients();
  const labelId = await ensureLabel();
  const first = !db.prepare("SELECT 1 FROM processed_messages WHERE source='gmail' LIMIT 1").get();
  const q = `${config.gmail.query} ${first ? `newer_than:${config.gmail.backfillDays}d` : 'newer_than:7d'}`;

  const stats = { messages: 0, osek: 0, company: 0, review: 0, duplicates: 0, skipped: 0 };
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({ userId: 'me', q, pageToken, maxResults: 100 });
    pageToken = data.nextPageToken;
    for (const { id } of data.messages || []) {
      if (db.prepare("SELECT 1 FROM processed_messages WHERE source='gmail' AND ref=?").get(id)) continue;
      const { data: msg } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      stats.messages++;
      const sender = header(msg, 'from');
      // לא לעבד מיילים שאני עצמי שלחתי לרו"ח
      if (sender.includes(config.accountant.email)) { stats.skipped++; continue; }

      const parts = walkParts(msg.payload).filter((p) => ALLOWED.has(p.mimeType) || /\.pdf$/i.test(p.filename));
      const results = [];
      for (const p of parts) {
        // מדלגים על לוגואים/חתימות קטנים
        if (p.mimeType.startsWith('image/') && (p.body.size || 0) < 30_000) continue;
        const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: p.body.attachmentId });
        const r = await ingestInvoice({
          buffer: b64(att.data.data), filename: p.filename, mime: p.mimeType === 'application/octet-stream' ? 'application/pdf' : p.mimeType,
          source: 'gmail', sourceRef: id, sender, subject: header(msg, 'subject'),
          receivedAt: new Date(Number(msg.internalDate)).toISOString(),
        });
        r.duplicate ? stats.duplicates++ : stats[r.entity]++;
        results.push(r);
      }
      db.prepare("INSERT OR IGNORE INTO processed_messages(source, ref, result) VALUES('gmail', ?, ?)").run(id, JSON.stringify(results));
      await gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: [labelId] } });
    }
  } while (pageToken);
  return stats;
}
