import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import prisma from '../src/service/prisma.js';
import MailService from '../src/service/mailService.js';
import { checkOtp } from '../src/service/otpService.js';
import app from '../index.js';

test('QA-006 password recovery enforces a shared cooldown per normalized address', async (t) => {
  const email = 'qa_r2_otp_cooldown@example.invalid';
  t.mock.method(MailService, 'sendMailForgotPasssword', async () => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let user;
  try {
    user = await prisma.user.create({ data: { email, fullName: 'qa_r2_otp', emailVerified: true, password: await bcrypt.hash('fixture-password', 4) } });
    const send = value => fetch('http://127.0.0.1:' + server.address().port + '/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: value }),
    });
    assert.equal((await send(email)).status, 200);
    assert.equal((await send(email)).status, 429);
    assert.equal((await send(' ' + email.toUpperCase() + ' ')).status, 429);
    assert.equal(MailService.sendMailForgotPasssword.mock.callCount(), 1);
  } finally {
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await new Promise(resolve => server.close(resolve));
  }
});

test('QA-006 OTP windows reject expired and consumed codes and invalidate five failures', async () => {
  const email = 'qa_r2_otp_window@example.invalid';
  const user = await prisma.user.create({ data: { email, fullName: 'qa_r2_otp', password: await bcrypt.hash('fixture-password', 4) } });
  const hash = await bcrypt.hash('112233', 4);
  const add = (type, expiresAt) => prisma.otp.create({ data: { userId: user.id, identifier: email, type, code: hash, expiresAt } });
  try {
    for (const [type, mode] of [['VERIFY_EMAIL', 'email'], ['FORGOT_PASSWORD', 'verify']]) {
      const expired = await add(type, new Date(0));
      assert.equal(await checkOtp(email, type, '112233', mode), 400);
      await prisma.otp.delete({ where: { id: expired.id } });
    }
    const future = new Date(Date.now() + 60_000);
    const emailCode = await add('VERIFY_EMAIL', future);
    assert.equal(await checkOtp(email, 'VERIFY_EMAIL', '112233', 'email'), 200);
    assert.equal((await prisma.otp.findUniqueOrThrow({ where: { id: emailCode.id } })).isUsed, true);
    assert.equal(await checkOtp(email, 'VERIFY_EMAIL', '112233', 'email'), 400);

    const resetCode = await add('FORGOT_PASSWORD', future);
    for (const expected of [400, 400, 400, 400, 429]) {
      assert.equal(await checkOtp(email, 'FORGOT_PASSWORD', '000000', 'verify'), expected);
    }
    assert.equal((await prisma.otp.findUniqueOrThrow({ where: { id: resetCode.id } })).isUsed, true);
    await prisma.otp.delete({ where: { id: resetCode.id } });
    await add('FORGOT_PASSWORD', future);
    assert.equal(await checkOtp(email, 'FORGOT_PASSWORD', '112233', 'verify'), 200);
    assert.equal(await checkOtp(email, 'FORGOT_PASSWORD', '112233', 'reset', hash), 200);
    assert.equal(await checkOtp(email, 'FORGOT_PASSWORD', '112233', 'reset', hash), 400);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
