// 池・ロットの「ある日時点の状態」を履歴から計算する
import {
  latestActualWeight, estimateWeight, biomassG, recommendedFeedG, utilizationPct, pickRule,
  type WeightSource,
} from './calc';

type PondRow = {
  id: number; code: string; name: string; capacity_g: number; site_name: string; water_type: string;
};
type StockRow = { lot_id: number; pond_id: number; cnt: number; species_id: number; lot_code: string };
type SampleRow = { lot_id: number; pond_id: number; date: string; sample_total_g: number; sample_count: number };
type IntakeRow = { lot_id: number; pond_id: number; date: string; avg_weight_g: number };
type RuleRow = {
  species_id: number; stage: string; pond_id: number | null; min_weight_g: number | null;
  max_weight_g: number | null; effective_from: string;
};
type FeedRuleRow = RuleRow & { rate_bp: number };
type GrowthRow = RuleRow & { sgr_bp: number };

export interface LotInPond {
  lotId: number; lotCode: string; speciesId: number; count: number;
  avgWeightG: number | null; weightSource: WeightSource | null; weightDate: string | null;
  estimatedAvgWeightG: number | null; biomassG: number;
}
export interface PondState {
  id: number; code: string; name: string; siteName: string; capacityG: number;
  count: number; biomassG: number; avgWeightG: number | null;
  weightSource: WeightSource | null; weightDate: string | null; estimatedAvgWeightG: number | null;
  utilizationPct: number; rateBp: number | null; recommendedFeedG: number | null;
  lots: LotInPond[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function getPondStates(db: D1Database, day: string): Promise<PondState[]> {
  const [ponds, stocks, samples, intakes, rules, growth] = await Promise.all([
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
    db.prepare(`SELECT *, NULL AS pond_id FROM growth_assumptions`).all<GrowthRow>(),
  ]);

  const key = (lot: number, pond: number) => `${lot}:${pond}`;
  const latestSample = new Map<string, SampleRow>();
  for (const s of samples.results) if (!latestSample.has(key(s.lot_id, s.pond_id))) latestSample.set(key(s.lot_id, s.pond_id), s);
  const latestIntake = new Map<string, IntakeRow>();
  for (const i of intakes.results) if (!latestIntake.has(key(i.lot_id, i.pond_id))) latestIntake.set(key(i.lot_id, i.pond_id), i);

  return ponds.results.map((p) => {
    const stage = p.water_type === 'seawater' ? 'seawater' : 'freshwater';
    const lots: LotInPond[] = stocks.results.filter((s) => s.pond_id === p.id).map((s) => {
      const smp = latestSample.get(key(s.lot_id, p.id));
      const ink = latestIntake.get(key(s.lot_id, p.id));
      const w = latestActualWeight(
        smp ? { date: smp.date, totalG: smp.sample_total_g, count: smp.sample_count } : null,
        ink ? { date: ink.date, avgG: ink.avg_weight_g } : null,
      );
      let est: number | null = null;
      if (w) {
        const g = pickRule(growth.results.filter((r) => r.species_id === s.species_id && r.stage === stage), day, w.avgG, p.id);
        if (g) est = round1(estimateWeight(w, g.sgr_bp, day).avgG);
      }
      return {
        lotId: s.lot_id, lotCode: s.lot_code, speciesId: s.species_id, count: s.cnt,
        avgWeightG: w ? round1(w.avgG) : null, weightSource: w?.source ?? null, weightDate: w?.date ?? null,
        estimatedAvgWeightG: est,
        // MVP: 総重量・推奨給餌量は「実測」から計算する
        biomassG: w ? biomassG(s.cnt, w.avgG) : 0,
      };
    });
    const count = lots.reduce((a, l) => a + l.count, 0);
    const bio = lots.reduce((a, l) => a + l.biomassG, 0);
    const avg = count > 0 ? bio / count : null;
    const estBio = lots.reduce((a, l) => a + (l.estimatedAvgWeightG ?? 0) * l.count, 0);
    const speciesId = lots[0]?.speciesId ?? 1;
    const rule = pickRule(rules.results.filter((r) => r.species_id === speciesId && r.stage === stage), day, avg, p.id);
    const oldest = lots.map((l) => l.weightDate).filter((d): d is string => !!d).sort()[0] ?? null;
    return {
      id: p.id, code: p.code, name: p.name, siteName: p.site_name, capacityG: p.capacity_g,
      count, biomassG: bio, avgWeightG: avg === null ? null : round1(avg),
      weightSource: !lots.length ? null : lots.every((l) => l.weightSource === 'measured') ? 'measured' : 'intake',
      weightDate: oldest,
      estimatedAvgWeightG: count > 0 && estBio > 0 ? round1(estBio / count) : null,
      utilizationPct: round1(utilizationPct(bio, p.capacity_g)),
      rateBp: rule?.rate_bp ?? null,
      recommendedFeedG: rule && bio > 0 ? recommendedFeedG(bio, rule.rate_bp) : null,
      lots,
    };
  });
}

/** 日付時点の餌単価(円/kg) */
export async function feedPriceOn(db: D1Database, feedId: number, day: string): Promise<number | null> {
  const r = await db.prepare(
    `SELECT price_per_kg_yen FROM feed_prices WHERE feed_id = ?1 AND effective_from <= ?2
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
  ).bind(feedId, day).first<{ price_per_kg_yen: number }>();
  return r?.price_per_kg_yen ?? null;
}
