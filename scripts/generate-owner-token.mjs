import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const isNext = process.argv.includes('--next');
const filename = isNext ? '.owner-token.next' : '.owner-token';
const path = resolve(filename);
if (existsSync(path)) {
  throw new Error(`${filename} already exists. Move or remove it before generating another token.`);
}

const token = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(token, 'utf8').digest('hex');
writeFileSync(path, `${token}\n`, { mode: 0o600, flag: 'wx' });
chmodSync(path, 0o600);

console.log(`Owner token saved to ${filename}. Enter its value in Streak's owner setup.`);
if (!isNext) {
  console.log(
    '\nProvision this digest once in the Neon SQL Editor after applying db/migrations/0001_private_owner_sync.sql:',
  );
  console.log(
    `INSERT INTO private.owner_access (singleton_id, token_hash) VALUES (1, '${digest}');`,
  );
} else {
  console.log(
    "\nUse this token in the app's Rotate owner token screen. The existing token remains active until rotation succeeds.",
  );
}
