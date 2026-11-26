import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { config } from './config.js';
import { FIELDS, getSetting, hasSetting, saveSetting } from './lib/settings.js';
import { oauthClient, resetClients, SCOPES } from './lib/google.js';
import { setSecret } from './lib/crypto.js';
import { db } from './db.js';
import { layout, esc, ils, entityLabel, statusLabel } from './web/render.js';
import { ingestInvoice } from './invoices/pipeline.js';
import { approve, sendInvoice } from './invoices/send.js';
import { moveInDrive } from './invoices/drive.js';
import { importCardcomCsv } from './income/cardcom.js';
import { monthSummary, autoMatch } from './match.js';
import { runJob, startScheduler } from './jobs.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: config.tz }).slice(0, 7);
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- webhook מ-VEX (וואטסאפ 0542144442) — לפני basic auth ----------
// POST /webhooks/vex  header: x-osek-secret
// body JSON: { messageId, from, filename, mime, data(base64), caption? }
app.post('/webhooks/vex', express.json({ limit: '25mb' }), async (req, res) => {
  const secret = req.get('x-osek-secret') || '';
  const expected = config.vex.webhookSecret;
  if (!expected || !safeEq(secret, expected)) return res.status(401).end();
  const { messageId, from, filename, mime, data, caption } = req.body || {};
  if (!data || !mime) return res.status(400).json({ error: 'data+mime נדרשים' });
  if (!/^(application\/pdf|image\/(jpeg|png))$/.test(mime)) return res.status(415).json({ error: 'רק PDF/JPG/PNG' });
  if (messageId && db.prepare("SELECT 1 FROM processed_messages WHERE source='vex' AND ref=?").get(messageId)) return res.json({ duplicate: true });
  try {
    const r = await ingestInvoice({
      buffer: Buffer.from(data, 'base64'), filename: filename || `whatsapp.${mime.split('/')[1]}`, mime,
      source: 'vex', sourceRef: messageId, sender: `WhatsApp ${from || ''}`, subject: caption || null,
    });
    if (messageId) db.prepare("INSERT OR IGNORE INTO processed_messages(source, ref, result) VALUES('vex', ?, ?)").run(messageId, JSON.stringify(r));
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/healthz', (req, res) => res.send('ok'));

// ---------- basic auth לכל השאר ----------
app.use((req, res, next) => {
  if (!config.dash.pass) return res.status(500).send('DASH_PASS לא מוגדר');
  const [, b64 = ''] = (req.get('authorization') || '').split(' ');
  const [u = '', p = ''] = Buffer.from(b64, 'base64').toString().split(':');
  if (safeEq(u, config.dash.user) && safeEq(p, config.dash.pass)) return next();
  res.set('WWW-Authenticate', 'Basic realm="osek"').status(401).send('auth');
});
app.use(express.urlencoded({ extended: true }));

// חזרה לאותו מסך: כל טופס POST מקבל שדה back (ראה layout). Caddy שולח Referrer-Policy: no-referrer, אז referer לא אמין.
const safeBack = (u) => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') ? u : null);
const back = (req, res) => res.redirect(safeBack(req.body?.back) || safeBack(req.query?.back) || req.get('referer') || '/');
const ids = (v) => [].concat(v || []).map(Number).filter(Boolean);

// ---------- סקירה ----------
app.get('/', (req, res) => {
  const month = req.query.month || thisMonth();
  const s = monthSummary(month);
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY provider').all();
  const last = db.prepare('SELECT job, MAX(started_at) at, ok FROM runs GROUP BY job').all();
  const card = (k, v, sub = '', cls = '') => `<div class="card ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="mute">${sub}</div></div>`;
  const profit = s.income.s - s.expensesInvoiced.s;
  const missing = [
    !hasSetting('OSEK_ID') && 'מספר עוסק', !hasSetting('ACCOUNTANT_EMAIL') && 'מייל רו״ח', !hasSetting('DRIVE_OSEK_FOLDER_ID') && 'תיקיית Drive',
    !hasSetting('GOOGLE_REFRESH_TOKEN') && 'חיבור Google',
  ].filter(Boolean);
  res.send(layout('סקירה', `
    ${missing.length ? `<div class="card warn" style="margin-bottom:12px">⚠ חסר להשלמת ההקמה: ${missing.join(' · ')} — <a href="/settings">להגדרות</a></div>` : ''}
    <form method="get" style="margin-bottom:12px">חודש: <input type="month" name="month" value="${esc(month)}" onchange="this.form.requestSubmit()"></form>
    <div class="grid">
      ${card('הכנסות (קארדקום)', ils(s.income.s), `${s.income.n} מסמכים`)}
      ${card('הוצאות עם חשבונית', ils(s.expensesInvoiced.s), `${s.expensesInvoiced.n} חשבוניות`)}
      ${card('רווח לפני מס (גס)', ils(profit), 'הכנסות − הוצאות מתועדות')}
      ${card('יצא מהבנק/אשראי', ils(s.spend.s), `${s.spend.n} תנועות (ללא פרטי)`)}
      ${card('חסרה חשבונית', ils(s.missing.s), `<a href="/transactions?month=${month}&missing=1">${s.missing.n} תנועות</a>`, s.missing.n ? 'bad' : '')}
      ${card('ממתין לאישור לרו״ח', s.pending.n, '<a href="/invoices?tab=pending">לתור</a>', s.pending.n ? 'warn' : '')}
      ${card('לבדיקה ידנית', s.review.n, '<a href="/invoices?tab=review">לבדיקה</a>', s.review.n ? 'warn' : '')}
    </div>
    <h3>חשבונות</h3>
    <table><tr><th>ספק</th><th>חשבון</th><th>יתרה</th><th>עודכן</th></tr>
      ${accounts.map((a) => `<tr><td>${esc(a.provider)}</td><td>${esc(a.number)}</td><td class="num">${ils(a.balance)}</td><td class="mute">${esc(a.updated_at)}</td></tr>`).join('') || '<tr><td colspan=4 class="mute">עוד לא סונכרן</td></tr>'}
    </table>
    <h3>הרצות</h3>
    <p>${last.map((r) => `${esc(r.job)}: ${r.ok ? '✓' : '✗'} <span class="mute">${esc(r.at)}</span>`).join(' · ') || '<span class="mute">אין</span>'}</p>
    <form class="inline" method="post" action="/jobs/gmail"><button class="sec">סרוק מייל עכשיו</button></form>
    <form class="inline" method="post" action="/jobs/bank"><button class="sec">סנכרן בנק+אשראי עכשיו</button></form>
  `, 'סקירה'));
});

// ---------- חשבוניות ----------
const TABS = { pending: ['ממתין לאישור', "entity='osek' AND status IN ('pending','approved')"], sent: ['נשלח', "status='sent'"],
  review: ['לבדיקה', "entity='review' AND status!='rejected'"], company: ['ויביט בע״מ', "entity='company' AND status!='rejected'"],
  all: ['הכל', "status!='rejected'"], rejected: ['נדחה', "status='rejected'"] }; // נדחות מופיעות רק בלשונית "נדחה" 

app.get('/invoices', (req, res) => {
  const tab = TABS[req.query.tab] ? req.query.tab : 'pending';
  const rows = db.prepare(`SELECT * FROM invoices WHERE ${TABS[tab][1]} ORDER BY received_at DESC LIMIT 500`).all();
  const tabs = Object.entries(TABS).map(([k, [t, w]]) => {
    const n = db.prepare(`SELECT COUNT(*) n FROM invoices WHERE ${w}`).get().n;
    return `<a href="?tab=${k}" class="${k === tab ? 'on' : ''}">${t} (${n})</a>`;
  }).join('');
  const reclass = (r) => `<form class="inline" method="post" action="/invoices/${r.id}/reclassify"><select name="entity" onchange="this.form.requestSubmit()">
      ${['osek', 'company', 'review'].map((e) => `<option value="${e}" ${e === r.entity ? 'selected' : ''}>${entityLabel(e)}</option>`).join('')}</select></form>`;
  const body = rows.map((r) => `<tr>
      <td>${r.status !== 'sent' ? `<input type="checkbox" class="sel" name="ids" value="${r.id}" form="bulk">` : ''}</td>
      <td>${esc(r.doc_date || r.received_at.slice(0, 10))}<div class="mute">${esc(r.month)}</div></td>
      <td>${esc(r.supplier)}<div class="mute">${esc(r.subject || '')}</div></td>
      <td class="num">${ils(r.amount)}</td>
      <td><span class="pill ${r.entity}">${entityLabel(r.entity)}</span><div class="mute">${esc(r.entity_reason)}</div></td>
      <td>${statusLabel(r.status)}${r.error ? `<div class="mute" style="color:var(--bad)">${esc(r.error)}</div>` : ''}</td>
      <td><a href="/invoices/${r.id}/file" target="_blank">קובץ</a> · <a href="${esc(r.drive_link)}" target="_blank">Drive</a></td>
      <td>${reclass(r)}
        ${r.entity === 'osek' && ['pending', 'approved'].includes(r.status) ? `<form class="inline" method="post" action="/invoices/approve"><input type="hidden" name="ids" value="${r.id}"><button>אשר ושלח</button></form>` : ''}
        ${r.status !== 'sent' && r.status !== 'rejected' ? `<form class="inline" method="post" action="/invoices/${r.id}/reject"><button class="sec">דחה</button></form>` : ''}
      </td></tr>`).join('');
  res.send(layout('חשבוניות', `<div class="tabs">${tabs}</div><br>
    <form id="bulk" method="post" action="/invoices/bulk" class="card" style="position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <b id="selcount">0 מסומנות</b>
      <button name="action" value="approve" onclick="return confirm('לשלוח את המסומנות (רק של העוסק) ל-${esc(config.accountant.email)}?')">אשר ושלח לרו״ח</button>
      <button name="action" value="reject" class="sec">דחה</button>
      ${tab === 'rejected' ? '<button name="action" value="restore" class="sec">בטל דחייה</button>' : ''}
      <span class="mute">העבר ל:</span>
      <button name="action" value="osek" class="sec">עוסק</button>
      <button name="action" value="company" class="sec">ויביט בע״מ</button>
      <button name="action" value="review" class="sec">לבדיקה</button>
    </form><br>
    <table><tr><th><input type="checkbox" id="selall" title="סמן הכל"></th><th>תאריך</th><th>ספק</th><th>סכום</th><th>שיוך</th><th>סטטוס</th><th>קבצים</th><th>פעולות</th></tr>
    ${body || '<tr><td colspan=8 class="mute">ריק</td></tr>'}</table>
    <script>
      const boxes = () => [...document.querySelectorAll('input.sel')];
      const upd = () => { document.getElementById('selcount').textContent = boxes().filter(b => b.checked).length + ' מסומנות'; };
      document.getElementById('selall').addEventListener('change', (e) => { boxes().forEach(b => b.checked = e.target.checked); upd(); });
      document.addEventListener('change', (e) => { if (e.target.classList?.contains('sel')) upd(); });
      document.getElementById('bulk').addEventListener('submit', (e) => { if (!boxes().some(b => b.checked)) { e.preventDefault(); alert('לא סומנו חשבוניות'); } });
    </script>`, 'חשבוניות'));
});

app.get('/invoices/:id/file', (req, res) => {
  const r = db.prepare('SELECT local_path, mime, filename FROM invoices WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).end();
  res.type(r.mime).sendFile(r.local_path, { root: '/' });
});

app.post('/invoices/approve', async (req, res) => {
  const list = ids(req.body.ids);
  approve(list);
  const errors = [];
  for (const id of list) { try { await sendInvoice(id); } catch (e) { errors.push(`#${id}: ${e.message}`); } }
  if (errors.length) return res.status(500).send(layout('שגיאה', `<p>${errors.map(esc).join('<br>')}</p><a href="/invoices">חזרה</a>`));
  back(req, res);
});

app.post('/invoices/:id/reject', (req, res) => {
  db.prepare("UPDATE invoices SET status='rejected' WHERE id=? AND status!='sent'").run(req.params.id);
  back(req, res);
});

async function reclassify(id, entity) {
  const r = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!r || !['osek', 'company', 'review'].includes(entity) || r.status === 'sent' || r.entity === entity) return false;
  if (r.drive_file_id) await moveInDrive(r.drive_file_id, entity, r.month);
  const status = entity === 'osek' ? 'pending' : 'stored';
  db.prepare("UPDATE invoices SET entity=?, status=?, entity_reason='סיווג ידני' WHERE id=?").run(entity, status, r.id);
  return true;
}

app.post('/invoices/:id/reclassify', async (req, res) => {
  await reclassify(Number(req.params.id), req.body.entity);
  back(req, res);
});

app.post('/invoices/bulk', async (req, res) => {
  const list = ids(req.body.ids);
  const action = req.body.action;
  const errors = [];
  if (action === 'approve') {
    const osekIds = list.filter((id) => db.prepare("SELECT 1 FROM invoices WHERE id=? AND entity='osek' AND status IN ('pending','approved')").get(id));
    approve(osekIds);
    for (const id of osekIds) { try { await sendInvoice(id); } catch (e) { errors.push(`#${id}: ${e.message}`); } }
    if (osekIds.length < list.length) errors.push(`${list.length - osekIds.length} לא נשלחו כי אינן של העוסק או כבר טופלו`);
  } else if (action === 'reject') {
    const st = db.prepare("UPDATE invoices SET status='rejected' WHERE id=? AND status!='sent'");
    list.forEach((id) => st.run(id));
  } else if (action === 'restore') {
    const st = db.prepare("UPDATE invoices SET status=CASE WHEN entity='osek' THEN 'pending' ELSE 'stored' END WHERE id=? AND status='rejected'");
    list.forEach((id) => st.run(id));
  } else if (['osek', 'company', 'review'].includes(action)) {
    for (const id of list) { try { await reclassify(id, action); } catch (e) { errors.push(`#${id}: ${e.message}`); } }
  }
  if (errors.length) {
    const to = safeBack(req.body.back) || '/invoices';
    return res.send(layout('תוצאה', `<div class="card"><p>${errors.map(esc).join('<br>')}</p><a class="btn" href="${esc(to)}">חזרה</a></div>`));
  }
  back(req, res);
});

// ---------- בנק ואשראי ----------
app.get('/transactions', (req, res) => {
  const month = req.query.month || thisMonth();
  const missing = req.query.missing === '1';
  const rows = db.prepare(`SELECT t.*, a.provider, a.number acct, i.supplier inv_supplier, i.drive_link
    FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN invoices i ON i.id=t.invoice_id
    WHERE substr(t.date,1,7)=? ${missing ? "AND t.amount<0 AND t.invoice_id IS NULL AND t.needs_invoice=1 AND t.scope!='private'" : ''}
    ORDER BY t.date DESC`).all(month);
  const scopeSel = (t) => `<select name="scope" onchange="this.form.requestSubmit()">${[['unknown', '?'], ['business', 'עסקי'], ['private', 'פרטי']]
    .map(([v, l]) => `<option value="${v}" ${t.scope === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  res.send(layout('בנק ואשראי', `
    <form method="get">חודש: <input type="month" name="month" value="${esc(month)}"> <label><input type="checkbox" name="missing" value="1" ${missing ? 'checked' : ''}> רק חסרות חשבונית</label> <button class="sec">הצג</button></form><br>
    <form class="inline" method="post" action="/jobs/match"><button class="sec">התאם אוטומטית לחשבוניות</button></form><br><br>
    <table><tr><th>תאריך</th><th>מקור</th><th>תיאור</th><th>סכום</th><th>חשבונית</th><th>סיווג</th></tr>
    ${rows.map((t) => `<tr>
      <td>${esc(t.date)}${t.status === 'pending' ? ' <span class="pill">בהמתנה</span>' : ''}</td>
      <td>${esc(t.provider)}<div class="mute">${esc(t.acct)}</div></td>
      <td>${esc(t.description)}${t.installments ? ` <span class="pill">${esc(t.installments)}</span>` : ''}<div class="mute">${esc(t.memo || '')}${t.orig_currency && t.orig_currency !== 'ILS' ? ` · ${t.orig_amount} ${esc(t.orig_currency)}` : ''}</div></td>
      <td class="num ${t.amount < 0 ? 'neg' : 'pos'}">${ils(t.amount)}</td>
      <td>${t.invoice_id ? `<a href="${esc(t.drive_link)}" target="_blank">✓ ${esc(t.inv_supplier)}</a>` : t.amount < 0 && t.needs_invoice ? '<span style="color:var(--bad)">חסרה</span>' : '—'}</td>
      <td><form class="inline" method="post" action="/transactions/${t.id}">${scopeSel(t)}</form>
          <form class="inline" method="post" action="/transactions/${t.id}"><input type="hidden" name="needs_invoice" value="${t.needs_invoice ? 0 : 1}">
          <button class="sec" title="למשל עמלות בנק, העברות בין חשבונות">${t.needs_invoice ? 'לא צריך חשבונית' : 'צריך חשבונית'}</button></form></td>
    </tr>`).join('') || '<tr><td colspan=6 class="mute">אין תנועות</td></tr>'}</table>`, 'בנק ואשראי'));
});

app.post('/transactions/:id', (req, res) => {
  const { scope, needs_invoice } = req.body;
  if (['unknown', 'business', 'private'].includes(scope)) db.prepare('UPDATE transactions SET scope=? WHERE id=?').run(scope, req.params.id);
  if (needs_invoice === '0' || needs_invoice === '1') db.prepare('UPDATE transactions SET needs_invoice=? WHERE id=?').run(Number(needs_invoice), req.params.id);
  back(req, res);
});

// ---------- הכנסות ----------
app.get('/income', (req, res) => {
  const rows = db.prepare('SELECT month, COUNT(*) n, SUM(amount) s, SUM(vat) v FROM income GROUP BY month ORDER BY month DESC').all();
  res.send(layout('הכנסות', `
    <div class="card"><b>ייבוא דוח מסמכים מקארדקום (CSV)</b>
      <form method="post" action="/income/import" enctype="multipart/form-data"><input type="file" name="file" accept=".csv" required> <button>ייבא</button></form>
      <div class="mute">קארדקום → דוחות → מסמכים → ייצוא לאקסל/CSV. כפילויות מדולגות.</div></div><br>
    <table><tr><th>חודש</th><th>מסמכים</th><th>סה״כ</th><th>מע״מ</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.month)}</td><td>${r.n}</td><td class="num">${ils(r.s)}</td><td class="num">${ils(r.v)}</td></tr>`).join('') || '<tr><td colspan=4 class="mute">אין</td></tr>'}</table>`, 'הכנסות'));
});

app.post('/income/import', upload.single('file'), (req, res) => {
  try {
    const r = importCardcomCsv(req.file.buffer.toString('utf8'));
    res.send(layout('ייבוא', `<p>נוספו ${r.added}, דולגו ${r.skipped}.</p><a href="/income">חזרה</a>`));
  } catch (e) { res.status(400).send(layout('שגיאה', `<p>${esc(e.message)}</p><a href="/income">חזרה</a>`)); }
});

// ---------- העלאה ידנית ----------
app.get('/upload', (req, res) => res.send(layout('העלאה', `
  <div class="card"><form method="post" action="/upload" enctype="multipart/form-data">
    <p><input type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png" required></p>
    <p>שיוך: <select name="entity"><option value="">אוטומטי (לפי ע.מ./ח.פ.)</option><option value="osek">עוסק</option><option value="company">ויביט בע״מ</option><option value="review">לבדיקה</option></select></p>
    <button>העלה</button></form></div>`, 'העלאה')));

app.post('/upload', upload.array('files', 30), async (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    try {
      const r = await ingestInvoice({ buffer: f.buffer, filename: f.originalname, mime: f.mimetype, source: 'upload', sender: 'העלאה ידנית', forceEntity: req.body.entity || undefined });
      out.push(`${esc(f.originalname)} → ${r.duplicate ? 'כפול' : entityLabel(r.entity)}`);
    } catch (e) { out.push(`${esc(f.originalname)} → שגיאה: ${esc(e.message)}`); }
  }
  res.send(layout('העלאה', `<p>${out.join('<br>')}</p><a href="/invoices?tab=all">לחשבוניות</a>`, 'העלאה'));
});


// ---------- הגדרות ----------
app.get('/settings', (req, res) => {
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const field = (f) => {
    const v = getSetting(f.key);
    return `<p><label>${esc(f.label)}<br>${f.secret
      ? `<input type="password" name="${f.key}" placeholder="${v ? '•••••• (שמור — השאר ריק כדי לא לשנות)' : ''}" autocomplete="new-password" style="width:100%">`
      : `<input name="${f.key}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" style="width:100%">`}</label></p>`;
  };
  const g = { client: hasSetting('GOOGLE_CLIENT_ID') && hasSetting('GOOGLE_CLIENT_SECRET'), token: hasSetting('GOOGLE_REFRESH_TOKEN') };
  res.send(layout('הגדרות', `
    <div class="grid">
    <div class="card"><b>Google (${esc(config.gmail.user)})</b>
      <p>1. קובץ OAuth client (JSON): ${g.client ? '✓ הוגדר' : '✗ חסר'}</p>
      <form method="post" action="/settings/google-client" enctype="multipart/form-data"><input type="file" name="file" accept=".json" required> <button class="sec">העלה</button></form>
      <p>2. חיבור החשבון: ${g.token ? '✓ מחובר' : '✗ לא מחובר'}</p>
      ${g.client ? `<a class="btn" href="/settings/google/connect">${g.token ? 'חבר מחדש' : 'חבר את Google'}</a>` : ''}
      <p class="mute">Redirect URI שצריך להיות מוגדר ב-Google Cloud: <code>${esc(config.google.redirectUri)}</code></p>
    </div></div><br>
    <form method="post" action="/settings">
      <div class="grid">${groups.map((gr) => `<div class="card"><b>${esc(gr)}</b>${FIELDS.filter((f) => f.group === gr).map(field).join('')}</div>`).join('')}</div>
      <br><button>שמור</button> <span class="mute">שדות סיסמה ריקים לא משנים את הערך השמור. הכל נשמר מוצפן.</span>
    </form>`, 'הגדרות'));
});

app.post('/settings', (req, res) => {
  for (const f of FIELDS) {
    if (!(f.key in req.body)) continue;
    if (f.secret && req.body[f.key] === '') continue;
    saveSetting(f.key, req.body[f.key]);
  }
  res.redirect('/settings');
});

app.post('/settings/google-client', upload.single('file'), (req, res) => {
  try {
    const j = JSON.parse(req.file.buffer.toString('utf8'));
    const c = j.web || j.installed;
    if (!c?.client_id || !c?.client_secret) throw new Error('הקובץ לא נראה כמו OAuth client של Google');
    saveSetting('GOOGLE_CLIENT_ID', c.client_id);
    saveSetting('GOOGLE_CLIENT_SECRET', c.client_secret);
    resetClients();
    res.redirect('/settings');
  } catch (e) { res.status(400).send(layout('שגיאה', `<p>${esc(e.message)}</p><a href="/settings">חזרה</a>`)); }
});

app.get('/settings/google/connect', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  setSecret('oauth_state', state);
  const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, login_hint: config.gmail.user, state });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { getSecret } = await import('./lib/crypto.js');
    if (!req.query.state || req.query.state !== getSecret('oauth_state')) throw new Error('state לא תואם — נסה שוב');
    const { tokens } = await oauthClient().getToken(String(req.query.code));
    if (!tokens.refresh_token) throw new Error('Google לא החזיר refresh token — נסה "חבר מחדש"');
    saveSetting('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
    resetClients();
    res.redirect('/settings');
  } catch (e) { res.status(400).send(layout('שגיאה', `<p>${esc(e.message)}</p><a href="/settings">חזרה</a>`)); }
});

// ---------- משימות ולוג ----------
app.post('/jobs/:name', async (req, res) => {
  try { await runJob(req.params.name); back(req, res); } catch (e) { res.status(500).send(layout('שגיאה', `<p>${esc(e.message)}</p><a href="/">חזרה</a>`)); }
});

app.get('/runs', (req, res) => {
  const rows = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 100').all();
  res.send(layout('לוג', `<table><tr><th>משימה</th><th>התחלה</th><th>סיום</th><th>תוצאה</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.job)}</td><td>${esc(r.started_at)}</td><td>${esc(r.ended_at)}</td><td>${r.ok ? '✓' : '✗'} <span class="mute">${esc(r.summary)}</span></td></tr>`).join('')}</table>`, 'לוג'));
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, config.host, () => console.log(`[osek] http://${config.host}:${config.port}`));
  if (process.env.DISABLE_CRON !== '1') startScheduler();
}
export { app, autoMatch };
