# Aqua — 3D アクアリウム

実在の熱帯魚が群れで泳ぐ、待ち受け向けの 3D アクアリウム。水草レイアウト水槽（淡水）とサンゴ礁水槽（海水）を右下のボタンで切り替えられる。

## Purpose

ブラウザを開くだけで、ずっと眺めていられる美しい水槽を楽しめるようにする。

## Target User

作業中や休憩中に、PC やスマホの画面で癒やしの映像を流しておきたい人。

## Problem

アクアリウムの映像は動画のループが多く、同じ場面の繰り返しになりがち。

## MVP

- 淡水の水草レイアウト水槽と海水のサンゴ礁水槽の切り替え
- 実在の熱帯魚 25 種が群れで泳ぐ（毎回違う動き）
- 水面から差し込む光の柱、水底で揺れる光の網目、色ごとの光の吸収による透明な水
- 横長・縦長の両方に最適化、全画面表示

## Domain

（公開時に決定）

## Tech Stack

- Three.js（WebGL）／ Vite
- 画像・3D モデルの外部アセットなし（すべてコードで生成）

- 技術: Three.js（WebGL）＋ Vite。画像・3D モデルの外部アセットは使わず、魚・水草・石・サンゴはすべてコードで生成
- 表示: PC の横長画面とスマホの縦長画面の両方に最適化。重い端末では解像度を自動で下げる
- 操作: 右下のボタン（しばらく操作しないと自動で消える）で水槽の切替と全画面表示。`?mode=marine` で海水から開始

## 登場する魚（すべて実在種）

| 淡水 | 海水 |
| --- | --- |
| カージナルテトラ *Paracheirodon axelrodi* | カクレクマノミ *Amphiprion ocellaris* |
| ラミーノーズテトラ *Hemigrammus bleheri* | ナンヨウハギ *Paracanthurus hepatus* |
| エンバーテトラ *Hyphessobrycon amandae* | キイロハギ *Zebrasoma flavescens* |
| ラスボラ・ヘテロモルファ *Trigonostigma heteromorpha* | デバスズメダイ *Chromis viridis* |
| エンゼルフィッシュ *Pterophyllum scalare* | キンギョハナダイ *Pseudanthias squamipinnis* |
| ディスカス *Symphysodon aequifasciatus* | ロイヤルグラマ *Gramma loreto* |
| ベタ *Betta splendens* | ツノダシ *Zanclus cornutus* |
| グッピー（2品種）*Poecilia reticulata* | ハシナガチョウチョウウオ *Chelmon rostratus* |
| ジャーマン・ブルーラム *Mikrogeophagus ramirezi* | フレームエンゼル *Centropyge loricula* |
| ドワーフグラミー *Trichogaster lalius* | ニシキテグリ *Synchiropus splendidus* |
| コリドラス・パンダ *Corydoras panda* | タテジマキンチャクダイ *Pomacanthus imperator* |
| | ハタタテハゼ *Nemateleotris magnifica* |
| | アマノガワテンジクダイ *Pterapogon kauderni* |

## 開発

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # dist/ に静的ファイルを出力
```

## 構成

- `src/main.js` — レンダラー、カメラ構図、ポストエフェクト、水槽切替
- `src/scenes/` — 淡水（石組み＋流木＋水草）と海水（ライブロック＋サンゴ）のレイアウト
- `src/fish/` — 魚の形状生成・体色ペイント・泳ぎのシェーダー・群れの動き（ボイド）
- `src/env.js` — 背景、水面、光の筋、浮遊物、泡、底床
- `src/hardscape.js` / `src/plants.js` / `src/reef.js` — 石・流木、水草、サンゴ類の生成
- `src/shared.js` — コースティクス（水底の光の揺らめき）と水流による揺れのシェーダー

## Roadmap

- [ ] 公開（Cloudflare Pages）
- [ ] 魚をタップすると名前が出るモード（任意で ON）
- [ ] 岩や水草が光を遮って、光の柱に影の筋ができる表現
- [ ] 水草の量を端末性能に合わせて自動調整

## Status

公開準備中（labs）
