# スマブラtier表（smash-rank）

GitHub Pages で公開している、スマブラSPの全キャラ（と各キャラの技）を2択で比べてtier表を作るオンラインツール（非公式）。直下の `index.html` が公開版（1ファイルで完結）。
ソースは `dev/`：`src/`（chars.js=キャラ一覧、rank.js=順位計算・技の枠・部屋の状態（モードごとの記録 boards）、net.js=MQTT通信、main.js=画面、style.css）。
- ビルド：`cd dev && npm install && node scripts/build.mjs` → `dev/dist/index.html` を直下の `index.html` にコピーして公開。
- テスト：`node tests/rank.test.mjs`、`node tests/e2e.mjs`（ローカルのMQTT中継でスマホ3台を再現）。
