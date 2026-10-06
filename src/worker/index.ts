import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { todayJst } from './calc';
import { getPondStates, feedPriceOn } from './state';
import { SESSION_COOKIE, SESSION_DAYS, createSessionToken, verifySessionToken, safeEqual } from './auth';

type Env = { Bindings: { DB: D1Database; APP_PASSCODE?: string } };
type C = Context<Env>;
const app = new Hono<Env>();

// ---------- 共通ヘルパー ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function nowJstIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
}
function recorder(c: C): string | null {
  const raw = c.req.header('X-Recorder');
  if (!raw) return null;
  try { return decodeURIComponent(raw).slice(0, 40) || null; } catch { return null; }
}
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function bad(c: C, message: string) {
  return c.json({ error: message }, 400);
}
async function logChange(
  db: D1Database, table: string, id: number, action: 'insert' | 'update' | 'void',
  before: unknown, after: unknown, by: string | null,
) {
  await db.prepare(
    `INSERT INTO change_log (table_name, record_id, action, before_json, after_json, changed_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(table, id, action, before == null ? null : JSON.stringify(before),
         after == null ? null : JSON.stringify(after), by).run();
}

/** その日の推奨給餌量の根拠を日次記録に残す(既に残っていれば上書きしない) */
async function ensureDailySnapshot(db: D1Database, day: string, pondId: number, by: string | null) {
  const state = (await getPondStates(db, day)).find((p) => p.id === pondId);
  await db.prepare(
    `INSERT INTO daily_pond_logs (date, pond_id, recommended_feed_g, rate_bp_used, biomass_g_at_calc, weight_source, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (date, pond_id) DO UPDATE SET
       recommended_feed_g = COALESCE(daily_pond_logs.recommended_feed_g, excluded.recommended_feed_g),
       rate_bp_used       = COALESCE(daily_pond_logs.rate_bp_used, excluded.rate_bp_used),
       biomass_g_at_calc  = COALESCE(daily_pond_logs.biomass_g_at_calc, excluded.biomass_g_at_calc),
       weight_source      = COALESCE(daily_pond_logs.weight_source, excluded.weight_source)`,
  ).bind(day, pondId, state?.recommendedFeedG ?? null, state?.rateBp ?? null,
         state && state.biomassG > 0 ? state.biomassG : null, state?.weightSource ?? null, by).run();
}

// ---------- 認証(共通パスコード) ----------
app.post('/api/auth/login', async (c) => {
  const secret = c.env.APP_PASSCODE;
  if (!secret) return c.json({ error: 'パスコードがまだ設定されていません' }, 503);
  const body = await c.req.json<{ passcode?: string }>().catch(() => ({} as { passcode?: string }));
  if (!body.passcode || !safeEqual(String(body.passcode), secret)) {
    return c.json({ error: 'パスコードが違います' }, 401);
  }
  setCookie(c, SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
  });
  return c.json({ ok: true });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// /api/auth/* 以外のAPIはログイン必須
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  const secret = c.env.APP_PASSCODE;
  if (!secret) return c.json({ error: 'パスコードがまだ設定されていません' }, 503);
  if (!(await verifySessionToken(secret, getCookie(c, SESSION_COOKIE)))) {
    return c.json({ error: 'ログインが必要です' }, 401);
  }
  return next();
});

app.get('/api/auth/me', async (c) => {
  const secret = c.env.APP_PASSCODE;
  if (!secret) return c.json({ loggedIn: false, configured: false });
  const ok = await verifySessionToken(secret, getCookie(c, SESSION_COOKIE));
  return c.json({ loggedIn: ok, configured: true });
});

// ---------- 動作確認 ----------
app.get('/api/health', async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
  ).first<{ n: number }>();
  return c.json({ ok: true, today: todayJst(), tables: r?.n ?? 0 });
});

// ---------- マスター(画面の選択肢) ----------
app.get('/api/master', async (c) => {
  const db = c.env.DB;
  const [ponds, lots, causes, feeds] = await Promise.all([
    db.prepare(`SELECT id, code, name, capacity_g FROM ponds WHERE active = 1 ORDER BY sort_order, id`).all(),
    db.prepare(
      `SELECT l.id, l.code, l.name, l.source_type, l.purchase_date, l.purchase_count, l.purchase_avg_g,
              l.unit_price_yen, l.total_price_yen, l.status, sp.name AS species_name,
              COALESCE((SELECT sum(count_delta) FROM stock_events e
                        WHERE e.lot_id = l.id AND e.type = 'intake' AND e.voided = 0), 0) AS placed_count
       FROM lots l JOIN species sp ON sp.id = l.species_id
       WHERE l.status <> 'closed' ORDER BY l.purchase_date DESC, l.id DESC`,
    ).all(),
    db.prepare(`SELECT id, name FROM mortality_causes ORDER BY sort_order, id`).all(),
    db.prepare(`SELECT id, name FROM feeds WHERE active = 1 ORDER BY id`).all(),
  ]);
  return c.json({ ponds: ponds.results, lots: lots.results, causes: causes.results, feeds: feeds.results });
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
    date: today, settings: settings.results, feedPrices: feedPrices.results,
    feedingRules: feedingRules.results, growthAssumptions: growth.results,
  });
});

// ---------- 池の状態 ----------
app.get('/api/ponds', async (c) => {
  const day = c.req.query('date') ?? todayJst();
  return c.json({ date: day, ponds: await getPondStates(c.env.DB, day) });
});

// ---------- 今日の記録(全池分をまとめて返す) ----------
app.get('/api/today', async (c) => {
  const day = c.req.query('date') ?? todayJst();
  if (!DATE_RE.test(day)) return bad(c, '日付の形式が正しくありません');
  const db = c.env.DB;
  const [ponds, feedings, water, deaths, logs] = await Promise.all([
    getPondStates(db, day),
    db.prepare(
      `SELECT id, pond_id, fed_at, amount_g, feed_price_per_kg_yen, appetite, leftover, note, created_by
       FROM feeding_events WHERE date = ?1 AND voided = 0 ORDER BY fed_at, id`,
    ).bind(day).all(),
    db.prepare(
      `SELECT id, pond_id, measured_at, slot, temp_c_x10, note, created_by
       FROM water_readings WHERE date = ?1 AND voided = 0 ORDER BY measured_at, id`,
    ).bind(day).all(),
    db.prepare(
      `SELECT e.id, e.pond_id, e.lot_id, l.code AS lot_code, -e.count_delta AS count, e.cause_id,
              mc.name AS cause_name, e.dead_weight_g, e.note, e.created_by
       FROM stock_events e JOIN lots l ON l.id = e.lot_id
       LEFT JOIN mortality_causes mc ON mc.id = e.cause_id
       WHERE e.date = ?1 AND e.type = 'mortality' AND e.voided = 0 ORDER BY e.id`,
    ).bind(day).all(),
    db.prepare(`SELECT * FROM daily_pond_logs WHERE date = ?1`).bind(day).all(),
  ]);
  return c.json({
    date: day, ponds, feedings: feedings.results, water: water.results,
    mortalities: deaths.results, dailyLogs: logs.results,
  });
});

// ---------- 導入記録の一覧 ----------
app.get('/api/intakes', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT e.id, e.date, e.lot_id, l.code AS lot_code, e.pond_id, p.name AS pond_name,
            e.count_delta AS count, e.avg_weight_g, e.created_by, e.created_at
     FROM stock_events e JOIN lots l ON l.id = e.lot_id JOIN ponds p ON p.id = e.pond_id
     WHERE e.type = 'intake' AND e.voided = 0 ORDER BY e.date DESC, e.id DESC LIMIT 50`,
  ).all();
  return c.json(r.results);
});

