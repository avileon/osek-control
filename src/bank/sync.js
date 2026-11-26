// משיכת תנועות: בנק ONE (OneZero), מקס, כאל — דרך israeli-bank-scrapers.
import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import { config } from '../config.js';
import { db } from '../db.js';
import { sha256, getSecret } from '../lib/crypto.js';

export const ONEZERO_TOKEN_KEY = 'onezero_long_term_token';

function providers() {
  const { oneZero, max, visaCal } = config.bank;
  const list = [];
  if (oneZero.email && oneZero.password) {
    const token = getSecret(ONEZERO_TOKEN_KEY);
    if (!token) console.warn('[bank] OneZero: אין טוקן — הרץ npm run onezero:login');
    else list.push({ id: 'oneZero', companyId: CompanyTypes.oneZero, credentials: { email: oneZero.email, password: oneZero.password, otpLongTermToken: token } });
  }
  if (max.username) list.push({ id: 'max', companyId: CompanyTypes.max, credentials: max });
  if (visaCal.username) list.push({ id: 'visaCal', companyId: CompanyTypes.visaCal, credentials: visaCal });
  return list;
}

export function scraperOptions(companyId) {
  const startDate = new Date(Date.now() - config.bank.daysBack * 864e5);
  return {
    companyId, startDate, combineInstallments: false, showBrowser: false, timeout: 120_000,
    ...(config.bank.chromiumPath ? { executablePath: config.bank.chromiumPath } : {}),
    ...(config.bank.chromiumPath || process.env.CHROME_NO_SANDBOX === '1' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}),
  };
}

const upsertAccount = db.prepare(`INSERT INTO accounts(provider, number, balance, updated_at) VALUES(?,?,?,datetime('now'))
  ON CONFLICT(provider, number) DO UPDATE SET balance=COALESCE(excluded.balance, accounts.balance), updated_at=excluded.updated_at
  RETURNING id`);

const insertTx = db.prepare(`INSERT INTO transactions
  (hash, account_id, date, processed_date, description, memo, amount, orig_amount, orig_currency, status, installments, category)
  VALUES (@hash,@account_id,@date,@processed_date,@description,@memo,@amount,@orig_amount,@orig_currency,@status,@installments,@category)
  ON CONFLICT(hash) DO UPDATE SET status=excluded.status, processed_date=excluded.processed_date, amount=excluded.amount`);

// pending→completed משנה לעיתים identifier, לכן ה-hash מבוסס על תאריך+סכום מקורי+תיאור (+identifier אם יש)
function txHash(provider, acct, t) {
  return sha256(Buffer.from([provider, acct, t.identifier ?? '', t.date?.slice(0, 10), t.originalAmount, t.description].join('|')));
}

export async function syncBanks() {
  const summary = {};
  for (const p of providers()) {
    try {
      const scraper = createScraper(scraperOptions(p.companyId));
      const res = await scraper.scrape(p.credentials);
      if (!res.success) throw new Error(`${res.errorType}: ${res.errorMessage || ''}`);
      let n = 0;
      db.transaction(() => {
        for (const a of res.accounts || []) {
          const { id: accountId } = upsertAccount.get(p.id, String(a.accountNumber), a.balance ?? null);
          for (const t of a.txns || []) {
            insertTx.run({
              hash: txHash(p.id, a.accountNumber, t), account_id: accountId,
              date: t.date.slice(0, 10), processed_date: t.processedDate?.slice(0, 10) || null,
              description: t.description, memo: t.memo || null, amount: t.chargedAmount,
              orig_amount: t.originalAmount, orig_currency: t.originalCurrency, status: t.status,
              installments: t.installments ? `${t.installments.number}/${t.installments.total}` : null,
              category: t.category || null,
            });
            n++;
          }
        }
      })();
      summary[p.id] = { ok: true, txns: n };
    } catch (e) {
      summary[p.id] = { ok: false, error: String(e.message || e) };
    }
  }
  return summary;
}
