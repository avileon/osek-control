import { google } from 'googleapis';
import { config } from '../config.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify', // קריאה + תיוג "osek-processed"
  'https://www.googleapis.com/auth/gmail.send',   // שליחה לרו"ח (רק אחרי אישור)
  'https://www.googleapis.com/auth/drive',        // יצירת תיקיות חודש והעלאה
];

export function oauthClient(redirectUri) {
  const g = config.google;
  if (!g.clientId || !g.clientSecret) throw new Error('חסרים פרטי OAuth של Google — העלה את קובץ ה-JSON בדף ההגדרות');
  return new google.auth.OAuth2(g.clientId, g.clientSecret, redirectUri || g.redirectUri);
}

let cached;
export function resetClients() { cached = undefined; }

export function clients() {
  if (cached) return cached;
  if (!config.google.refreshToken) throw new Error('Google לא מחובר — הגדרות ← "חבר את Google"');
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: config.google.refreshToken });
  cached = { auth, gmail: google.gmail({ version: 'v1', auth }), drive: google.drive({ version: 'v3', auth }) };
  return cached;
}