// ---------- 導入(池への投入) ----------
app.post('/api/intake', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const lotId = intOrNull(b.lot_id), pondId = intOrNull(b.pond_id);
  const count = intOrNull(b.count), avg = intOrNull(b.avg_weight_g);
  const day = String(b.date ?? '');
  if (!lotId || !pondId) return bad(c, 'ロットと池を選んでください');
  if (!DATE_RE.test(day)) return bad(c, '導入日を入れてください');
  if (!count || count <= 0) return bad(c, '匹数は1以上で入れてください');
  if (!avg || avg <= 0) return bad(c, '平均重量(g)を入れてください');
  const by = recorder(c);
  const db = c.env.DB;
  const row = await db.prepare(
    `INSERT INTO stock_events (date, lot_id, pond_id, type, count_delta, avg_weight_g, note, created_by)
     VALUES (?1, ?2, ?3, 'intake', ?4, ?5, ?6, ?7) RETURNING id`,
  ).bind(day, lotId, pondId, count, avg, b.note ? String(b.note) : null, by).first<{ id: number }>();
  await db.prepare(`UPDATE lots SET status = 'growing', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                    WHERE id = ?1 AND status = 'planned'`).bind(lotId).run();
  await logChange(db, 'stock_events', row!.id, 'insert', null, { type: 'intake', lotId, pondId, count, avg, day }, by);
  return c.json({ ok: true, id: row!.id });
});

