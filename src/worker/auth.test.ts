// 実行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken, safeEqual } from './auth.ts';

test('正しいパスコードで作ったトークンは有効、別のパスコードでは無効', async () => {
  const t = await createSessionToken('1234', 1_000_000);
  assert.equal(await verifySessionToken('1234', t, 1_000_001), true);
  assert.equal(await verifySessionToken('9999', t, 1_000_001), false);
});

test('期限切れ・改ざん・空は無効', async () => {
  const t = await createSessionToken('1234', 1_000_000);
  assert.equal(await verifySessionToken('1234', t, 1_000_000 + 181 * 86400), false);
  assert.equal(await verifySessionToken('1234', t.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')), 1_000_001), false);
  assert.equal(await verifySessionToken('1234', undefined), false);
  assert.equal(await verifySessionToken('1234', '99999999999.abc'), false);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
