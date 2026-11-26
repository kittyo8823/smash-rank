# スマブラtier表（smash-rank）

GitHub Pages で公開している、スマブラSPの全キャラ（と各キャラの技）を2択で比べてtier表を作るオンラインツール（非公式）。直下の `index.html` が公開版（1ファイルで完結）。
ソースは `dev/`：`src/`（chars.js=キャラ一覧、rank.js=順位計算・技の枠・部屋の状態（モードごとの記録 boards）、net.js=MQTT通信、main.js=画面、style.css）。
- ビルド：`cd dev && npm install && node scripts/build.mjs` → `dev/dist/index.html` を直下の `index.html` にコピーして公開。
- テスト：`node tests/rank.test.mjs`、`node tests/e2e.mjs`（ローカルのMQTT中継でスマホ3台を再現）。

## 段位スキャナー（gsp/）
- `gsp/`：世界戦闘力をカメラ／スクショで読み取り、クマメイトツールの「世界戦闘力段位」で全キャラの段位を一覧にする機能（公開版。`vendor/` は読み取り用の Tesseract.js、`border.json` は毎日自動更新）。タイトル画面の「段位スキャナー」から入る。
- ソースは `dev/gsp/`（src: chars.js, tiers.js=段位指数と判定, ocr.js, main.js, style.css）。ビルド：`cd dev/gsp && npm install && node scripts/build.mjs` → `dev/gsp/dist/` の中身を `gsp/` にコピー（`gsp/border.json` は残す）。
- テスト：`node tests/e2e.mjs`（擬似カメラ映像で連続読み取り）、`node tests/e2e-real.mjs`（手元に置いた実機のテレビ写真 tests/fixture-bayo.jpg ※個人情報が写るのでコミットしない をカメラ映像にして、右下3つの数字のいちばん上を読めるか）、`node tests/import.mjs`（スクショ読み込み）。
- 読み取り：枠の中の1行を、白黒の作り方を変えた数枚で読んで多数決（ocr.js readVote）。2票そろわなければ登録しない。数字が枠の端にかかっていたら読まない。スクショは一番上にある数字を選ぶ。
- キャラの自動判定（icons.js）：数字の左のアイコンを12×12に縮めて明るさをそろえた特徴（src/icon-protos.json、絵ではなく数字だけ）と比べる。数字の位置は白黒画像のインクのかたまりから取り（ocr.js inkBox）、アイコンは数字の右端から 11.6×高さ 左。自信がなければ「このキャラは？」と聞く（誤登録を避ける）。順番モードにも切り替えられる。
- icon-protos.json は利用者が撮った動画（全86キャラ、手元のみ・コミットしない）から作った。作り直す手順はリポジトリ外の作業用スクリプト。
- キャラ判定は「ほかのキャラに似やすさ」を差し引いた z 値で決める（src/icon-stats.json：各キャラの、ほかのキャラのアイコンとの似ている度の平均とばらつき。学習コマ224枚で誤判定0になる基準 z≥3・差≥1）。
- 動画からまとめて読む（video.js）：最初に1コマで数字の枠を合わせる → 1回目は動画を再生しながら数字とアイコンのあたりの小さな白黒サムネイルで「止まっている区間」を集めてキャラの区切りにする → 2回目は区切りの後半のコマへ移動して数字の多数決＋アイコン判定（2コマの平均）→ 確認画面で登録。1キャラ0.1秒（30fpsで3コマ）でも拾える。手ぶれは、数字の左の「世界戦闘力」の文字（とその上）を目印にずれを測って枠を追いかける（makeTracker）。追いかけた位置で自信がなければ元の位置でも読み、良い方を使う。
- `.github/workflows/border.yml`：毎日 `dev/gsp/scripts/update-border.mjs` でクマメイトのVIPボーダー推定値を `gsp/border.json` に書く。
