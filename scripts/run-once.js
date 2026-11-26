// הרצה ידנית של משימה: node scripts/run-once.js gmail|bank|match
import { runJob } from '../src/jobs.js';

const job = process.argv[2];
const out = await runJob(job);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
