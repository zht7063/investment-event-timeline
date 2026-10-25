import { getDb } from '../src/server/db';
import { backfillLibrary } from '../src/server/research/library-index';
const result = backfillLibrary(getDb(), process.argv.includes('--dry-run'));
console.log(JSON.stringify(result, null, 2));
if (result.failures.length) process.exitCode = 1;
