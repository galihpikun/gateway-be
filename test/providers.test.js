import test from 'node:test';
import assert from 'node:assert/strict';
import MailService from '../src/service/mailService.js';
import RefundService from '../src/service/refundService.js';

test('Resend waits for provider acceptance and surfaces errors without logging OTP', async () => {
  const originalFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 'test-resend';
  process.env.RESEND_FROM_EMAIL = 'Gateway <sender@example.invalid>';
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      const body = JSON.parse(options.body);
      assert.equal(body.from, process.env.RESEND_FROM_EMAIL);
      assert.deepEqual(body.to, ['recipient@example.invalid']);
      assert.ok(body.text.includes('123456'));
      return new Response(JSON.stringify({ id: 'test-email' }), { status: 200 });
    };
    await MailService.sendMailForgotPasssword('recipient@example.invalid', '123456');
    globalThis.fetch = async () => new Response('{}', { status: 403 });
    await assert.rejects(MailService.sendMailForgotPasssword('recipient@example.invalid', '123456'), /403/);
    delete process.env.RESEND_API_KEY;
    await assert.rejects(MailService.sendMailForgotPasssword('recipient@example.invalid', '123456'), /RESEND_API_KEY/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Xendit refund contracts use payment IDs for V3 and request IDs for legacy', async () => {
  const originalFetch = globalThis.fetch;
  process.env.XENDIT_SECRET_KEY = 'test-xendit';
  try {
    for (const paymentId of ['py-test', 'pr-test']) {
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(url, paymentId.startsWith('py-') ? 'https://api.xendit.co/v3/refunds' : 'https://api.xendit.co/refunds');
        assert.equal(body[paymentId.startsWith('py-') ? 'payment_id' : 'payment_request_id'], paymentId);
        assert.equal(body.reference_id, 'refund-key');
        assert.equal(body.reason, 'REQUESTED_BY_CUSTOMER');
        assert.equal(body.amount, 95000);
        assert.equal(options.headers['Idempotency-key'], 'refund-key');
        if (paymentId.startsWith('py-')) assert.equal(options.headers['api-version'], '2024-11-11');
        return new Response(JSON.stringify({ refund_id: 'rfd-test', status: 'PENDING' }), { status: 200 });
      };
      assert.equal((await RefundService.createXenditRefund({ paymentId, amount: 95000, reason: 'Free text reason', idempotencyKey: 'refund-key' })).id, 'rfd-test');
    }
  } finally { globalThis.fetch = originalFetch; }
});
