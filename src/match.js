// התאמת תנועות (בנק/אשראי) לחשבוניות: מה שיצא כסף ואין עליו חשבונית = "חסרה חשבונית".
import { db } from './db.js';

const DAY = 864e5;

export function autoMatch() {
  const txs = db.prepare(`SELECT t.* FROM transactions t
    WHERE t.invoice_id IS NULL AND t.needs_invoice=1 AND t.amount < 0 AND t.scope != 'private'`).all();
  const invs = db.prepare(`SELECT id, amount, COALESCE(doc_date, substr(received_at,1,10)) AS d FROM invoices
    WHERE entity='osek' AND status!='rejected' AND amount IS NOT NULL AND id NOT IN (SELECT invoice_id FROM transactions WHERE invoice_id IS NOT NULL)`).all();
  const link = db.prepare('UPDATE transactions SET invoice_id=? WHERE id=?');
  const used = new Set();
  let matched = 0;
  for (const t of txs) {
    const amt = Math.abs(t.amount);
    const best = invs
      .filter((i) => !used.has(i.id) && Math.abs(i.amount - amt) <= 1 && Math.abs(new Date(i.d) - new Date(t.date)) <= 10 * DAY)
      .sort((a, b) => Math.abs(new Date(a.d) - new Date(t.date)) - Math.abs(new Date(b.d) - new Date(t.date)))[0];
    if (best) { link.run(best.id, t.id); used.add(best.id); matched++; }
  }
  return { matched };
}

export function monthSummary(month) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    month,
    income: one("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM income WHERE month=?", month),
    expensesInvoiced: one("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM invoices WHERE entity='osek' AND status!='rejected' AND month=?", month),
    spend: one(`SELECT COALESCE(SUM(-amount),0) s, COUNT(*) n FROM transactions WHERE amount<0 AND substr(date,1,7)=? AND scope!='private'`, month),
    missing: one(`SELECT COALESCE(SUM(-amount),0) s, COUNT(*) n FROM transactions
                  WHERE amount<0 AND substr(date,1,7)=? AND invoice_id IS NULL AND needs_invoice=1 AND scope!='private'`, month),
    pending: one("SELECT COUNT(*) n FROM invoices WHERE entity='osek' AND status='pending'"),
    review: one("SELECT COUNT(*) n FROM invoices WHERE entity='review' AND status!='rejected'"),
  };
}
