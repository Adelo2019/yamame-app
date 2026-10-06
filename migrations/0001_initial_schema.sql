-- ヤマメ養殖管理アプリ 初期スキーマ
-- 単位ルール: 重量=g(整数) / 金額=円(整数) / 匹数=匹(整数)
--   給餌率・成長率 = bp(1bp = 0.01%) 例: 1%/日 = 100, 0.91%/日 = 91
--   水温・DO = 実数×10 の整数 例: 12.3℃ = 123
-- 日付 = 'YYYY-MM-DD'(日本時間) / 日時 = 'YYYY-MM-DDTHH:MM:SS+09:00'
-- 「現在匹数・平均重量・総重量・使用率」は保存しない。すべて履歴から計算する。

PRAGMA foreign_keys = ON;

-- ========== マスター ==========

CREATE TABLE sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  water_type  TEXT NOT NULL CHECK (water_type IN ('freshwater','seawater')),
  active      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE ponds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL REFERENCES sites(id),
  code        TEXT NOT NULL UNIQUE,          -- 例: P01
  name        TEXT NOT NULL,                 -- 例: 小型池1
  capacity_g  INTEGER NOT NULL,              -- 最大収容魚体重量(g)
  volume_l    INTEGER,                       -- 水量(L) 任意
  depth_cm    INTEGER,                       -- 水深(cm) 任意
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 収容上限の変更履歴(実運用で見直すため)
CREATE TABLE pond_capacity_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pond_id         INTEGER NOT NULL REFERENCES ponds(id),
  capacity_g      INTEGER NOT NULL,
  effective_from  TEXT NOT NULL,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE species (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  contact     TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  contact     TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE feeds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  bag_size_g  INTEGER,
  active      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 餌単価(日付で有効な単価を引く)
CREATE TABLE feed_prices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id           INTEGER NOT NULL REFERENCES feeds(id),
  price_per_kg_yen  INTEGER NOT NULL,
  effective_from    TEXT NOT NULL,
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 給餌率ルール(魚種・ステージ・サイズ帯ごと。pond_idを入れると池別の個別設定)
CREATE TABLE feeding_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id      INTEGER NOT NULL REFERENCES species(id),
  stage           TEXT NOT NULL CHECK (stage IN ('freshwater','seawater')),
  min_weight_g    INTEGER,               -- NULL = 下限なし
  max_weight_g    INTEGER,               -- NULL = 上限なし
  pond_id         INTEGER REFERENCES ponds(id),  -- NULL = 全池共通
  rate_bp         INTEGER NOT NULL,      -- 1%/日 = 100
  effective_from  TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 仮の成長率(実測が足りないときの推定平均重量に使う)
CREATE TABLE growth_assumptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id      INTEGER NOT NULL REFERENCES species(id),
  stage           TEXT NOT NULL CHECK (stage IN ('freshwater','seawater')),
  min_weight_g    INTEGER,
  max_weight_g    INTEGER,
  sgr_bp          INTEGER NOT NULL,      -- 0.91%/日 = 91
  effective_from  TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 汎用設定(目標サイズ、警告閾値など)
CREATE TABLE settings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (key, effective_from)
);

CREATE TABLE mortality_causes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ========== トランザクション ==========

CREATE TABLE lots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,     -- 例: A-20261016
  name             TEXT,
  species_id       INTEGER NOT NULL REFERENCES species(id),
  source_type      TEXT NOT NULL CHECK (source_type IN ('A','B','C')),
  parent_lot_id    INTEGER REFERENCES lots(id),   -- 選別・分割の親
  purchase_date    TEXT,
  purchase_count   INTEGER,
  purchase_avg_g   INTEGER,                  -- 仕入時平均重量(g)
  unit_price_yen   INTEGER,                  -- 仕入単価(円/匹, 卵なら円/卵)
  total_price_yen  INTEGER,                  -- 仕入総額(円)
  subsidized       INTEGER NOT NULL DEFAULT 0,  -- 補助金対象なら1(原価計算は通常どおり)
  supplier_id      INTEGER REFERENCES suppliers(id),
  status           TEXT NOT NULL DEFAULT 'growing'
                   CHECK (status IN ('planned','growing','shipping','closed')),
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by       TEXT
);

-- 出荷(匹数の増減は stock_events の 'shipment' 行で記録)
CREATE TABLE shipments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  product         TEXT NOT NULL,           -- 鮮魚/干物/サクラマス 等
  count           INTEGER,
  total_g         INTEGER,
  unit_price_yen  INTEGER,
  price_unit      TEXT CHECK (price_unit IN ('per_fish','per_kg')),
  amount_yen      INTEGER,
  note            TEXT,
  voided          INTEGER NOT NULL DEFAULT 0,
  voided_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by      TEXT
);