// ---------- 給餌(1回=1行) ----------
app.post('/api/feedings', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const pondId = intOrNull(b.pond_id), amount = intOrNull(b.amount_g);
  const day = String(b.date ?? todayJst());
  const time = String(b.time ?? '');
  if (!pondId) return bad(c, '池を選んでください');
  if (!amount || amount <= 0) return bad(c, '給餌量(g)を入れてください');
  if (!DATE_RE.test(day)) return bad(c, '日付の形式が正しくありません');
  const fedAt = TIME_RE.test(time) ? `${day}T${time}:00+09:00`
    : day === todayJst() ? nowJstIso() : `${day}T12:00:00+09:00`;
  const db = c.env.DB;
  const feedId = intOrNull(b.feed_id) ?? (await db.prepare(`SELECT id FROM feeds WHERE active = 1 ORDER BY id LIMIT 1`).first<{ id: number }>())?.id;
  if (!feedId) return bad(c, '餌が登録されていません');
  const price = await feedPriceOn(db, feedId, day);
  if (price === null) return bad(c, 'この日付で有効な餌単価がありません');
  const appetite = ['good', 'normal', 'poor'].includes(String(b.appetite)) ? String(b.appetite) : null;
  const leftover = b.leftover === true || b.leftover === 1 ? 1 : b.leftover === false || b.leftover === 0 ? 0 : null;
  const by = recorder(c);
  await ensureDailySnapshot(db, day, pondId, by);
  const row = await db.prepare(
    `INSERT INTO feeding_events (fed_at, date, pond_id, feed_id, amount_g, feed_price_per_kg_yen, appetite, leftover, note, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
  ).bind(fedAt, day, pondId, feedId, amount, price, appetite, leftover, b.note ? String(b.note) : null, by)
    .first<{ id: number }>();
  await logChange(db, 'feeding_events', row!.id, 'insert', null, { pondId, fedAt, amount, price }, by);
  return c.json({ ok: true, id: row!.id });
});

// ---------- 水温 ----------
app.post('/api/water', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const pondId = intOrNull(b.pond_id);
  const temp = b.temp_c === '' || b.temp_c == null ? NaN : Number(b.temp_c);
  const slot = ['morning', 'evening', 'other'].includes(String(b.slot)) ? String(b.slot) : 'other';
  const day = String(b.date ?? todayJst());
  if (!pondId) return bad(c, '池を選んでください');
  if (!Number.isFinite(temp) || temp < -5 || temp > 40) return bad(c, '水温(℃)を正しく入れてください');
  if (!DATE_RE.test(day)) return bad(c, '日付の形式が正しくありません');
  const measuredAt = day === todayJst() ? nowJstIso()
    : `${day}T${slot === 'evening' ? '17' : slot === 'morning' ? '07' : '12'}:00:00+09:00`;
  const by = recorder(c);
  const db = c.env.DB;
  await ensureDailySnapshot(db, day, pondId, by);
  const row = await db.prepare(
    `INSERT INTO water_readings (pond_id, measured_at, date, slot, temp_c_x10, note, created_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
  ).bind(pondId, measuredAt, day, slot, Math.round(temp * 10), b.note ? String(b.note) : null, by)
    .first<{ id: number }>();
  await logChange(db, 'water_readings', row!.id, 'insert', null, { pondId, slot, temp, day }, by);
  return c.json({ ok: true, id: row!.id });
});

