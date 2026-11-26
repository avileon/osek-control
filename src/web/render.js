export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ils = (n) => (n == null ? '—' : `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

const ENTITY = { osek: 'עוסק', company: 'ויביט בע״מ', review: 'לבדיקה' };
const STATUS = { pending: 'ממתין לאישור', approved: 'אושר', sent: 'נשלח לרו״ח', stored: 'נשמר', rejected: 'נדחה' };
export const entityLabel = (e) => ENTITY[e] || e;
export const statusLabel = (s) => STATUS[s] || s;

export function layout(title, body, active = '') {
  const nav = [['/', 'סקירה'], ['/invoices?tab=pending', 'חשבוניות'], ['/transactions', 'בנק ואשראי'], ['/income', 'הכנסות'], ['/upload', 'העלאה'], ['/settings', 'הגדרות'], ['/runs', 'לוג']]
    .map(([h, t]) => `<a href="${h}" class="${active === t ? 'on' : ''}">${t}</a>`).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · עוסק</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2330;--mute:#6b7280;--line:#e5e7eb;--acc:#0f766e;--warn:#b45309;--bad:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,"Segoe UI",Arial,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--ink);color:#fff;padding:10px 18px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header b{font-size:16px}header a{color:#cbd5e1;text-decoration:none}header a.on,header a:hover{color:#fff}
main{max-width:1200px;margin:0 auto;padding:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.k{color:var(--mute);font-size:13px}.v{font-size:24px;font-weight:600}.warn .v{color:var(--warn)}.bad .v{color:var(--bad)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}th{background:#f1f5f9;font-weight:600;font-size:13px}
.tabs a{display:inline-block;padding:6px 12px;margin-left:6px;border-radius:8px;background:#e2e8f0;color:var(--ink);text-decoration:none}.tabs a.on{background:var(--acc);color:#fff}
button,.btn{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;text-decoration:none}
button.sec{background:#e2e8f0;color:var(--ink)}button.bad{background:var(--bad)}
.pill{font-size:12px;padding:2px 8px;border-radius:99px;background:#e2e8f0}.pill.osek{background:#ccfbf1}.pill.company{background:#e0e7ff}.pill.review{background:#fef3c7}
.mute{color:var(--mute);font-size:13px}form.inline{display:inline}select,input{font:inherit;padding:4px 6px}
.num{direction:ltr;text-align:left;white-space:nowrap}.neg{color:var(--bad)}.pos{color:var(--acc)}
</style></head><body><header><b>עוסק מורשה</b>${nav}</header><main>${body}</main></body></html>`;
}
