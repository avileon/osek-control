// חד-פעמי, על המחשב שלך: מקבל refresh token לחשבון avi@vibit.co.il.
// לפני: Google Cloud Console → OAuth client מסוג "Desktop" או "Web" עם redirect http://localhost:3999/oauth2callback
import http from 'node:http';
import { oauthClient, SCOPES } from '../src/lib/google.js';
import { config } from '../src/config.js';

const client = oauthClient('http://localhost:3999/oauth2callback');
const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, login_hint: config.gmail.user });
console.log('\nפתח בדפדפן והתחבר עם', config.gmail.user, ':\n\n' + url + '\n');

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:3999');
  if (u.pathname !== '/oauth2callback') return res.end();
  const { tokens } = await client.getToken(u.searchParams.get('code'));
  res.end('OK — חזור לטרמינל');
  console.log('\nהוסף ל-.env:\nGOOGLE_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
  process.exit(0);
}).listen(3999);