// ---------- 死亡 ----------
app.post('/api/mortality', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const pondId = intOrNull(b.pond_id), count = intOrNull(b.count);
  const day = String(b.date ?? todayJst());
  if (!pondId) return bad(c, '池を選んでください');
  if (!count || count <= 0) return bad(c, '死亡数は1以上で入れてください');
  if (!DATE_RE.test(day)) return bad(c, '日付の形式が正しくありません');
  const db = c.env.DB;
  let lotId = intOrNull(b.lot_id);
  const state = (await getPondStates(db, day)).find((p) => p.id === pondId);
  if (!lotId) {
    if (!state || state.lots.length === 0) return bad(c, 'この池には魚がいません');
    if (state.lots.length > 1) return bad(c, 'この池には複数のロットがいます。ロットを選んでください');
    lotId = state.lots[0].lotId;
  }
  const current = state?.lots.find((l) => l.lotId === lotId)?.count ?? 0;
  if (count > current) return bad(c, `死亡数が現在の匹数(${current}匹)を超えています`);
  const by = recorder(c);
  await ensureDailySnapshot(db, day, pondId, by);
  const row = await db.prepare(
    `INSERT INTO stock_events (date, lot_id, pond_id, type, count_delta, cause_id, dead_weight_g, note, created_by)
     VALUES (?1, ?2, ?3, 'mortality', ?4, ?5, ?6, ?7, ?8) RETURNING id`,
  ).bind(day, lotId, pondId, -count, intOrNull(b.cause_id), intOrNull(b.dead_weight_g),
         b.note ? String(b.note) : null, by).first<{ id: number }>();
  await logChange(db, 'stock_events', row!.id, 'insert', null, { type: 'mortality', pondId, lotId, count, day }, by);
  return c.json({ ok: true, id: row!.id });
});

// ---------- 日次記録(摂餌・残餌・備考) ----------
app.put('/api/daily-log', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const pondId = intOrNull(b.pond_id);
  const day = String(b.date ?? todayJst());
  if (!pondId) return bad(c, '池を選んでください');
  if (!DATE_RE.test(day)) return bad(c, '日付の形式が正しくありません');
  const db = c.env.DB;
  const by = recorder(c);
  await ensureDailySnapshot(db, day, pondId, by);
  const before = await db.prepare(`SELECT * FROM daily_pond_logs WHERE date = ?1 AND pond_id = ?2`).bind(day, pondId).first<{ id: number }>();
  const appetite = 'appetite' in b ? (['good', 'normal', 'poor'].includes(String(b.appetite)) ? String(b.appetite) : null) : undefined;
  const leftover = 'leftover' in b ? (b.leftover === true || b.leftover === 1 ? 1 : b.leftover === false || b.leftover === 0 ? 0 : null) : undefined;
  const note = 'note' in b ? (b.note ? String(b.note) : null) : undefined;
  await db.prepare(
    `UPDATE daily_pond_logs SET
       appetite = CASE WHEN ?3 THEN ?4 ELSE appetite END,
       leftover = CASE WHEN ?5 THEN ?6 ELSE leftover END,
       note     = CASE WHEN ?7 THEN ?8 ELSE note END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE date = ?1 AND pond_id = ?2`,
  ).bind(day, pondId, appetite !== undefined ? 1 : 0, appetite ?? null,
         leftover !== undefined ? 1 : 0, leftover ?? null, note !== undefined ? 1 : 0, note ?? null).run();
  const after = await db.prepare(`SELECT * FROM daily_pond_logs WHERE date = ?1 AND pond_id = ?2`).bind(day, pondId).first<{ id: number }>();
  if (after) await logChange(db, 'daily_pond_logs', after.id, 'update', before, after, by);
  return c.json({ ok: true });
});

// ---------- 取消(物理削除はしない) ----------
const VOIDABLE = ['feeding_events', 'water_readings', 'stock_events', 'samplings'] as const;
app.post('/api/void', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const table = String(b.table ?? '');
  const id = intOrNull(b.id);
  if (!(VOIDABLE as readonly string[]).includes(table) || !id) return bad(c, '取消できない記録です');
  const db = c.env.DB;
  const before = await db.prepare(`SELECT * FROM ${table} WHERE id = ?1`).bind(id).first<{ voided: number }>();
  if (!before) return c.json({ error: '記録が見つかりません' }, 404);
  if (before.voided) return c.json({ ok: true });
  const reason = b.reason ? String(b.reason).slice(0, 200) : '入力ミス';
  const hasReason = table !== 'water_readings';
  await db.prepare(
    hasReason
      ? `UPDATE ${table} SET voided = 1, voided_reason = ?2 WHERE id = ?1`
      : `UPDATE ${table} SET voided = 1 WHERE id = ?1`,
  ).bind(...(hasReason ? [id, reason] : [id])).run();
  await logChange(db, table, id, 'void', before, { voided: 1, reason }, recorder(c));
  return c.json({ ok: true });
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not found' }, 404) : c.text('Not found', 404)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'サーバーでエラーが発生しました' }, 500);
});

export default app;
