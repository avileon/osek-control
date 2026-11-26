import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

function key() {
  if (!/^[0-9a-f]{64}$/i.test(config.appSecret)) throw new Error('APP_SECRET חייב להיות 64 תווי hex (openssl rand -hex 32)');
  return Buffer.from(config.appSecret, 'hex');
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export function setSecret(k, v) {
  db.prepare(`INSERT INTO secrets(key,value,updated_at) VALUES(?,?,datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(k, encrypt(v));
}

export function getSecret(k) {
  const row = db.prepare('SELECT value FROM secrets WHERE key=?').get(k);
  return row ? decrypt(row.value) : null;
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
