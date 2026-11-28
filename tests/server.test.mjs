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

  // 7. Credit token signing and verification reject invalid payloads and tampered signatures
  assert.equal((await post('/api/tokens/credits/sign', {}, { email: 'bad-email', tokensAmount: 100 })).status, 400);
  assert.equal((await post('/api/tokens/credits/sign', {}, { email: 'fan@nexora.events', tokensAmount: -50 })).status, 400);

  const signRes = await post(
    '/api/tokens/credits/sign',
    {},
    { email: 'fan@nexora.events', txType: 'mint_cashback', tokensAmount: 2500, currency: 'ZAR', reference: 'NX-TEST-01' }
  );
  assert.equal(signRes.status, 200);
  const signJson = await signRes.json();
  assert.ok(signJson.tokenSignature?.startsWith('nxr1.'));

  const verifyValidRes = await post('/api/tokens/credits/verify', {}, { tokenSignature: signJson.tokenSignature });
  assert.equal(verifyValidRes.status, 200);
  const verifyValidJson = await verifyValidRes.json();
  assert.equal(verifyValidJson.valid, true);
  assert.equal(verifyValidJson.payload.tokensAmount, 2500);
  assert.equal(verifyValidJson.payload.email, 'fan@nexora.events');

  const tampered = `${signJson.tokenSignature.slice(0, -4)}AAAA`;
  assert.equal((await post('/api/tokens/credits/verify', {}, { tokenSignature: tampered })).status, 403);

  // 8. Credit token SQL migration download endpoint returns idempotent migration SQL
  const sqlRes = await fetch(`${base}/api/supabase/credit-tokens-migration`);
  assert.equal(sqlRes.status, 200);
  const sqlText = await sqlRes.text();
  assert.ok(sqlText.includes('credit_token_wallets'));

  // 9. Alchemy status, input validation & unconfigured fail-closed checks
  const alchemyStatusRes = await fetch(`${base}/api/alchemy/status`);
  assert.equal(alchemyStatusRes.status, 200);
  assert.equal(alchemyStatusRes.headers.get('cache-control'), 'no-store');
  const alchemyStatusJson = await alchemyStatusRes.json();
  assert.equal(typeof alchemyStatusJson.alchemyConfigured, 'boolean');
  assert.equal(typeof alchemyStatusJson.openaiConfigured, 'boolean');

  assert.equal((await post('/api/alchemy/transfers', {}, { address: 'not-an-address' })).status, 400);
  assert.equal((await fetch(`${base}/api/alchemy/nfts?owner=invalid`)).status, 400);

  if (!alchemyStatusJson.alchemyConfigured) {
    assert.equal(
      (await post('/api/alchemy/transfers', {}, { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' })).status,
      503
    );
    assert.equal(
      (await fetch(`${base}/api/alchemy/nfts?owner=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`)).status,
      503
    );
  }

  // 10. Alchemy and OpenAI webhooks fail closed when secrets are unset or headers missing
  assert.equal((await post('/api/webhooks/alchemy', {}, { event: 'test' })).status, 503);
  assert.equal((await post('/api/webhooks/openai', {}, { event: 'test' })).status, 503);

  // 11. MailerLite endpoints enforce validation, admin auth, and fail closed when unconfigured
  const mlStatusRes = await fetch(`${base}/api/mailerlite/status`);
  assert.equal(mlStatusRes.status, 200);
  assert.equal(mlStatusRes.headers.get('cache-control'), 'no-store');
  const mlStatusJson = await mlStatusRes.json();
  assert.equal(typeof mlStatusJson.configured, 'boolean');

  assert.equal((await post('/api/mailerlite/subscribers', {}, { email: 'not-an-email' })).status, 400);
  if (!mlStatusJson.configured) {
    assert.equal((await post('/api/mailerlite/subscribers', {}, { email: 'fan@nexora.events' })).status, 503);
  }
  assert.equal((await fetch(`${base}/api/mailerlite/subscribers`)).status, 401);
  assert.equal((await fetch(`${base}/api/mailerlite/groups`)).status, 401);

  // 12. SEO crawlability endpoints serve robots.txt and sitemap.xml with proper Content-Type
  const robotsRes = await fetch(`${base}/robots.txt`);
  assert.equal(robotsRes.status, 200);
  assert.ok((robotsRes.headers.get('content-type') || '').includes('text/plain'));
  const robotsBody = await robotsRes.text();
  assert.ok(robotsBody.includes('User-agent: *'));
  assert.ok(robotsBody.includes('Disallow: /api/'));
  assert.ok(robotsBody.includes('Sitemap:'));

  const sitemapRes = await fetch(`${base}/sitemap.xml`);
  assert.equal(sitemapRes.status, 200);
  assert.ok((sitemapRes.headers.get('content-type') || '').includes('application/xml'));
  const sitemapBody = await sitemapRes.text();
  assert.ok(sitemapBody.includes('<urlset'));

  // 13. Unknown API route returns 404
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
});

test('webhook endpoints verify HMAC signatures cleanly and reject tampered payloads', async (t) => {
  const crypto = await import('node:crypto');
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));

  const mockAlchemySecret = 'mock-alchemy-webhook-signing-key';
  const mockOpenAiSecretRaw = 'mock-openai-webhook-secret-32bytes!';
  const mockOpenAiSecretEnv = `whsec_${Buffer.from(mockOpenAiSecretRaw, 'utf8').toString('base64')}`;

  const child = spawn(process.execPath, ['server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      SUPERADMIN_PASSKEY: superAdminPasskey,
      ALCHEMY_WEBHOOK_ID: 'wh_mock_123',
      ALCHEMY_WEBHOOK_SIGNING_KEY: mockAlchemySecret,
      OPENAI_WEBHOOK_SECRET: mockOpenAiSecretEnv,
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
  assert.ok(ready, 'webhook test server should start');

  // Alchemy valid vs invalid signature
  const alchemyBody = JSON.stringify({ webhookId: 'wh_mock_123', type: 'ADDRESS_ACTIVITY' });
  const alchemySig = crypto.createHmac('sha256', mockAlchemySecret).update(alchemyBody).digest('hex');

  assert.equal(
    (
      await fetch(`${base}/api/webhooks/alchemy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-alchemy-signature': 'deadbeef' },
        body: alchemyBody,
      })
    ).status,
    403
  );

  const alchemyOk = await fetch(`${base}/api/webhooks/alchemy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-alchemy-signature': alchemySig },
    body: alchemyBody,
  });
  assert.equal(alchemyOk.status, 200);

  // OpenAI Standard Webhooks valid vs invalid signature
  const msgId = 'msg_test_01';
  const ts = String(Math.floor(Date.now() / 1000));
  const openAiBody = JSON.stringify({ type: 'response.completed' });
  const openAiSig = crypto
    .createHmac('sha256', Buffer.from(mockOpenAiSecretRaw, 'utf8'))
    .update(`${msgId}.${ts}.${openAiBody}`)
    .digest('base64');

  assert.equal(
    (
      await fetch(`${base}/api/webhooks/openai`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': msgId,
          'webhook-timestamp': ts,
          'webhook-signature': 'v1,invalidSig==',
        },
        body: openAiBody,
      })
    ).status,
    403
  );

  const openAiOk = await fetch(`${base}/api/webhooks/openai`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${openAiSig}`,
    },
    body: openAiBody,
  });
  assert.equal(openAiOk.status, 200);
});

test('admin rotate-all-keys rotates session and credit signing secrets and invalidates prior tokens', async (t) => {
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
  assert.ok(ready, 'rotation test server should start');

  const post = (path, headers, payload) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });

  // Unauthenticated inventory blocked
  assert.equal((await fetch(`${base}/api/admin/key-inventory`)).status, 401);

  // Sign in and mint an initial credit token
  const authRes = await post('/api/admin/verify-passkey', {}, { passkey: superAdminPasskey });
  const authJson = await authRes.json();
  const initialAdminToken = authJson.token;

  const invRes1 = await fetch(`${base}/api/admin/key-inventory`, {
    headers: { 'X-Admin-Token': initialAdminToken },
  });
  assert.equal(invRes1.status, 200);
  assert.equal(invRes1.headers.get('cache-control'), 'no-store');
  const inv1 = await invRes1.json();
  assert.equal(inv1.keyRotationGeneration, 1);

  const preRotateCredit = await (
    await post(
      '/api/tokens/credits/sign',
      {},
      { email: 'rotate@nexora.events', txType: 'mint_cashback', tokensAmount: 1000, currency: 'ZAR' }
    )
  ).json();
  assert.equal(
    (await post('/api/tokens/credits/verify', {}, { tokenSignature: preRotateCredit.tokenSignature })).status,
    200
  );

  // Wrong secondary passkey cannot trigger rotation
  assert.equal(
    (
      await post('/api/admin/rotate-all-keys', { 'X-Admin-Token': initialAdminToken }, { passkey: 'bad-passkey' })
    ).status,
    403
  );

  // Valid full rotation succeeds, increments generation, and mints fresh admin token
  const rotRes = await post(
    '/api/admin/rotate-all-keys',
    { 'X-Admin-Token': initialAdminToken },
    { passkey: superAdminPasskey }
  );
  assert.equal(rotRes.status, 200);
  const rotJson = await rotRes.json();
  assert.equal(rotJson.success, true);
  assert.equal(rotJson.keyRotationGeneration, 2);
  assert.ok(rotJson.nextAdminToken);
  assert.notEqual(
    rotJson.internalFingerprints.adminSessionSecret,
    inv1.internalFingerprints.adminSessionSecret
  );
  assert.notEqual(
    rotJson.internalFingerprints.creditTokenSecret,
    inv1.internalFingerprints.creditTokenSecret
  );

  // Old admin session token and pre-rotation credit token are immediately invalidated
  assert.equal(
    (await fetch(`${base}/api/admin/key-inventory`, { headers: { 'X-Admin-Token': initialAdminToken } })).status,
    401
  );
  assert.equal(
    (await post('/api/tokens/credits/verify', {}, { tokenSignature: preRotateCredit.tokenSignature })).status,
    403
  );

  // New admin token & newly signed credit tokens work cleanly
  assert.equal(
    (await fetch(`${base}/api/admin/key-inventory`, { headers: { 'X-Admin-Token': rotJson.nextAdminToken } })).status,
    200
  );
  const postRotateCredit = await (
    await post(
      '/api/tokens/credits/sign',
      {},
      { email: 'rotate@nexora.events', txType: 'mint_cashback', tokensAmount: 1000, currency: 'ZAR' }
    )
  ).json();
  assert.equal(
    (await post('/api/tokens/credits/verify', {}, { tokenSignature: postRotateCredit.tokenSignature })).status,
    200
  );
});