-- 匹数イベント: 現在匹数 = count_delta の合計(voided=0のみ)
CREATE TABLE stock_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  date               TEXT NOT NULL,
  lot_id             INTEGER NOT NULL REFERENCES lots(id),
  pond_id            INTEGER NOT NULL REFERENCES ponds(id),
  type               TEXT NOT NULL CHECK (type IN
                     ('intake','mortality','transfer_out','transfer_in','shipment','adjustment')),
  count_delta        INTEGER NOT NULL,     -- 増=+ / 減=-
  avg_weight_g       INTEGER,              -- 導入・移動・出荷時の平均重量
  transfer_group_id  TEXT,                 -- 移動の出/入を結ぶID
  cause_id           INTEGER REFERENCES mortality_causes(id),
  dead_weight_g      INTEGER,              -- 死亡魚の合計重量(任意, FCR用)
  shipment_id        INTEGER REFERENCES shipments(id),
  note               TEXT,
  voided             INTEGER NOT NULL DEFAULT 0,
  voided_reason      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by         TEXT
);
CREATE INDEX idx_stock_events_lot_pond ON stock_events (lot_id, pond_id, date);
CREATE INDEX idx_stock_events_pond_date ON stock_events (pond_id, date);

-- 給餌イベント: 1回の給餌 = 1行。日次の実給餌量・回数はこの合計と件数
CREATE TABLE feeding_events (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  fed_at                 TEXT NOT NULL,      -- 給餌日時
  date                   TEXT NOT NULL,      -- 集計用の日付(日本時間)
  pond_id                INTEGER NOT NULL REFERENCES ponds(id),
  feed_id                INTEGER REFERENCES feeds(id),
  amount_g               INTEGER NOT NULL,
  feed_price_per_kg_yen  INTEGER NOT NULL,   -- 給餌時点の単価(スナップショット)
  appetite               TEXT CHECK (appetite IN ('good','normal','poor')),
  leftover               INTEGER CHECK (leftover IN (0,1)),
  note                   TEXT,
  voided                 INTEGER NOT NULL DEFAULT 0,
  voided_reason          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by             TEXT
);
CREATE INDEX idx_feeding_events_pond_date ON feeding_events (pond_id, date);

-- 日次記録: 池×日に1行。日単位の状態・評価・備考と、推奨量の根拠
CREATE TABLE daily_pond_logs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  date                 TEXT NOT NULL,
  pond_id              INTEGER NOT NULL REFERENCES ponds(id),
  recommended_feed_g   INTEGER,              -- その日の推奨給餌量(スナップショット)
  rate_bp_used         INTEGER,              -- 計算に使った給餌率
  biomass_g_at_calc    INTEGER,              -- 計算に使った推定総重量
  weight_source        TEXT CHECK (weight_source IN ('measured','estimated','intake')),
  appetite             TEXT CHECK (appetite IN ('good','normal','poor')),
  leftover             INTEGER CHECK (leftover IN (0,1)),
  note                 TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by           TEXT,
  UNIQUE (date, pond_id)
);

-- 水質: 1測定 = 1行(DO・注水量も後から同じ表に入れられる)
CREATE TABLE water_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pond_id      INTEGER NOT NULL REFERENCES ponds(id),
  measured_at  TEXT NOT NULL,
  date         TEXT NOT NULL,
  slot         TEXT NOT NULL DEFAULT 'other' CHECK (slot IN ('morning','evening','other')),
  temp_c_x10   INTEGER,          -- 12.3℃ = 123
  do_mg_l_x10  INTEGER,          -- 溶存酸素 9.8mg/L = 98
  flow_l_min   INTEGER,          -- 注水量 L/分
  note         TEXT,
  voided       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by   TEXT
);
CREATE INDEX idx_water_readings_pond_date ON water_readings (pond_id, date);

-- 成長測定(平均 = sample_total_g / sample_count で計算。保存しない)
CREATE TABLE samplings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,
  pond_id         INTEGER NOT NULL REFERENCES ponds(id),
  lot_id          INTEGER NOT NULL REFERENCES lots(id),
  sample_count    INTEGER NOT NULL CHECK (sample_count > 0),
  sample_total_g  INTEGER NOT NULL CHECK (sample_total_g > 0),
  fasted          INTEGER NOT NULL DEFAULT 1,   -- 給餌前に測ったか
  note            TEXT,
  voided          INTEGER NOT NULL DEFAULT 0,
  voided_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by      TEXT
);
CREATE INDEX idx_samplings_lot_pond ON samplings (lot_id, pond_id, date);

CREATE TABLE sample_fish (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sampling_id  INTEGER NOT NULL REFERENCES samplings(id),
  weight_g_x10 INTEGER NOT NULL,   -- 52.4g = 524
  length_mm    INTEGER
);

-- その他原価(加工・包装・運搬・薬品など。将来の固定費配賦にも使う)
CREATE TABLE cost_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  lot_id      INTEGER REFERENCES lots(id),
  pond_id     INTEGER REFERENCES ponds(id),
  category    TEXT NOT NULL,
  amount_yen  INTEGER NOT NULL,
  note        TEXT,
  voided      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_by  TEXT
);

-- 変更履歴(修正・取消の証跡)
CREATE TABLE change_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name   TEXT NOT NULL,
  record_id    INTEGER NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('insert','update','void')),
  before_json  TEXT,
  after_json   TEXT,
  changed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  changed_by   TEXT
);
