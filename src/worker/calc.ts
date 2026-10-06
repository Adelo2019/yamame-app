// 養殖計算ロジック(純粋関数のみ。DBや画面に依存しない)
// 単位: 重量g / 金額円 / 率bp(1%=100)

export type WeightSource = 'measured' | 'intake' | 'estimated';

export interface WeightPoint {
  date: string; // YYYY-MM-DD
  avgG: number;
  source: WeightSource;
}

/** 日本時間の今日(YYYY-MM-DD) */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 2つの日付の差(日) */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * 実測平均重量: 最新の成長測定と、最新の導入/移動入の平均重量のうち日付が新しい方。
 * 同日なら成長測定を優先。
 */
export function latestActualWeight(
  sample: { date: string; totalG: number; count: number } | null,
  intake: { date: string; avgG: number } | null,
): WeightPoint | null {
  const s = sample && sample.count > 0
    ? { date: sample.date, avgG: sample.totalG / sample.count, source: 'measured' as const }
    : null;
  const i = intake ? { date: intake.date, avgG: intake.avgG, source: 'intake' as const } : null;
  if (s && i) return s.date >= i.date ? s : i;
  return s ?? i;
}

/** 推定平均重量 = 実測 × e^(SGR × 経過日数) */
export function estimateWeight(actual: WeightPoint, sgrBp: number, onDate: string): WeightPoint {
  const days = Math.max(0, daysBetween(actual.date, onDate));
  const avgG = actual.avgG * Math.exp((sgrBp / 10000) * days);
  return { date: onDate, avgG, source: 'estimated' };
}

/** 2回の実測から日間成長率(bp)。計算できなければ null */
export function sgrBpFromSamples(
  a: { date: string; avgG: number },
  b: { date: string; avgG: number },
): number | null {
  const days = daysBetween(a.date, b.date);
  if (days <= 0 || a.avgG <= 0 || b.avgG <= 0) return null;
  return ((Math.log(b.avgG) - Math.log(a.avgG)) / days) * 10000;
}

/** 目標サイズ到達予測日。SGRが0以下なら null */
export function predictDateForWeight(
  current: WeightPoint, targetG: number, sgrBp: number,
): string | null {
  if (current.avgG >= targetG) return current.date;
  if (sgrBp <= 0) return null;
  const days = Math.ceil(Math.log(targetG / current.avgG) / (sgrBp / 10000));
  const d = new Date(Date.parse(current.date + 'T00:00:00Z') + days * 86400000);
  return d.toISOString().slice(0, 10);
}

/** 推定総重量(g) = 匹数 × 平均重量 */
export function biomassG(count: number, avgG: number): number {
  return Math.round(count * avgG);
}

/** 推奨給餌量(g) = 総重量 × 給餌率 */
export function recommendedFeedG(biomass: number, rateBp: number): number {
  return Math.round((biomass * rateBp) / 10000);
}

/** 餌代(円) = 給餌量g × 単価円/kg ÷ 1000 */
export function feedCostYen(amountG: number, pricePerKgYen: number): number {
  return Math.round((amountG * pricePerKgYen) / 1000);
}

/** 池使用率(%) */
export function utilizationPct(biomass: number, capacityG: number): number {
  if (capacityG <= 0) return 0;
  return (biomass / capacityG) * 100;
}

/** 生残率(%) = (導入 − 死亡 − 不明減耗) ÷ 導入 */
export function survivalPct(intake: number, dead: number, unknownLoss: number): number {
  if (intake <= 0) return 0;
  return ((intake - dead - unknownLoss) / intake) * 100;
}

/**
 * 日付時点で有効なルールを選ぶ(effective_from が日付以前で最も新しいもの)。
 * 池別ルール > サイズ帯一致 > 共通 の順に優先。
 */
export interface RuleRow {
  pond_id: number | null;
  min_weight_g: number | null;
  max_weight_g: number | null;
  effective_from: string;
}
export function pickRule<T extends RuleRow>(
  rules: T[], onDate: string, avgG: number | null, pondId: number,
): T | null {
  const ok = rules.filter((r) =>
    r.effective_from <= onDate &&
    (r.pond_id === null || r.pond_id === pondId) &&
    (avgG === null || ((r.min_weight_g === null || avgG >= r.min_weight_g) &&
                       (r.max_weight_g === null || avgG < r.max_weight_g))));
  ok.sort((a, b) =>
    (Number(b.pond_id !== null) - Number(a.pond_id !== null)) ||
    b.effective_from.localeCompare(a.effective_from));
  return ok[0] ?? null;
}
