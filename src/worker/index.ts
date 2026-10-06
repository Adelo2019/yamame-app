import { Hono } from 'hono';
import {
  todayJst, latestActualWeight, biomassG, recommendedFeedG, utilizationPct, pickRule,
} from './calc';

type Env = { Bindings: { DB: D1Database } };
const app = new Hono<Env>();

// ---------- 動作確認 ----------
app.get('/api/health', async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).first<{ n: number }>();
  return c.json({ ok: true, today: todayJst(), tables: r?.n ?? 0 });
});

// ---------- 設定(今日時点で有効な値) ----------
app.get('/api/settings', async (c) => {
  const today = c.req.query('date') ?? todayJst();
  const db = c.env.DB;
  const settings = await db.prepare(
    `SELECT s.key, s.value, s.effective_from, s.note FROM settings s
     WHERE s.effective_from <= ?1 AND s.effective_from = (
       SELECT max(effective_from) FROM settings s2 WHERE s2.key = s.key AND s2.effective_from <= ?1)
     ORDER BY s.key`,
  ).bind(today).all();
  const feedPrices = await db.prepare(
    `SELECT f.id AS feed_id, f.name, p.price_per_kg_yen, p.effective_from FROM feeds f
     JOIN feed_prices p ON p.feed_id = f.id
     WHERE p.effective_from = (SELECT max(effective_from) FROM feed_prices p2
                               WHERE p2.feed_id = f.id AND p2.effective_from <= ?1)`,
  ).bind(today).all();
  const feedingRules = await db.prepare(
    `SELECT r.*, sp.name AS species_name FROM feeding_rules r JOIN species sp ON sp.id = r.species_id
     ORDER BY r.species_id, r.stage, r.effective_from DESC`,
  ).all();
  const growth = await db.prepare(
    `SELECT g.*, sp.name AS species_name FROM growth_assumptions g JOIN species sp ON sp.id = g.species_id
     ORDER BY g.effective_from DESC`,
  ).all();
  return c.json({
    date: today,
    settings: settings.results,
    feedPrices: feedPrices.results,
    feedingRules: feedingRules.results,
    growthAssumptions: growth.results,
  });
});

// ---------- ロット ----------
app.get('/api/lots', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT l.*, sp.name AS species_name FROM lots l JOIN species sp ON sp.id = l.species_id
     ORDER BY l.purchase_date DESC, l.id DESC`,
  ).all();
  return c.json(r.results);
});

// ---------- 池(現在値は履歴から計算) ----------
type PondRow = {
  id: number; code: string; name: string; capacity_g: number; site_name: string; water_type: string;
};
type StockRow = { lot_id: number; pond_id: number; cnt: number; species_id: number; lot_code: string };
type SampleRow = { lot_id: number; pond_id: number; date: string; sample_total_g: number; sample_count: number };
type IntakeRow = { lot_id: number; pond_id: number; date: string; avg_weight_g: number };
type FeedRuleRow = {
  species_id: number; stage: string; pond_id: number | null; min_weight_g: number | null;
  max_weight_g: number | null; rate_bp: number; effective_from: string;
};

app.get('/api/ponds', async (c) => {
  const day = c.req.query('date') ?? todayJst();
  const db = c.env.DB;
  const [ponds, stocks, samples, intakes, rules] = await Promise.all([
    db.prepare(
      `SELECT p.id, p.code, p.name, p.capacity_g, s.name AS site_name, s.water_type
       FROM ponds p JOIN sites s ON s.id = p.site_id WHERE p.active = 1 ORDER BY p.sort_order, p.id`,
    ).all<PondRow>(),
    db.prepare(
      `SELECT e.lot_id, e.pond_id, sum(e.count_delta) AS cnt, l.species_id, l.code AS lot_code
       FROM stock_events e JOIN lots l ON l.id = e.lot_id
       WHERE e.voided = 0 AND e.date <= ?1 GROUP BY e.lot_id, e.pond_id HAVING cnt > 0`,
    ).bind(day).all<StockRow>(),
    db.prepare(
      `SELECT lot_id, pond_id, date, sample_total_g, sample_count FROM samplings
       WHERE voided = 0 AND date <= ?1 ORDER BY date DESC, id DESC`,
    ).bind(day).all<SampleRow>(),
    db.prepare(
      `SELECT lot_id, pond_id, date, avg_weight_g FROM stock_events
       WHERE voided = 0 AND date <= ?1 AND type IN ('intake','transfer_in') AND avg_weight_g IS NOT NULL
       ORDER BY date DESC, id DESC`,
    ).bind(day).all<IntakeRow>(),
    db.prepare(`SELECT * FROM feeding_rules`).all<FeedRuleRow>(),
  ]);

  const key = (lot: number, pond: number) => `${lot}:${pond}`;
  const latestSample = new Map<string, SampleRow>();
  for (const s of samples.results) if (!latestSample.has(key(s.lot_id, s.pond_id))) latestSample.set(key(s.lot_id, s.pond_id), s);
  const latestIntake = new Map<string, IntakeRow>();
  for (const i of intakes.results) if (!latestIntake.has(key(i.lot_id, i.pond_id))) latestIntake.set(key(i.lot_id, i.pond_id), i);

  const result = ponds.results.map((p) => {
    const stage = p.water_type === 'seawater' ? 'seawater' : 'freshwater';
    const lots = stocks.results.filter((s) => s.pond_id === p.id).map((s) => {
      const smp = latestSample.get(key(s.lot_id, p.id));
      const ink = latestIntake.get(key(s.lot_id, p.id));
      const w = latestActualWeight(
        smp ? { date: smp.date, totalG: smp.sample_total_g, count: smp.sample_count } : null,
        ink ? { date: ink.date, avgG: ink.avg_weight_g } : null,
      );
      const bio = w ? biomassG(s.cnt, w.avgG) : 0;
      return {
        lotId: s.lot_id, lotCode: s.lot_code, speciesId: s.species_id, count: s.cnt,
        avgWeightG: w ? Math.round(w.avgG * 10) / 10 : null,
        weightSource: w?.source ?? null, weightDate: w?.date ?? null, biomassG: bio,
      };
    });
    const count = lots.reduce((a, l) => a + l.count, 0);
    const bio = lots.reduce((a, l) => a + l.biomassG, 0);
    const avg = count > 0 ? bio / count : null;
    const speciesId = lots[0]?.speciesId ?? 1;
    const rule = pickRule(
      rules.results.filter((r) => r.species_id === speciesId && r.stage === stage), day, avg, p.id,
    );
    return {
      id: p.id, code: p.code, name: p.name, siteName: p.site_name, capacityG: p.capacity_g,
      count, biomassG: bio, avgWeightG: avg === null ? null : Math.round(avg * 10) / 10,
      utilizationPct: Math.round(utilizationPct(bio, p.capacity_g) * 10) / 10,
      rateBp: rule?.rate_bp ?? null,
      recommendedFeedG: rule ? recommendedFeedG(bio, rule.rate_bp) : null,
      lots,
    };
  });
  return c.json({ date: day, ponds: result });
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.text('Not found', 404)));

export default app;
