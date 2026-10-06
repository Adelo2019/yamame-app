// 確認: 接続状態・池・ロット・設定値・記録者名・ログアウト
import { useEffect, useState } from 'react';
import { api, kg, num, getRecorder, setRecorder, type Master, type PondState } from '../api';
import { Button, Card, ErrorBox, Section } from '../ui';

type Health = { ok: boolean; today: string; tables: number };
type Settings = {
  settings: { key: string; value: string; note: string }[];
  feedPrices: { name: string; price_per_kg_yen: number }[];
  feedingRules: { species_name: string; stage: string; rate_bp: number; note: string }[];
  growthAssumptions: { species_name: string; sgr_bp: number; note: string }[];
};
const pct = (bp: number) => (bp / 100).toFixed(2).replace(/\.?0+$/, '');
const stageLabel: Record<string, string> = { freshwater: '淡水', seawater: '海水' };

export default function Status({ onLogout }: { onLogout: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [ponds, setPonds] = useState<PondState[]>([]);
  const [master, setMaster] = useState<Master | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(getRecorder());
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      api<Health>('/api/health'), api<{ ponds: PondState[] }>('/api/ponds'),
      api<Master>('/api/master'), api<Settings>('/api/settings'),
    ]).then(([h, p, m, s]) => { setHealth(h); setPonds(p.ponds); setMaster(m); setSettings(s); })
      .catch((e) => setError(String((e as Error).message)));
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLogout();
  }

  return (
    <div className="pb-6">
      <h2 className="mb-4 text-base font-bold">確認・設定</h2>
      <ErrorBox message={error} />

      <Section title="この端末の記録者名">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => { setName(e.target.value); setNameSaved(false); }}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm" />
          <Button onClick={() => { setRecorder(name.trim()); setNameSaved(true); }} disabled={!name.trim()}>
            {nameSaved ? '保存済' : '保存'}
          </Button>
        </div>
      </Section>

      <Section title="接続状態">
        {health && <p className="text-sm">データベース接続OK・テーブル {health.tables} 個・今日 {health.today}</p>}
      </Section>

      <Section title={`池（${ponds.length}池・合計 ${kg(ponds.reduce((a, p) => a + p.capacityG, 0), 0)}kg）`}>
        <Card className="divide-y divide-stone-100 p-0">
          {ponds.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div><span className="mr-2 font-mono text-xs text-stone-400">{p.code}</span>{p.name}</div>
              <div className="text-right tabular-nums">
                <div>上限 {kg(p.capacityG, 0)}kg</div>
                <div className="text-xs text-stone-500">{p.count ? `${num(p.count)}匹・${kg(p.biomassG)}kg・${p.utilizationPct}%` : '空'}</div>
              </div>
            </div>
          ))}
        </Card>
      </Section>

      <Section title="ロット">
        {master?.lots.map((l) => (
          <Card key={l.id} className="mb-2 text-sm">
            <div className="font-mono font-semibold">{l.code}</div>
            <div className="text-stone-600">{l.name}（{l.species_name}・{l.source_type}）</div>
            <div className="mt-1 tabular-nums text-stone-600">
              {l.purchase_date} ・ {num(l.purchase_count)}匹 × {l.purchase_avg_g}g ・ {l.unit_price_yen}円/匹 ・ 配置済 {num(l.placed_count)}匹
            </div>
          </Card>
        ))}
      </Section>

      {settings && (
        <Section title="設定値（今日時点）">
          <Card className="space-y-1.5 text-sm">
            {settings.feedingRules.map((r, i) => <div key={`r${i}`}>給餌率（{r.species_name}・{stageLabel[r.stage]}）：<b>{pct(r.rate_bp)}%/日</b> <span className="text-xs text-stone-500">{r.note}</span></div>)}
            {settings.feedPrices.map((f, i) => <div key={`f${i}`}>餌単価：<b>{f.price_per_kg_yen}円/kg</b> <span className="text-xs text-stone-500">{f.name}</span></div>)}
            {settings.growthAssumptions.map((g, i) => <div key={`g${i}`}>仮の成長率（{g.species_name}）：<b>{pct(g.sgr_bp)}%/日</b> <span className="text-xs text-stone-500">{g.note}</span></div>)}
            {settings.settings.map((s) => <div key={s.key}>{s.note}：<b>{s.value}</b></div>)}
          </Card>
        </Section>
      )}

      <Button variant="danger" className="w-full" onClick={logout}>この端末からログアウト</Button>
    </div>
  );
}
