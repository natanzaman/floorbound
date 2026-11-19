// server/db.js isLocalUrl: which DATABASE_URLs are a local Postgres (no TLS, the URL's sslmode kept) and which are
// remote (Neon: TLS). The host must be the URL's own authority, not text further along.
// Usage: node test/dburl.js
import assert from 'node:assert/strict';
import { isLocalUrl } from '../server/db.js';

let n = 0;
const ok = name => console.log(`  ok ${++n} - ${name}`);

for (const u of ['postgresql://localhost/db', 'postgresql://u@localhost?x=1', 'postgresql://u:p@127.0.0.1:5432/db', 'postgres://localhost',
  'postgresql://u:p@localhost:5432/db', 'postgresql:///db?host=/var/run/postgresql', 'postgresql://u:p@db.example/db?sslmode=disable'])
  assert.equal(isLocalUrl(u), true, u);
ok('local: localhost / 127.0.0.1 as the host (with or without user, port, path, query), a socket host, sslmode=disable');

for (const u of ['postgresql://u:p@ep-cool-name-123.us-east-2.aws.neon.tech/neondb?sslmode=require', 'postgresql://u:p@localhost.neon.tech/db',
  'postgresql://u:p@ep-x.neon.tech/db?options=//localhost/', 'postgresql://u:p@ep-x.neon.tech/db?note=@localhost', '', null])
  assert.equal(isLocalUrl(u), false, String(u));
ok('remote: a Neon URL, a host that only starts with localhost, localhost further along the URL, no URL');

console.log(`dburl: all ${n} checks passed`);
