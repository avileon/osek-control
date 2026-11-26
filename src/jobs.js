import './lib/settings.js';
import cron from 'node-cron';
import { db } from './db.js';
import { config } from './config.js';
import { syncGmail } from './invoices/gmail.js';
import { syncBanks } from './bank/sync.js';
import { autoMatch } from './match.js';

const JOBS = {
  gmail: syncGmail,
  bank: async () => ({ ...(await syncBanks()), match: autoMatch() }),
  match: async () => autoMatch(),
};
const running = new Set();

export async function runJob(name) {
  const fn = JOBS[name];
  if (!fn) throw new Error(`משימה לא מוכרת: ${name}`);
  if (running.has(name)) return { skipped: 'כבר רץ' };
  running.add(name);
  const run = db.prepare("INSERT INTO runs(job, started_at) VALUES(?, datetime('now'))").run(name);
  try {
    const summary = await fn();
    db.prepare("UPDATE runs SET ended_at=datetime('now'), ok=1, summary=? WHERE id=?").run(JSON.stringify(summary), run.lastInsertRowid);
    return summary;
  } catch (e) {
    db.prepare("UPDATE runs SET ended_at=datetime('now'), ok=0, summary=? WHERE id=?").run(String(e.message || e), run.lastInsertRowid);
    throw e;
  } finally {
    running.delete(name);
  }
}

export function startScheduler() {
  const opt = { timezone: config.tz };
  cron.schedule(config.cron.gmail, () => runJob('gmail').catch((e) => console.error('[gmail]', e.message)), opt);
  cron.schedule(config.cron.bank, () => runJob('bank').catch((e) => console.error('[bank]', e.message)), opt);
  console.log(`[cron] gmail="${config.cron.gmail}" bank="${config.cron.bank}" (${config.tz})`);
}
