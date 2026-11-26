import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, detectAmount, detectDocType, detectDate } from '../src/invoices/classify.js';

const ids = { osek: { id: '012345678', name: 'אבי לאון' }, company: { id: '510000001', name: 'ויביט' } };
const pad = ' שורה נוספת של טקסט במסמך כדי לעבור את סף האורך המינימלי '.repeat(2);

test('עוסק לפי ע.מ.', () => {
  const r = classify(`חשבונית מס 1234 לכבוד אבי לאון ע.מ. 012345678 סה"כ לתשלום 1,170.00 תאריך 12/11/2026${pad}`, ids);
  assert.equal(r.entity, 'osek');
  assert.equal(r.amount, 1170);
  assert.equal(r.docDate, '2026-11-12');
});

test('ע.מ. בלי אפס מוביל ועם מקפים', () => {
  assert.equal(classify(`חשבונית מס לקוח 12345678 ${pad}`, ids).entity, 'osek');
  assert.equal(classify(`חשבונית מס לקוח 01-234567-8 ${pad}`, ids).entity, 'osek');
});

test('חברה לפי ח.פ.', () => {
  assert.equal(classify(`חשבונית מס לכבוד ויביט פיתוח תוכנה ח.פ 510000001 ${pad}`, ids).entity, 'company');
});

test('שני המזהים → בדיקה', () => {
  assert.equal(classify(`012345678 510000001 חשבונית ${pad}`, ids).entity, 'review');
});

test('טקסט הפוך (PDF ויזואלי)', () => {
  const reversed = [...`חשבונית מס לכבוד אבי לאון`].reverse().join('');
  assert.equal(classify(`${reversed} 012345678 ${pad}`, ids).entity, 'osek');
});

test('מספר דומה אך ארוך יותר לא נתפס', () => {
  assert.equal(classify(`חשבונית אסמכתא 10123456782 ${pad}`, ids).entity, 'review');
});

test('הצעת מחיר על שם העוסק → בדיקה', () => {
  assert.equal(classify(`הצעת מחיר ל-012345678 ${pad}`, ids).entity, 'review');
});

test('בלי מספר עוסק מוגדר → בדיקה', () => {
  assert.equal(classify(`חשבונית מס 012345678 ${pad}`, { osek: { id: '', name: '' }, company: { id: '', name: '' } }).entity, 'review');
});

test('סריקה ללא טקסט → בדיקה', () => {
  assert.equal(classify('', ids).entity, 'review');
});

test('סוג מסמך', () => {
  assert.equal(detectDocType('חשבונית מס קבלה'), 'tax_invoice_receipt');
  assert.equal(detectDocType('קבלה מס 5'), 'receipt');
  assert.equal(detectAmount('Total: 59.90 USD'), 59.9);
  assert.equal(detectDate('31.13.2026'), null);
});
