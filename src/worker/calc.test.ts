// 実行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  biomassG, recommendedFeedG, feedCostYen, utilizationPct, survivalPct,
  latestActualWeight, estimateWeight, sgrBpFromSamples, predictDateForWeight,
  pickRule, todayJst,
} from './calc.ts';

test('設計書の例: 3,950匹×60g → 237kg、推奨2.37kg、餌代1,304円', () => {
  const b = biomassG(3950, 60);
  assert.equal(b, 237000);
  const feed = recommendedFeedG(b, 100);
  assert.equal(feed, 2370);
  assert.equal(feedCostYen(feed, 550), 1304);
});

test('初回ロット: 4,000匹×50g → 200kg、推奨2kg', () => {
  assert.equal(recommendedFeedG(biomassG(4000, 50), 100), 2000);
});

test('使用率と生残率', () => {
  assert.equal(utilizationPct(237000, 600000).toFixed(1), '39.5');
  assert.equal(survivalPct(4000, 50, 0), 98.75);
});

test('実測は導入より新しい方を採用', () => {
  const w = latestActualWeight({ date: '2026-10-30', totalG: 3000, count: 50 },
                               { date: '2026-10-16', avgG: 50 });
  assert.deepEqual(w, { date: '2026-10-30', avgG: 60, source: 'measured' });
  const w2 = latestActualWeight(null, { date: '2026-10-16', avgG: 50 });
  assert.equal(w2?.source, 'intake');
});

test('成長仮説0.91%/日: 50gから60日で約86g', () => {
  const e = estimateWeight({ date: '2026-10-16', avgG: 50, source: 'intake' }, 91, '2026-12-15');
  assert.ok(e.avgG > 84 && e.avgG < 88, String(e.avgG));
  assert.equal(e.source, 'estimated');
});

test('SGRと到達予測: 50g→60gを20日 → 0.91%/日、60g→100gは約56日(切り上げ57日)後', () => {
  const sgr = sgrBpFromSamples({ date: '2026-10-16', avgG: 50 }, { date: '2026-11-05', avgG: 60 })!;
  assert.equal(Math.round(sgr), 91);
  const d = predictDateForWeight({ date: '2026-11-05', avgG: 60, source: 'measured' }, 100, sgr);
  assert.equal(d, '2027-01-01'); // 56.03日 → 切り上げ57日後
});

test('ルール選択: 池別ルールが共通より優先、日付で新しい方', () => {
  const rules = [
    { id: 1, pond_id: null, min_weight_g: null, max_weight_g: null, effective_from: '2026-10-01', rate_bp: 100 },
    { id: 2, pond_id: null, min_weight_g: null, max_weight_g: null, effective_from: '2026-11-01', rate_bp: 120 },
    { id: 3, pond_id: 8, min_weight_g: null, max_weight_g: null, effective_from: '2026-10-01', rate_bp: 130 },
  ];
  assert.equal(pickRule(rules, '2026-10-20', 60, 7)?.rate_bp, 100);
  assert.equal(pickRule(rules, '2026-11-02', 60, 7)?.rate_bp, 120);
  assert.equal(pickRule(rules, '2026-11-02', 60, 8)?.rate_bp, 130);
});

test('日本時間の日付', () => {
  assert.equal(todayJst(new Date('2026-10-15T16:00:00Z')), '2026-10-16');
});
