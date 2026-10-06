-- 初期マスターデータ(2026-10-06時点の前提)
-- 数字が変わったら、この行を書き換えるのではなく、アプリの設定画面(または新しいマイグレーション)で
-- 「新しい effective_from の行」を追加する。過去の計算結果を変えないため。

INSERT INTO sites (id, name, water_type, note) VALUES
  (1, '池群1', 'freshwater', '100kg×5、300kg×1、600kg×2 = 合計2,000kg'),
  (2, '池群2', 'freshwater', '25m×15m程度×3池。収容力は実測待ち'),
  (3, '海面',  'seawater',   'サクラマス用。設備は未定');
UPDATE sites SET active = 0 WHERE id IN (2, 3);

INSERT INTO ponds (site_id, code, name, capacity_g, sort_order) VALUES
  (1, 'P01', '小型池1', 100000, 1),
  (1, 'P02', '小型池2', 100000, 2),
  (1, 'P03', '小型池3', 100000, 3),
  (1, 'P04', '小型池4', 100000, 4),
  (1, 'P05', '小型池5', 100000, 5),
  (1, 'P06', '中型池',  300000, 6),
  (1, 'P07', '大型池1', 600000, 7),
  (1, 'P08', '大型池2', 600000, 8);

INSERT INTO pond_capacity_history (pond_id, capacity_g, effective_from, reason)
  SELECT id, capacity_g, '2026-10-01', '初期値(実運用で検証予定)' FROM ponds;

INSERT INTO species (id, name) VALUES (1, 'ヤマメ'), (2, 'サクラマス');

INSERT INTO feeds (id, name, bag_size_g, note) VALUES
  (1, '標準飼料(銘柄未登録)', 20000, '20kg/袋 11,000円(税込)');

INSERT INTO feed_prices (feed_id, price_per_kg_yen, effective_from, note) VALUES
  (1, 550, '2026-10-01', '11,000円 ÷ 20kg');

-- 【現在の運用基準】ヤマメ淡水: 魚体総重量の1%/日
INSERT INTO feeding_rules (species_id, stage, rate_bp, effective_from, note) VALUES
  (1, 'freshwater', 100, '2026-10-01', '現行運用基準');
-- 【事業仮説】サクラマス海水: 2%弱/日(未実証。海面開始時に見直す)
INSERT INTO feeding_rules (species_id, stage, rate_bp, effective_from, note) VALUES
  (2, 'seawater', 190, '2026-10-01', '事業仮説・未実証');

-- 【事業仮説】50g→60日で82〜91g(中央86.5g) ≒ 0.91%/日
INSERT INTO growth_assumptions (species_id, stage, sgr_bp, effective_from, note) VALUES
  (1, 'freshwater', 91, '2026-10-01', '50g→60日で82〜91gの中央値から算出。実測2回以降は実測値を優先');

INSERT INTO settings (key, value, effective_from, note) VALUES
  ('target_weight_g',        '100', '2026-10-01', '到達予測の主表示'),
  ('target_weight_g_upper',  '110', '2026-10-01', '到達予測の参考表示'),
  ('yamame_price_per_fish',  '350', '2026-10-01', 'ヤマメ100〜120gの基準単価(円/匹)'),
  ('capacity_warn_pct',      '80',  '2026-10-01', '池使用率の注意'),
  ('capacity_alert_pct',     '90',  '2026-10-01', '池使用率の警告'),
  ('sampling_stale_days',    '14',  '2026-10-01', '前回測定からこの日数を超えたら注意表示');

INSERT INTO mortality_causes (name, sort_order) VALUES
  ('原因不明', 1), ('輸送ストレス', 2), ('病気', 3), ('鳥害', 4), ('酸欠', 5), ('その他', 9);

-- 初回ロット(池への導入=stock_eventsの 'intake' は、初期配置が決まってから画面で登録する)
INSERT INTO lots (code, name, species_id, source_type, purchase_date, purchase_count,
                  purchase_avg_g, unit_price_yen, total_price_yen, subsidized, status, note)
VALUES ('A-20261016', 'ヤマメA 初回実証ロット', 1, 'A', '2026-10-16', 4000,
        50, 165, 660000, 1, 'planned',
        '魚代は補助金対象。原価計算は通常どおり165円/匹で行う');
