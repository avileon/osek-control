import 'dotenv/config';

const env = (k, d = '') => (process.env[k] ?? d).trim();

// ערכים שאפשר לשנות מדף ההגדרות נשמרים מוצפנים ב-DB ונקראים בזמן ריצה.
// settings.js רושם resolver שבודק קודם DB ואז env. עד שנרשם: env בלבד.
let resolve = (k, d = '') => env(k, d);
export function setResolver(fn) { resolve = fn; }
const r = (k, d = '') => resolve(k, d) || d;

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),
  tz: env('TZ', 'Asia/Jerusalem'),
  appSecret: env('APP_SECRET'),
  dash: { user: env('DASH_USER', 'avi'), pass: env('DASH_PASS') },
  dbPath: env('DB_PATH', './data/osek.db'),

  get osek() { return { id: r('OSEK_ID'), name: r('OSEK_NAME') }; },
  get company() { return { id: r('COMPANY_ID'), name: r('COMPANY_NAME') }; },

  get google() {
    return {
      clientId: r('GOOGLE_CLIENT_ID'),
      clientSecret: r('GOOGLE_CLIENT_SECRET'),
      redirectUri: r('GOOGLE_REDIRECT_URI', `${env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, '')}/oauth2callback`),
      refreshToken: r('GOOGLE_REFRESH_TOKEN'),
    };
  },
  get gmail() {
    return {
      user: r('GMAIL_USER', 'avi@vibit.co.il'),
      query: r('GMAIL_QUERY', 'has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) (חשבונית OR קבלה OR invoice OR receipt OR "חשבון עסקה") -in:sent -label:osek-processed'),
      backfillDays: Number(r('GMAIL_BACKFILL_DAYS', '30')),
      processedLabel: r('GMAIL_PROCESSED_LABEL', 'osek-processed'),
    };
  },
  get drive() {
    return { osekFolderId: r('DRIVE_OSEK_FOLDER_ID'), companyFolderId: r('DRIVE_COMPANY_FOLDER_ID'), reviewFolderId: r('DRIVE_REVIEW_FOLDER_ID') };
  },
  get accountant() {
    return { email: r('ACCOUNTANT_EMAIL'), requireApproval: r('REQUIRE_APPROVAL', 'true') !== 'false' };
  },
  get bank() {
    return {
      daysBack: Number(r('BANK_DAYS_BACK', '45')),
      chromiumPath: env('CHROMIUM_PATH'),
      oneZero: { email: r('ONEZERO_EMAIL'), password: r('ONEZERO_PASSWORD'), phone: r('ONEZERO_PHONE') },
      max: { username: r('MAX_USERNAME'), password: r('MAX_PASSWORD') },
      visaCal: { username: r('VISACAL_USERNAME'), password: r('VISACAL_PASSWORD') },
    };
  },
  get vex() { return { webhookSecret: r('VEX_WEBHOOK_SECRET') }; },
  cron: { gmail: env('CRON_GMAIL', '*/15 * * * *'), bank: env('CRON_BANK', '30 6 * * *') },
};
