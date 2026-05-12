# nogdigi

`https://ebidigi.github.io/seika-hoshu-db/` を野口専用にフォークしたローカル運用版。
ebidigi の本番Tursoには**一切影響しない**完全独立アーキテクチャ。

## 起動

```bash
cd /Users/user/projects/nogdigi
python3 -m http.server 8766
# → http://localhost:8766
```

または Claude Code で `/nogdigi` でも呼び出し可能。

## アーキテクチャ

```
data/snapshot.sqlite  (ebidigi Turso 全データのスナップショット)
       │
       │ 起動時に sql.js (WASM SQLite) でブラウザ内ロード
       ▼
ブラウザ内 in-memory SQLite
       ↑↓ writes
IndexedDB (writes object store)  ← 編集はここに永続化、起動時にリプレイ
```

| レイヤー | 技術 |
|---------|------|
| UI | Vanilla HTML/CSS/JS（フレームワークなし） |
| データ | sql.js@1.10.3（SQLite WASM） |
| 永続化 | IndexedDB |
| グラフ | Chart.js + chartjs-plugin-datalabels |
| スナップショット同期 | `scripts/dump_turso.py`（ebidigi Tursoから読み取りのみ） |

## ファイル構成

```
nogdigi/
├── index.html              # SPA本体
├── app.js                  # フロントロジック (~225KB)
├── style.css               # スタイル
├── db.js                   # sql.js + IndexedDB シム（queryTurso/executeTurso 提供）
├── data/
│   └── snapshot.sqlite     # ebidigi Tursoの全テーブルダンプ（1.1MB）
├── scripts/
│   └── dump_turso.py       # スナップショット再生成スクリプト
├── README.md               # 本ファイル
└── README.md.original      # 元プロジェクトREADMEの保存
```

## 主な変更点（ebidigi版との差分）

- **データ層**: Turso HTTP → sql.js + IndexedDB
- **書き込み**: ebidigi本番への書き込みを排除、すべてローカルIndexedDBに
- **メンバー追加バグ修正**: 既存inactiveメンバーがいる場合は再有効化UPDATE
- **チーム管理UI追加**: 追加・編集・無効化・削除（ebidigi版にはなかった）
- **メンバー削除機能追加**
- **設定画面に「ローカルデータ操作」追加**（SQLiteエクスポート / 編集破棄）

## スナップショット更新

ebidigi本番のデータが進んだら：

```bash
python3 scripts/dump_turso.py
git add data/snapshot.sqlite
git commit -m "snapshot 更新"
```

⚠️ スナップショット更新後はIndexedDBに溜まっている編集が衝突する可能性があります。
必要なら設定タブの「ローカル編集を全破棄」でリセット推奨。

## SQLite直接編集

```bash
sqlite3 data/snapshot.sqlite
sqlite> SELECT * FROM members;
```

## 関連プロジェクト

- 元プロジェクト: https://github.com/ebidigi/seika-hoshu-db
- 別プロジェクト: `/Users/user/projects/seika-tracker/`（営業代行8名・localStorage版）
