// 今日の記録: 池一覧 → 池を選んで入力
import { useCallback, useEffect, useState } from 'react';
import {
  api, kg, num, hhmm, shortDate, todayJst, appetiteLabel, sourceLabel,
  type TodayData, type PondState, type Master,
} from '../api';
import { Badge, Button, Card, ErrorBox, NumberInput, Section, Segmented, Toast } from '../ui';

export default function Today({ onGoIntake }: { onGoIntake: () => void }) {
  const [date, setDate] = useState(todayJst());
  const [data, setData] = useState<TodayData | null>(null);
  const [master, setMaster] = useState<Master | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pondId, setPondId] = useState<number | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([api<TodayData>(`/api/today?date=${date}`), api<Master>('/api/master')]);
      setData(t); setMaster(m); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (pondId && data && master) {
    const pond = data.ponds.find((p) => p.id === pondId);
    if (pond) return <PondRecord pond={pond} data={data} master={master} onBack={() => { setPondId(null); load(); }} onSaved={load} />;
  }

  const stocked = data?.ponds.filter((p) => p.count > 0) ?? [];
  const empty = data?.ponds.filter((p) => p.count === 0) ?? [];
  const isToday = date === todayJst();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">{isToday ? '今日の記録' : `${shortDate(date)} の記録`}</h2>
        <input type="date" value={date} max={todayJst()} onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm" />
      </div>
      <ErrorBox message={error} />
      {!data && !error && <p className="text-sm text-stone-500">読み込み中…</p>}

      {data && stocked.length === 0 && (
        <Card className="mb-4 text-sm">
          <p className="mb-3">まだどの池にも魚が登録されていません。まず「導入登録」で、どの池に何匹入れたかを登録してください。</p>
          <Button onClick={onGoIntake}>導入登録へ</Button>
        </Card>
      )}

      <div className="space-y-3">
        {stocked.map((p) => <PondCard key={p.id} pond={p} data={data!} onClick={() => setPondId(p.id)} />)}
      </div>

      {empty.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="text-sm text-stone-500">
            {showEmpty ? '▲' : '▼'} 空の池（{empty.length}）
          </button>
          {showEmpty && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {empty.map((p) => (
                <div key={p.id} className="rounded-lg border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-500">
                  {p.name}・上限{kg(p.capacityG, 0)}kg
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pondDay(data: TodayData, pondId: number) {
  const feedings = data.feedings.filter((f) => f.pond_id === pondId);
  const water = data.water.filter((w) => w.pond_id === pondId);
  const deaths = data.mortalities.filter((m) => m.pond_id === pondId);
  const log = data.dailyLogs.find((l) => l.pond_id === pondId) ?? null;
  const fedG = feedings.reduce((a, f) => a + f.amount_g, 0);
  const morning = water.filter((w) => w.slot === 'morning').at(-1);
  const evening = water.filter((w) => w.slot === 'evening').at(-1);
  return { feedings, water, deaths, log, fedG, morning, evening, deadCount: deaths.reduce((a, d) => a + d.count, 0) };
}

function PondCard({ pond, data, onClick }: { pond: PondState; data: TodayData; onClick: () => void }) {
  const d = pondDay(data, pond.id);
  const done = d.feedings.length > 0;
  const util = pond.utilizationPct;
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <Card className={done ? 'border-emerald-300' : ''}>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-bold">{pond.name}<span className="ml-1.5 font-mono text-xs font-normal text-stone-400">{pond.code}</span></div>
          {done ? <Badge tone="green">給餌 {d.feedings.length}回</Badge> : <Badge tone="amber">未入力</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm tabular-nums">
          <div className="text-stone-500">匹数</div><div className="text-right">{num(pond.count)}匹</div>
          <div className="text-stone-500">平均重量</div>
          <div className="text-right">
            {pond.avgWeightG ?? '—'}g <span className="text-xs text-stone-500">{pond.weightSource ? sourceLabel[pond.weightSource] : ''}{shortDate(pond.weightDate)}</span>
          </div>
          <div className="text-stone-500">総重量</div>
          <div className="text-right">{kg(pond.biomassG)}kg <span className={`text-xs ${util >= 90 ? 'text-red-600' : util >= 80 ? 'text-amber-600' : 'text-stone-500'}`}>{util}%</span></div>
          <div className="text-stone-500">給餌 実績/推奨</div>
          <div className="text-right font-semibold">{kg(d.fedG, 2)} / {kg(pond.recommendedFeedG, 2)}kg</div>
          {(d.morning || d.evening) && (<>
            <div className="text-stone-500">水温 朝/夕</div>
            <div className="text-right">{d.morning ? (d.morning.temp_c_x10 / 10).toFixed(1) : '—'} / {d.evening ? (d.evening.temp_c_x10 / 10).toFixed(1) : '—'}℃</div>
          </>)}
          {d.deadCount > 0 && (<>
            <div className="text-stone-500">死亡</div><div className="text-right text-red-700">{d.deadCount}匹</div>
          </>)}
        </div>
      </Card>
    </button>
  );
}

function PondRecord({ pond, data, master, onBack, onSaved }: {
  pond: PondState; data: TodayData; master: Master; onBack: () => void; onSaved: () => Promise<void>;
}) {
  const d = pondDay(data, pond.id);
  const date = data.date;
  const remaining = pond.recommendedFeedG != null ? Math.max(0, pond.recommendedFeedG - d.fedG) : null;

  const [tempMorning, setTempMorning] = useState('');
  const [tempEvening, setTempEvening] = useState('');
  const [feedG, setFeedG] = useState('');
  const [time, setTime] = useState('');
  const [appetite, setAppetite] = useState<'good' | 'normal' | 'poor' | null>(null);
  const [leftover, setLeftover] = useState<'no' | 'yes' | null>(null);
  const [dead, setDead] = useState(0);
  const [causeId, setCauseId] = useState<number>(master.causes[0]?.id ?? 0);
  const [lotId, setLotId] = useState<number>(pond.lots[0]?.lotId ?? 0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); };
  const nothing = !tempMorning && !tempEvening && !feedG && !appetite && !leftover && dead === 0 && !note;

  async function save() {
    // 入力ミスの確認
    const temps = [tempMorning, tempEvening].filter(Boolean).map(Number);
    if (temps.some((t) => t < 2 || t > 25) && !confirm('水温が2〜25℃の範囲外です。このまま保存しますか？')) return;
    const fg = Number(feedG || 0);
    if (pond.recommendedFeedG && fg > pond.recommendedFeedG * 2 && !confirm(`給餌量 ${num(fg)}g は1日の推奨量の2倍以上です。保存しますか？`)) return;
    if (dead >= 50 && !confirm(`死亡 ${dead}匹 で保存しますか？`)) return;

    setSaving(true); setError(null);
    const done: string[] = [];
    try {
      if (tempMorning) { await api('/api/water', { method: 'POST', body: { pond_id: pond.id, date, slot: 'morning', temp_c: tempMorning } }); setTempMorning(''); done.push('水温(朝)'); }
      if (tempEvening) { await api('/api/water', { method: 'POST', body: { pond_id: pond.id, date, slot: 'evening', temp_c: tempEvening } }); setTempEvening(''); done.push('水温(夕)'); }
      if (feedG) {
        await api('/api/feedings', { method: 'POST', body: {
          pond_id: pond.id, date, time: time || undefined, amount_g: fg, appetite,
          leftover: leftover === null ? undefined : leftover === 'yes',
        } });
        setFeedG(''); setTime(''); done.push('給餌');
      }
      if (dead > 0) {
        await api('/api/mortality', { method: 'POST', body: { pond_id: pond.id, date, lot_id: lotId || undefined, count: dead, cause_id: causeId || undefined } });
        setDead(0); done.push('死亡');
      }
      if (appetite || leftover || note) {
        const body: Record<string, unknown> = { pond_id: pond.id, date };
        if (appetite) body.appetite = appetite;
        if (leftover) body.leftover = leftover === 'yes';
        if (note) body.note = note;
        await api('/api/daily-log', { method: 'PUT', body });
        setAppetite(null); setLeftover(null); setNote(''); done.push('摂餌・備考');
      }
      await onSaved();
      flash('保存しました');
    } catch (e) {
      setError(`${done.length ? `${done.join('・')}は保存済み。` : ''}残りは未送信です：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function voidRecord(table: string, id: number, label: string) {
    if (!confirm(`${label} を取り消しますか？（記録は履歴として残ります）`)) return;
    try {
      await api('/api/void', { method: 'POST', body: { table, id, reason: '入力ミス' } });
      await onSaved(); flash('取り消しました');
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="pb-28">
      <button type="button" onClick={onBack} className="mb-3 text-sm text-[#0f3d3e]">← 池一覧に戻る</button>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-bold">{pond.name}</h2>
        <span className="text-sm text-stone-500">{date === todayJst() ? '今日' : shortDate(date)}</span>
      </div>

      <Card className="mb-4">
        <div className="grid grid-cols-3 text-center tabular-nums">
          <div><div className="text-xs text-stone-500">推奨</div><div className="text-lg font-bold">{kg(pond.recommendedFeedG, 2)}<span className="text-xs">kg</span></div></div>
          <div><div className="text-xs text-stone-500">実績（{d.feedings.length}回）</div><div className="text-lg font-bold">{kg(d.fedG, 2)}<span className="text-xs">kg</span></div></div>
          <div><div className="text-xs text-stone-500">残り</div><div className="text-lg font-bold">{kg(remaining, 2)}<span className="text-xs">kg</span></div></div>
        </div>
        <p className="mt-2 text-center text-xs text-stone-500">
          {num(pond.count)}匹 × {pond.avgWeightG ?? '—'}g（{pond.weightSource ? sourceLabel[pond.weightSource] : ''}{shortDate(pond.weightDate)}）＝ {kg(pond.biomassG)}kg × {pond.rateBp != null ? pond.rateBp / 100 : '—'}%
          {pond.estimatedAvgWeightG != null && <><br />推定平均 {pond.estimatedAvgWeightG}g（参考）</>}
        </p>
      </Card>

      <ErrorBox message={error} />

      <Section title="給餌">
        <NumberInput value={feedG} onChange={setFeedG} unit="g" placeholder="今回の給餌量" />
        {remaining != null && remaining > 0 && (
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setFeedG(String(remaining))}>残り全部 {num(remaining)}g</Button>
            <Button variant="secondary" className="flex-1" onClick={() => setFeedG(String(Math.round(remaining / 2)))}>半分 {num(Math.round(remaining / 2))}g</Button>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-sm text-stone-600">
          <span>時刻</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5" />
          <span className="text-xs text-stone-400">{date === todayJst() ? '空欄なら今の時刻' : '空欄なら12:00'}</span>
        </div>
      </Section>

      <Section title="摂餌・残餌">
        <Segmented value={appetite} onChange={setAppetite}
          options={[{ value: 'good', label: '良' }, { value: 'normal', label: '普' }, { value: 'poor', label: '悪' }]} />
        <div className="mt-2">
          <Segmented value={leftover} onChange={setLeftover}
            options={[{ value: 'no', label: '残餌なし' }, { value: 'yes', label: '残餌あり' }]} />
        </div>
      </Section>

      <Section title="水温">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-xs text-stone-500">朝 {d.morning && <span>（記録済 {(d.morning.temp_c_x10 / 10).toFixed(1)}℃）</span>}</div>
            <NumberInput value={tempMorning} onChange={setTempMorning} unit="℃" decimal />
          </div>
          <div>
            <div className="mb-1 text-xs text-stone-500">夕 {d.evening && <span>（記録済 {(d.evening.temp_c_x10 / 10).toFixed(1)}℃）</span>}</div>
            <NumberInput value={tempEvening} onChange={setTempEvening} unit="℃" decimal />
          </div>
        </div>
      </Section>

      <Section title="死亡">
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setDead(Math.max(0, dead - 1))}>－</Button>
          <NumberInput value={dead ? String(dead) : ''} onChange={(v) => setDead(Number(v || 0))} unit="匹" placeholder="0" className="flex-1" />
          <Button variant="secondary" onClick={() => setDead(dead + 1)}>＋</Button>
        </div>
        {dead > 0 && (
          <div className="mt-2 space-y-2">
            <select value={causeId} onChange={(e) => setCauseId(Number(e.target.value))}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">
              {master.causes.map((c) => <option key={c.id} value={c.id}>原因：{c.name}</option>)}
            </select>
            {pond.lots.length > 1 && (
              <select value={lotId} onChange={(e) => setLotId(Number(e.target.value))}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm">
                {pond.lots.map((l) => <option key={l.lotId} value={l.lotId}>ロット：{l.lotCode}（{num(l.count)}匹）</option>)}
              </select>
            )}
          </div>
        )}
      </Section>

      <Section title="備考">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={d.log?.note ?? '気づいたことなど'}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
      </Section>

      <Section title="この日の記録">
        <Card className="divide-y divide-stone-100 p-0 text-sm">
          {d.feedings.map((f) => (
            <Row key={`f${f.id}`} left={`${hhmm(f.fed_at)} 給餌 ${num(f.amount_g)}g${f.appetite ? `・摂餌${appetiteLabel[f.appetite]}` : ''}${f.leftover ? '・残餌あり' : ''}`}
              by={f.created_by} onVoid={() => voidRecord('feeding_events', f.id, `${hhmm(f.fed_at)} の給餌 ${num(f.amount_g)}g`)} />
          ))}
          {d.water.map((w) => (
            <Row key={`w${w.id}`} left={`${hhmm(w.measured_at)} 水温(${w.slot === 'morning' ? '朝' : w.slot === 'evening' ? '夕' : '他'}) ${(w.temp_c_x10 / 10).toFixed(1)}℃`}
              by={w.created_by} onVoid={() => voidRecord('water_readings', w.id, '水温')} />
          ))}
          {d.deaths.map((m) => (
            <Row key={`m${m.id}`} left={`死亡 ${m.count}匹${m.cause_name ? `（${m.cause_name}）` : ''}`}
              by={m.created_by} onVoid={() => voidRecord('stock_events', m.id, `死亡 ${m.count}匹`)} />
          ))}
          {d.log && (d.log.appetite || d.log.leftover != null || d.log.note) && (
            <div className="px-3 py-2 text-stone-600">
              日次：{d.log.appetite ? `摂餌${appetiteLabel[d.log.appetite]}` : ''}{d.log.leftover != null ? `・残餌${d.log.leftover ? 'あり' : 'なし'}` : ''}{d.log.note ? `・${d.log.note}` : ''}
            </div>
          )}
          {!d.feedings.length && !d.water.length && !d.deaths.length && <div className="px-3 py-3 text-stone-400">まだ記録はありません</div>}
        </Card>
      </Section>

      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <Button className="w-full py-3.5 text-base" onClick={save} disabled={saving || nothing}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
      <Toast message={toast} />
    </div>
  );
}

function Row({ left, by, onVoid }: { left: string; by: string | null; onVoid: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div>
        <div>{left}</div>
        {by && <div className="text-xs text-stone-400">{by}</div>}
      </div>
      <button type="button" onClick={onVoid} className="text-xs text-red-600">取消</button>
    </div>
  );
}
