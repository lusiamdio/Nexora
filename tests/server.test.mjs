import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const paystackSecret = 'test-paystack-secret';
const stripeSecret = 'test-stripe-secret';
const flutterwaveSecret = 'test-flutterwave-hash';
const adminPasskey = 'test-administrative-passkey';

test('production API authenticates webhook bodies and protects rotation', async (t) => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), PAYSTACK_SECRET_KEY: paystackSecret,
      STRIPE_WEBHOOK_SECRET: stripeSecret, FLUTTERWAVE_SECRET_HASH: flutterwaveSecret, ADMIN_ROTATION_PASSKEY: adminPasskey },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await delay(50);
  }
  assert.ok(ready, 'server should start');
  const body = '{"event":"charge.success","type":"payment_intent.succeeded"}';
  const post = (path, headers, payload = body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload });
  const paystack = createHmac('sha512', paystackSecret).update(body).digest('hex');
  assert.equal((await post('/api/webhooks/paystack', { 'x-paystack-signature': paystack })).status, 200);
  assert.equal((await post('/api/webhooks/paystack', { 'x-paystack-signature': paystack }, '{}')).status, 401);
  assert.equal((await post('/api/webhooks/paystack', { 'x-paystack-signature': 'simulated-valid-test-signature' })).status, 401);
  const timestamp = Math.floor(Date.now() / 1000);
  const stripe = createHmac('sha256', stripeSecret).update(`${timestamp}.${body}`).digest('hex');
  assert.equal((await post('/api/webhooks/stripe', { 'stripe-signature': `t=${timestamp},v1=${stripe}` })).status, 200);
  assert.equal((await post('/api/webhooks/stripe', { 'stripe-signature': `t=${timestamp - 600},v1=${stripe}` })).status, 401);
  assert.equal((await post('/api/webhooks/stripe', { 'stripe-signature': `t=${timestamp},v1=bad${stripe}` })).status, 401);
  assert.equal((await post('/api/webhooks/flutterwave', { 'verif-hash': flutterwaveSecret })).status, 200);
  assert.equal((await post('/api/webhooks/flutterwave', { 'verif-hash': 'simulated-valid-test-signature' })).status, 401);
  assert.equal((await post('/api/admin/rotate-keys', {}, JSON.stringify({ passkey: 'NEXORA-0102@' }))).status, 403);
  assert.equal((await post('/api/admin/rotate-keys', {}, JSON.stringify({ passkey: adminPasskey, newUrl: 'http://127.0.0.1/' }))).status, 400);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
});
