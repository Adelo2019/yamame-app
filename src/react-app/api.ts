// API呼び出しの共通処理
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const RECORDER_KEY = 'yamame_recorder';

export function getRecorder(): string {
  try { return localStorage.getItem(RECORDER_KEY) ?? ''; } catch { return ''; }
}
export function setRecorder(name: string) {
  try { localStorage.setItem(RECORDER_KEY, name); } catch { /* 保存できない端末では毎回入力 */ }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Recorder': encodeURIComponent(getRecorder()),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, '通信できませんでした。電波の良い場所でもう一度お試しください');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, (data as { error?: string }).error ?? `エラー(${res.status})`);
  }
  return data as T;
}

// ---------- 型 ----------
export type WeightSource = 'measured' | 'intake' | 'estimated';
export interface LotInPond {
  lotId: number; lotCode: string; count: number; avgWeightG: number | null;
  weightSource: WeightSource | null; weightDate: string | null; estimatedAvgWeightG: number | null; biomassG: number;
}
export interface PondState {
  id: number; code: string; name: string; siteName: string; capacityG: number;
  count: number; biomassG: number; avgWeightG: number | null;
  weightSource: WeightSource | null; weightDate: string | null; estimatedAvgWeightG: number | null;
  utilizationPct: number; rateBp: number | null; recommendedFeedG: number | null; lots: LotInPond[];
}
export interface Feeding {
  id: number; pond_id: number; fed_at: string; amount_g: number; feed_price_per_kg_yen: number;
  appetite: 'good' | 'normal' | 'poor' | null; leftover: 0 | 1 | null; note: string | null; created_by: string | null;
}
export interface Water { id: number; pond_id: number; measured_at: string; slot: string; temp_c_x10: number; created_by: string | null }
export interface Mortality {
  id: number; pond_id: number; lot_id: number; lot_code: string; count: number;
  cause_id: number | null; cause_name: string | null; note: string | null; created_by: string | null;
}
export interface DailyLog {
  id: number; date: string; pond_id: number; recommended_feed_g: number | null;
  appetite: string | null; leftover: number | null; note: string | null;
}
export interface TodayData {
  date: string; ponds: PondState[]; feedings: Feeding[]; water: Water[];
  mortalities: Mortality[]; dailyLogs: DailyLog[];
}
export interface MasterLot {
  id: number; code: string; name: string; source_type: string; purchase_date: string;
  purchase_count: number; purchase_avg_g: number; unit_price_yen: number; total_price_yen: number;
  status: string; species_name: string; placed_count: number;
}
export interface Master {
  ponds: { id: number; code: string; name: string; capacity_g: number }[];
  lots: MasterLot[];
  causes: { id: number; name: string }[];
  feeds: { id: number; name: string }[];
}

// ---------- 表示用 ----------
export const kg = (g: number | null | undefined, digits = 1) =>
  g == null ? '—' : (g / 1000).toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ja-JP'));
export const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const hhmm = (iso: string) => iso.slice(11, 16);
export const shortDate = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
export const appetiteLabel: Record<string, string> = { good: '良', normal: '普', poor: '悪' };
export const sourceLabel: Record<string, string> = { measured: '実測', intake: '導入時', estimated: '推定' };
