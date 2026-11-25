import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const superAdminPasskey = 'test-administrative-passkey-123';

test('production API protects admin rotation and validates inputs without payment webhook secrets', async (t) => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));

  const child = spawn(process.execPath, ['server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SUPERADMIN_PASSKEY: superAdminPasskey,
    },
    stdio: 'ignore',
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(50);
  }
  assert.ok(ready, 'server should start');

  const post = (path, headers, payload) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });

  // 1. Bootstrap status reports env_configured when SUPERADMIN_PASSKEY is set
  const statusRes = await fetch(`${base}/api/admin/bootstrap-status`);
  assert.equal(statusRes.status, 200);
  const statusJson = await statusRes.json();
  assert.equal(statusJson.mode, 'env_configured');

  // 2. Unauthenticated rotation fails closed with 401
  assert.equal((await post('/api/admin/rotate-keys', {}, { passkey: superAdminPasskey })).status, 401);

  // 3. Invalid passkey rejected with 403; valid passkey mints session token
  assert.equal((await post('/api/admin/verify-passkey', {}, { passkey: 'wrong-passkey' })).status, 403);
  const authRes = await post('/api/admin/verify-passkey', {}, { passkey: superAdminPasskey });
  assert.equal(authRes.status, 200);
  const authJson = await authRes.json();
  assert.ok(authJson.token);

  // 4. Authenticated rotation enforces secondary passkey & blocks private/non-HTTPS SSRF URLs
  assert.equal(
    (await post('/api/admin/rotate-keys', { 'X-Admin-Token': authJson.token }, { passkey: 'wrong-passkey' })).status,
    403
  );
  assert.equal(
    (
      await post(
        '/api/admin/rotate-keys',
        { 'X-Admin-Token': authJson.token },
        { passkey: superAdminPasskey, newUrl: 'http://127.0.0.1/' }
      )
    ).status,
    400
  );

  // 5. Public Maps config endpoint sets no-store and reflects configuration state
  const mapsCfgRes = await fetch(`${base}/api/config/maps`);
  assert.equal(mapsCfgRes.status, 200);
  assert.equal(mapsCfgRes.headers.get('cache-control'), 'no-store');
  const mapsCfgJson = await mapsCfgRes.json();
  assert.equal(typeof mapsCfgJson.configured, 'boolean');

  // 6. Maps and Search grounding endpoints enforce required inputs
  assert.equal((await post('/api/ai/venue-maps-intel', {}, {})).status, 400);
  assert.equal((await post('/api/ai/search-intel', {}, {})).status, 400);

  // 7. Unknown API route returns 404
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
});
