# スマブラtier表（smash-rank）

GitHub Pages で公開している、スマブラSPの全キャラ（と各キャラの技）を2択で比べてtier表を作るオンラインツール（非公式）。直下の `index.html` が公開版（1ファイルで完結）。
ソースは `dev/`：`src/`（chars.js=キャラ一覧、rank.js=順位計算・技の枠・部屋の状態（モードごとの記録 boards）、net.js=MQTT通信、main.js=画面、style.css）。
- ビルド：`cd dev && npm install && node scripts/build.mjs` → `dev/dist/index.html` を直下の `index.html` にコピーして公開。
- テスト：`node tests/rank.test.mjs`、`node tests/e2e.mjs`（ローカルのMQTT中継でスマホ3台を再現）。

## 段位スキャナー（gsp/）
- `gsp/`：世界戦闘力をカメラ／スクショで読み取り、クマメイトツールの「世界戦闘力段位」で全キャラの段位を一覧にする機能（公開版。`vendor/` は読み取り用の Tesseract.js、`border.json` は毎日自動更新）。タイトル画面の「段位スキャナー」から入る。
- ソースは `dev/gsp/`（src: chars.js, tiers.js=段位指数と判定, ocr.js, main.js, style.css）。ビルド：`cd dev/gsp && npm install && node scripts/build.mjs` → `dev/gsp/dist/` の中身を `gsp/` にコピー（`gsp/border.json` は残す）。
- テスト：`node tests/e2e.mjs`（擬似カメラ映像で連続読み取り）、`node tests/e2e-real.mjs`（手元に置いた実機のテレビ写真 tests/fixture-bayo.jpg ※個人情報が写るのでコミットしない をカメラ映像にして、右下3つの数字のいちばん上を読めるか）、`node tests/import.mjs`（スクショ読み込み）。
- 読み取り：枠の中の1行を、白黒の作り方を変えた数枚で読んで多数決（ocr.js readVote）。2票そろわなければ登録しない。スクショは一番上にある数字を選ぶ。
- `.github/workflows/border.yml`：毎日 `dev/gsp/scripts/update-border.mjs` でクマメイトのVIPボーダー推定値を `gsp/border.json` に書く。
