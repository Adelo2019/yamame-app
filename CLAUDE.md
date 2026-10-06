# ヤマメ養殖管理アプリ — Claude Code 向けルール

株式会社Adeloのヤマメ・サクラマス養殖を管理する社内Webアプリ。現場ではスマホで使う。
オーナー(佐々木)はエンジニアではないため、変更内容は日本語で平易に説明すること。

## 構成
- 画面: React + Vite + Tailwind CSS（`src/react-app/`）
- API: Hono on Cloudflare Workers（`src/worker/index.ts`）
- 計算: 純粋関数（`src/worker/calc.ts`、テストは `calc.test.ts`、`npm test`）
- DB: Cloudflare D1（SQLite）。スキーマは `migrations/` の SQL ファイルが正
- デプロイ: GitHub の main に push → Cloudflare が `npm run deploy` を実行（マイグレーション適用→デプロイ）

## 絶対に守る設計ルール
1. **現在値を保存しない。** 現在匹数・平均重量・総重量・使用率・原価は、履歴（stock_events, samplings, feeding_events など）から毎回計算する。
2. **匹数の増減はすべて stock_events。** 導入/死亡/移動出/移動入/出荷/調整。移動は出と入の2行を transfer_group_id で結ぶ。
3. **給餌は1回＝1行（feeding_events）。** 日次の実給餌量・回数は合計と件数で出す。daily_pond_logs は日単位の評価・備考と推奨量の根拠。
4. **設定値をハードコードしない。** 給餌率・餌単価・目標サイズ・閾値は feeding_rules / feed_prices / settings / growth_assumptions から、日付で有効な値を引く。
5. **記録時の値をスナップショット保存。** 給餌時の餌単価、推奨量計算に使った給餌率と総重量を記録に残す。
6. **物理削除しない。** voided=1 と voided_reason で取消し、変更は change_log に残す。
7. **単位は整数。** 重量 g、金額 円、率 bp（1%=100）、水温・DO は ×10。
8. **実測と推定を区別。** 平均重量は「実測（成長測定/導入時）」と「推定（成長率から計算）」を分け、画面でも明示する。
9. **既存のマイグレーションファイルは書き換えない。** スキーマ変更は新しい番号のファイルを追加する（例: `0003_xxx.sql`）。

## よく使うコマンド
- `npm run dev` … ローカルで起動
- `npm run db:migrate:local` … ローカルDBにマイグレーション適用
- `npm test` … 計算ロジックのテスト
