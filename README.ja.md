<img src="assets/icon.svg" width="96" height="96" alt="">

# True Scale Solar System

[English](README.md) | [简体中文](README.zh-CN.md) | **日本語**

実寸スケール・リアルタイム天体暦の太陽系シミュレーター（ブラウザのみで動作、three.js）。

- 惑星の位置：JPL の近似ケプラー軌道要素（1800〜2050 年で最も高精度）。月：主要な摂動項を含む月理論（誤差 約 1〜2′）
- 視点：宇宙空間から周回、または地球・月・火星の地表に立つ。実際の視直径、望遠鏡ズーム
- 時間：実時間から 1 秒あたり 1 年まで、逆再生、任意の日付へジャンプ、次の日食・月食を自動検索
- ミッション：地球–月遷移（パッチド・コニック法）、火星・金星・木星への遷移（ランベルト問題ソルバー + 打ち上げウィンドウ Δv 図）。すべて時間の解析関数なので、自由に早送り・巻き戻しが可能
- 国際宇宙ステーション：実際の TLE 軌道（J2 歳差と大気抵抗項を含む）、手続き生成モデル（太陽電池パドルが自動で太陽を追尾）、追従視点、キューポラ窓からの視点、地上から「ISS を待つ」可視通過予報
- 光速デモ：任意の天体から光を放ち、他の惑星に届くまでの時間を確認
- インターフェース：既定では画面・時計・タイムバーのみ表示。左のナビゲーションから視点／天体／ミッションのパネルを開き、右のツールバーにラベル・軌道・星座の切り替え、没入モード（I キー、Esc で終了）、設定（言語・ショートカット・クレジット）を常設
- 言語：アプリの UI は中国語と英語に対応（日本語 UI は未対応）。既定ではブラウザの言語に従い（変更時は自動で切り替え）、左上で手動選択も可能。UI の文字列は `tr(中文, English)` のペアで記述（`tr` は `js/i18n.js` で定義）、切り替えに再読み込みは不要

## 実行方法

`index.html` をダブルクリックするか、次を実行：

```sh
python3 -m http.server 8765   # その後 http://localhost:8765 を開く
```

ディープリンク：`#onEarth` `#onMoon` `#onMars` `#inner` `#outer` `#saturnBack` `#eclipse-solar` `#eclipse-lunar` `#mission-moon` `#mission-mars` `#cockpit-moon`（月探査ミッションを打ち上げてコックピット視点に入る） `#iss` `#cupola`

## ディレクトリ構成

- `js/i18n.js` 言語の検出と切り替え
- `js/iss.js` ISS の軌道・通過予報・モデル（軌道を更新するにはファイル先頭の `ISS_TLE` を置き換える。celestrak.org から取得可能）
- `js/astro.js` 天体暦、天体データ、日食・月食の検索
- `js/missions.js` 軌道力学（普遍変数によるケプラー伝播、ランベルト問題、ミッション設計）
- `js/tiles.js` カメラが地球に近づくと、周囲の衛星画像を NASA GIBS から逐次読み込む（Blue Marble、VIIRS 夜間光、海陸マスク）。オフラインでは内蔵テクスチャに戻る
- `js/scene.js` レンダリング（浮動原点 + 対数深度バッファで、メートルから天文単位までの実寸スケールを実現）
- `js/app.js` カメラ、時間、UI
- `assets/` パック済みのテクスチャと星表（`tools/build_data.py` により `tex_src/` から生成）

テクスチャ © Solar System Scope、CC BY 4.0。地球の近景画像は NASA GIBS（Blue Marble Next Generation、VIIRS Black Marble）と OpenStreetMap の海陸データ（© OpenStreetMap contributors、ODbL）より。星表と星座線は d3-celestial（BSD-3）より。
