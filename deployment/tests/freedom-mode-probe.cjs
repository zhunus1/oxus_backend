// Only synthetic gateway settings. No outgoing HTTP; exercise the real compiled service.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { Logger } = require('@nestjs/common');
const axios = require('axios');
const { FreedomPayService } = require('../../dist/src/modules/billing/service/freedompay.service');
const { freedomSignature } = require('../../dist/src/modules/billing/domain/freedom-signature');
const { PaymentController } = require('../../dist/src/modules/billing/api/payment.controller');
Logger.overrideLogger(false);
async function main() {
  const mode = process.env.FREEDOM_TESTING_MODE;
  const resultUrl = process.env.FREEDOM_RESULT_URL;
  const callbackPath = '/api/v1/' + Reflect.getMetadata('path', PaymentController) + '/' +
    Reflect.getMetadata('path', PaymentController.prototype.handleFreedomWebhook);
  assert.equal(new URL(resultUrl).pathname, callbackPath);
  const gateway = new FreedomPayService(new ConfigService({
    FREEDOM_API_URL: 'https://example.invalid', FREEDOM_MERCHANT_ID: 'synthetic',
    FREEDOM_RECEIVE_SECRET_KEY: 'synthetic-only', FREEDOM_RESULT_URL: resultUrl,
    FREEDOM_SUCCESS_URL: 'https://example.invalid/ok', FREEDOM_FAILURE_URL: 'https://example.invalid/fail',
    FREEDOM_TESTING_MODE: mode,
  }));
  let sent;
  axios.post = async (_url, form) => {
    sent = Object.fromEntries(form.entries());
    return { data: '<response><pg_status>ok</pg_status></response>' };
  };
  const payload = { pg_order_id: 'synthetic-order', pg_payment_id: '123', pg_amount: '1500000', pg_currency: 'KZT',
    pg_result: '1', pg_payment_method: 'bankcard', pg_captured: '1', pg_testing_mode: mode,
    pg_merchant_id: 'synthetic', pg_salt: 'synthetic-salt' };
  const sign = p => ({ ...p, pg_sig: freedomSignature(callbackPath.split('/').at(-1), p, 'synthetic-only') });
  if (!['0', '1'].includes(mode)) {
    await assert.rejects(gateway.initPayment('synthetic-order', 1500000, 'KZT'));
    assert.equal(sent, undefined);
    await assert.rejects(gateway.handleWebhook(sign(payload)), /testing mode is invalid/);
    console.log(JSON.stringify({ effectiveMode: mode ?? null, resultUrl, callbackPath, invalidRejected: true, networkCalls: 0 }));
    return;
  }
  await gateway.initPayment('synthetic-order', 1500000, 'KZT');
  assert.equal(sent.pg_testing_mode, mode);
  assert.equal(sent.pg_result_url, resultUrl);
  assert.equal(sent.pg_request_method, 'POST');
  await gateway.handleWebhook(sign(payload));
  await assert.rejects(gateway.handleWebhook(sign({ ...payload, pg_testing_mode: mode === '1' ? '0' : '1' })), /context mismatch/);
  console.log(JSON.stringify({ effectiveMode: mode, resultUrl, callbackPath, init: sent.pg_testing_mode, callbackAccepted: mode, oppositeModeRejected: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
