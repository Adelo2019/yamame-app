// 導入登録: ロットをどの池に何匹入れたか
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, kg, num, shortDate, type Master } from '../api';
import { Button, Card, ErrorBox, NumberInput, Section, Toast } from '../ui';

type IntakeRow = {
  id: number; date: string; lot_code: string; pond_name: string; count: number; avg_weight_g: number; created_by: string | null;
};
type Line = { pondId: number; count: string };

export default function Intake({ onDone }: { onDone: () => void }) {
  const [master, setMaster] = useState<Master | null>(null);
  const [history, setHistory] = useState<IntakeRow[]>([]);
  const [lotId, setLotId] = useState<number>(0);
  const [date, setDate] = useState('');
  const [avg, setAvg] = useState('');
  const [lines, setLines] = useState<Line[]>([{ pondId: 0, count: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, h] = await Promise.all([api<Master>('/api/master'), api<IntakeRow[]>('/api/intakes')]);
      setMaster(m); setHistory(h);
      setLotId((cur) => cur || m.lots[0]?.id || 0);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const lot = master?.lots.find((l) => l.id === lotId);
  useEffect(() => {
    if (lot) { setDate(lot.purchase_date ?? ''); setAvg(String(lot.purchase_avg_g ?? '')); }
  }, [lot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = lines.reduce((a, l) => a + Number(l.count || 0), 0);
  const remaining = lot ? lot.purchase_count - lot.placed_count : 0;
  const preview = useMemo(() => lines.map((l) => {
    const pond = master?.ponds.find((p) => p.id === l.pondId);
    const bio = Number(l.count || 0) * Number(avg || 0);
    return { pond, bio, pct: pond ? Math.round((bio / pond.capacity_g) * 1000) / 10 : 0 };
  }), [lines, avg, master]);

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    if (!lot) return;
    if (lines.some((l) => !l.pondId || !Number(l.count))) { setError('池と匹数をすべて入れてください'); return; }
    if (total > remaining && !confirm(`合計 ${num(total)}匹 が未配置の匹数（${num(remaining)}匹）を超えています。保存しますか？`)) return;
    if (preview.some((p) => p.pct >= 80) && !confirm('収容上限の80%を超える池があります。保存しますか？')) return;
    setSaving(true); setError(null);
    let saved = 0;
    try {
      for (const l of lines) {
        await api('/api/intake', { method: 'POST', body: { lot_id: lot.id, pond_id: l.pondId, date, count: Number(l.count), avg_weight_g: Number(avg) } });
        saved++;
      }
      setLines([{ pondId: 0, count: '' }]);
      setToast('導入を登録しました'); setTimeout(() => setToast(null), 2000);
      await load();
    } catch (e) {
      setError(`${saved ? `${saved}件は登録済み。` : ''}残りは未登録です：${(e as Error).message}`);
      setLines(lines.slice(saved));
    } finally { setSaving(false); }
  }

  async function voidIntake(r: IntakeRow) {
    if (!confirm(`${r.pond_name} への導入 ${num(r.count)}匹 を取り消しますか？`)) return;
    try {
      await api('/api/void', { method: 'POST', body: { table: 'stock_events', id: r.id, reason: '導入の入力ミス' } });
      await load();
    } catch (e) { setError((e as Error).message); }
  }

  if (!master) return <div><ErrorBox message={error} /><p className="text-sm text-stone-500">読み込み中…</p></div>;

  return (
    <div className="pb-6">
      <h2 className="mb-4 text-base font-bold">導入登録</h2>
      <ErrorBox message={error} />

      <Section title="ロット">
        <select value={lotId} onChange={(e) => setLotId(Number(e.target.value))}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">
          {master.lots.map((l) => <option key={l.id} value={l.id}>{l.code}　{l.name}</option>)}
        </select>
        {lot && (
          <p className="mt-2 text-sm text-stone-600">
            仕入 {num(lot.purchase_count)}匹 ・ 配置済 {num(lot.placed_count)}匹 ・ <b>未配置 {num(remaining)}匹</b>
          </p>
        )}
      </Section>

      <Section title="導入日・平均重量">
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm" />
          <NumberInput value={avg} onChange={setAvg} unit="g" />
        </div>
      </Section>

      <Section title="入れる池と匹数" right={<span className="text-sm tabular-nums">合計 {num(total)}匹</span>}>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <Card key={i} className="space-y-2">
              <div className="flex gap-2">
                <select value={l.pondId} onChange={(e) => setLine(i, { pondId: Number(e.target.value) })}
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">
                  <option value={0}>池を選ぶ</option>
                  {master.ponds.map((p) => <option key={p.id} value={p.id}>{p.name}（上限{kg(p.capacity_g, 0)}kg）</option>)}
                </select>
                {lines.length > 1 && <Button variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>削除</Button>}
              </div>
              <NumberInput value={l.count} onChange={(v) => setLine(i, { count: v })} unit="匹" placeholder="匹数" />
              {preview[i]?.pond && Number(l.count) > 0 && (
                <p className={`text-xs ${preview[i].pct >= 80 ? 'text-amber-700' : 'text-stone-500'}`}>
                  {kg(preview[i].bio)}kg ・ 使用率 {preview[i].pct}%（導入時点）
                </p>
              )}
            </Card>
          ))}
        </div>
        <Button variant="ghost" className="mt-2" onClick={() => setLines([...lines, { pondId: 0, count: '' }])}>＋ 池を追加（分けて入れる場合）</Button>
      </Section>

      <Button className="w-full py-3.5 text-base" onClick={save} disabled={saving || !lot || total === 0}>
        {saving ? '登録中…' : '導入を登録'}
      </Button>

      {history.length > 0 && (
        <div className="mt-6"><Section title="登録済みの導入">
          <Card className="divide-y divide-stone-100 p-0 text-sm">
            {history.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <div>{shortDate(r.date)} {r.pond_name} {num(r.count)}匹 × {r.avg_weight_g}g</div>
                  <div className="text-xs text-stone-400">{r.lot_code}{r.created_by ? `・${r.created_by}` : ''}</div>
                </div>
                <button type="button" onClick={() => voidIntake(r)} className="text-xs text-red-600">取消</button>
              </div>
            ))}
          </Card>
          <Button variant="secondary" className="mt-3 w-full" onClick={onDone}>今日の記録へ</Button>
        </Section></div>
      )}
      <Toast message={toast} />
    </div>
  );
}
