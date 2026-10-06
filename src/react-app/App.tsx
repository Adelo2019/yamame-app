// Phase 1: DB接続と初期データの確認画面
// Phase 2以降でここを「今日の記録」「ダッシュボード」に置き換えていく
import { useEffect, useState, type ReactNode } from 'react';

type Health = { ok: boolean; today: string; tables: number };
type Pond = {
  id: number; code: string; name: string; siteName: string; capacityG: number;
  count: number; biomassG: number; utilizationPct: number; rateBp: number | null; recommendedFeedG: number | null;
};
type Lot = {
  id: number; code: string; name: string; species_name: string; source_type: string;
  purchase_date: string; purchase_count: number; purchase_avg_g: number;
  unit_price_yen: number; total_price_yen: number; status: string;
};
type Settings = {
  settings: { key: string; value: string; note: string }[];
  feedPrices: { name: string; price_per_kg_yen: number; effective_from: string }[];
  feedingRules: { species_name: string; stage: string; rate_bp: number; effective_from: string; note: string }[];
  growthAssumptions: { species_name: string; sgr_bp: number; note: string }[];
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json() as Promise<T>;
}

const kg = (g: number) => (g / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const pct = (bp: number) => (bp / 100).toFixed(2).replace(/\.?0+$/, '');
const stageLabel: Record<string, string> = { freshwater: '淡水', seawater: '海水' };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [ponds, setPonds] = useState<Pond[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getJson<Health>('/api/health'),
      getJson<{ ponds: Pond[] }>('/api/ponds'),
      getJson<Lot[]>('/api/lots'),
      getJson<Settings>('/api/settings'),
    ])
      .then(([h, p, l, s]) => { setHealth(h); setPonds(p.ponds); setLots(l); setSettings(s); })
      .catch((e) => setError(String(e)));
  }, []);

  const totalCapacity = ponds.reduce((a, p) => a + p.capacityG, 0);

  return (
    <div className="mx-auto max-w-xl px-4 pb-16">
      <header className="sticky top-0 z-10 -mx-4 mb-4 bg-[#0f3d3e] px-4 py-3 text-white">
        <h1 className="text-lg font-bold">ヤマメ養殖管理</h1>
        <p className="text-xs opacity-80">Phase 1 ・ 接続確認</p>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          読み込みに失敗しました：{error}
        </div>
      )}

      <Section title="接続状態">
        {health ? (
          <p className="text-sm">
            <span className="mr-2 inline-block rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">OK</span>
            データベース接続済み・テーブル {health.tables} 個・今日 {health.today}
          </p>
        ) : !error && <p className="text-sm text-stone-500">確認中…</p>}
      </Section>

      <Section title={`池（${ponds.length}池・合計 ${kg(totalCapacity)}kg）`}>
        <div className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          {ponds.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
              <div>
                <span className="mr-2 font-mono text-xs text-stone-500">{p.code}</span>
                <span className="font-medium">{p.name}</span>
              </div>
              <div className="text-right tabular-nums">
                <div>上限 {kg(p.capacityG)}kg</div>
                <div className="text-xs text-stone-500">
                  {p.count > 0 ? `${p.count.toLocaleString()}匹・${kg(p.biomassG)}kg・${p.utilizationPct}%` : '空'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="ロット">
        {lots.map((l) => (
          <div key={l.id} className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono font-semibold">{l.code}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                {l.status === 'planned' ? '導入予定' : l.status}
              </span>
            </div>
            <div className="text-stone-600">{l.name}（{l.species_name}・{l.source_type}）</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
              <dt className="text-stone-500">導入日</dt><dd>{l.purchase_date}</dd>
              <dt className="text-stone-500">匹数</dt><dd>{l.purchase_count.toLocaleString()}匹</dd>
              <dt className="text-stone-500">平均重量</dt><dd>{l.purchase_avg_g}g</dd>
              <dt className="text-stone-500">仕入単価</dt><dd>{l.unit_price_yen}円/匹</dd>
              <dt className="text-stone-500">仕入総額</dt><dd>{l.total_price_yen.toLocaleString()}円</dd>
            </dl>
          </div>
        ))}
      </Section>

      {settings && (
        <Section title="設定値（今日時点）">
          <ul className="space-y-1.5 rounded-xl border border-stone-200 bg-white p-3 text-sm">
            {settings.feedingRules.map((r, i) => (
              <li key={`fr${i}`}>給餌率（{r.species_name}・{stageLabel[r.stage]}）：<b>{pct(r.rate_bp)}%/日</b>
                <span className="text-xs text-stone-500"> {r.note}</span></li>
            ))}
            {settings.feedPrices.map((f, i) => (
              <li key={`fp${i}`}>餌単価：<b>{f.price_per_kg_yen}円/kg</b><span className="text-xs text-stone-500"> {f.name}</span></li>
            ))}
            {settings.growthAssumptions.map((g, i) => (
              <li key={`ga${i}`}>仮の成長率（{g.species_name}）：<b>{pct(g.sgr_bp)}%/日</b>
                <span className="text-xs text-stone-500"> {g.note}</span></li>
            ))}
            {settings.settings.map((s) => (
              <li key={s.key}>{s.note}：<b>{s.value}</b></li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold text-stone-600">{title}</h2>
      {children}
    </section>
  );
}
