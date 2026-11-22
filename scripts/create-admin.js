// RIFT ARENA — create the first Admin account (secure bootstrap).
//
// Usage:
//   ADMIN_BOOTSTRAP_KEY=<key from .env> npm run admin:create -- <username> <password>
//
// Security: the key comes from the ADMIN_BOOTSTRAP_KEY env var; it is never accepted
// from a username choice, and only works while NO admin exists in the database.
import '../server/src/config/load-env.js';
import { getStore } from '../server/src/database/index.js';
import { verifyPassword } from '../server/src/security/index.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run admin:create -- <username> <password>');
  process.exit(1);
}
if (!process.env.ADMIN_BOOTSTRAP_KEY) {
  console.error('ADMIN_BOOTSTRAP_KEY is not set. Add it to your .env first.');
  process.exit(1);
}

const db = await getStore();
const user = await db.getUserByUsername(username);
if (!user) { console.error(`No account "${username}" — register in the game first, then run this.`); process.exit(1); }
if (!verifyPassword(password, user.pass_hash)) { console.error('Wrong password.'); process.exit(1); }

const all = await db.listUsers({ limit: 10000 });
if (all.some(u => u.role === 'ADMIN')) {
  console.error('An ADMIN already exists — use the admin panel (Players → Rôle) to add more staff.');
  process.exit(1);
}
await db.updateUser(user.id, { role: 'ADMIN' });
console.log(`OK — ${username} is now ADMIN. Log in with the game client.`);
