// סיווג חשבונית לפי הטקסט שלה: עוסק מורשה / חברה / לבדיקה.
// טקסט עברי מ-PDF יוצא לעיתים הפוך (סדר ויזואלי), לכן בודקים גם מחרוזות הפוכות.

const rev = (s) => [...s].reverse().join('');
const digitsOnly = (s) => s.replace(/\D/g, '');

function normalize(text) {
  return (text || '')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '') // סימני כיווניות
    .replace(/[״"]/g, '"')
    .replace(/[׳']/g, "'")
    .replace(/\s+/g, ' ');
}

// מספר מזהה יכול להופיע כ-012345678 / 12345678 / 01-234567-8 / 012 345 678
function hasId(text, id) {
  const compact = digitsOnly(id);
  const noLead = compact.replace(/^0+/, '');
  const re = new RegExp(`(?<!\\d)0*${noLead.split('').join('[\\s\\-.]?')}(?!\\d)`);
  return re.test(text) || re.test(rev(text));
}

function hasName(text, name) {
  if (!name) return false;
  const n = name.replace(/\s+/g, ' ').trim();
  return text.includes(n) || text.includes(rev(n));
}

// סוג מסמך. הצעת מחיר / הזמנה / דרישת תשלום אינם מסמכים חשבונאיים.
export function detectDocType(text) {
  const t = normalize(text);
  const has = (w) => t.includes(w) || t.includes(rev(w));
  if (has('חשבונית מס קבלה') || has('חשבונית מס/קבלה') || has('חשבונית מס / קבלה')) return 'tax_invoice_receipt';
  if (has('חשבונית מס') || /tax invoice/i.test(t)) return 'tax_invoice';
  if (has('קבלה') || /\breceipt\b/i.test(t)) return 'receipt';
  if (has('חשבונית') || /\binvoice\b/i.test(t)) return 'tax_invoice';
  if (has('הצעת מחיר') || has('דרישת תשלום') || has('חשבון עסקה') || /\bquote\b|proforma/i.test(t)) return 'quote';
  return 'unknown';
}

// סכום כולל: מחפשים מספר שמופיע אחרי "סה"כ לתשלום"/"total". לוקחים את הגבוה מבין המועמדים.
export function detectAmount(text) {
  const t = normalize(text);
  const num = '(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})|\\d+(?:\\.\\d{1,2}))';
  const labels = ['סה"כ לתשלום', 'סה"כ כולל מע"מ', 'סך הכל לתשלום', 'לתשלום', 'סה"כ', 'total due', 'amount due', 'grand total', 'total'];
  const candidates = [];
  for (const label of labels) {
    for (const l of [label, rev(label)]) {
      const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const re of [new RegExp(`${esc}[^\\d]{0,25}${num}`, 'gi'), new RegExp(`${num}[^\\d]{0,25}${esc}`, 'gi')]) {
        for (const m of t.matchAll(re)) candidates.push(parseFloat(m[1].replace(/,/g, '')));
      }
    }
    if (candidates.length) break; // התווית החזקה ביותר שנמצאה מנצחת
  }
  const valid = candidates.filter((n) => n > 0 && n < 10_000_000);
  return valid.length ? Math.max(...valid) : null;
}

export function detectDate(text) {
  const t = normalize(text);
  const m = t.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](20\d{2}|\d{2})(?!\d)/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  const dd = Number(d), mm = Number(mo);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function detectDocNumber(text) {
  const t = normalize(text);
  const m = t.match(/(?:מס(?:פר)?'?\s*(?:חשבונית|מסמך|קבלה)|invoice\s*(?:no|#|number))[^\d]{0,10}(\d{3,12})/i);
  return m ? m[1] : null;
}

/**
 * @returns {{entity:'osek'|'company'|'review', reason:string, docType:string, amount:number|null, docDate:string|null, docNumber:string|null}}
 */
export function classify(rawText, { osek, company }) {
  const text = normalize(rawText);
  const docType = detectDocType(text);
  const base = { docType, amount: detectAmount(text), docDate: detectDate(text), docNumber: detectDocNumber(text) };

  if (!osek.id) return { ...base, entity: 'review', reason: 'מספר עוסק לא הוגדר בהגדרות' };
  if (text.replace(/\s/g, '').length < 30) {
    return { ...base, entity: 'review', reason: 'אין טקסט (סריקה/תמונה) — דרוש סיווג ידני' };
  }

  const osekHit = hasId(text, osek.id);
  const companyHit = company.id ? hasId(text, company.id) : false;
  const osekName = hasName(text, osek.name);
  const companyName = Boolean(company.name) && hasName(text, company.name.split(/\s+/)[0]);

  if (osekHit && companyHit) return { ...base, entity: 'review', reason: 'מופיעים גם ע.מ. וגם ח.פ. — בדוק ידנית' };
  if (companyHit) return { ...base, entity: 'company', reason: `ח.פ. ${company.id}` };
  if (osekHit) {
    if (docType === 'quote') return { ...base, entity: 'review', reason: 'על שם העוסק אבל נראה כהצעת מחיר/חשבון עסקה' };
    return { ...base, entity: 'osek', reason: `ע.מ. ${osek.id}` };
  }
  // אין מספר מזהה בכלל
  if (companyName && !osekName) return { ...base, entity: 'review', reason: 'שם החברה בלי ח.פ. — כנראה חברה, בדוק' };
  if (osekName && !companyName) return { ...base, entity: 'review', reason: 'שם העוסק בלי ע.מ. — רו"ח עלול לדחות, בדוק' };
  return { ...base, entity: 'review', reason: 'לא נמצא מספר עוסק/ח.פ. במסמך' };
}
