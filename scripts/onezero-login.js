// חד-פעמי: מקבל קוד SMS מבנק ONE ושומר טוקן ארוך-טווח מוצפן ב-DB.
// הרצה: npm run onezero:login  (או בדוקר: docker compose run --rm app npm run onezero:login)
import readline from 'node:readline/promises';
import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import { config } from '../src/config.js';
import { setSecret } from '../src/lib/crypto.js';
import { scraperOptions, ONEZERO_TOKEN_KEY } from '../src/bank/sync.js';

const phone = config.bank.oneZero.phone;
if (!phone) { console.error('ONEZERO_PHONE חסר ב-.env (פורמט +9725XXXXXXXX)'); process.exit(1); }

const scraper = createScraper(scraperOptions(CompanyTypes.oneZero));
await scraper.triggerTwoFactorAuth(phone);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('קוד SMS מבנק ONE: ')).trim();
rl.close();
const res = await scraper.getLongTermTwoFactorToken(code);
if (!res.success) { console.error('נכשל:', res.errorMessage || res.errorType); process.exit(1); }
setSecret(ONEZERO_TOKEN_KEY, res.longTermTwoFactorAuthToken);
console.log('✓ נשמר טוקן OneZero (מוצפן).');
