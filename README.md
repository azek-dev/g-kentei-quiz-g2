# G検定 4択クイズ（Even G2 プラグイン）

Even G2 で、G検定（JDLA Deep Learning for GENERAL）向けの4択クイズを解く Even Hub プラグインです。

- リングでスクロールして A〜D を選ぶ
- 答えたあとに「取り消し」で選び直せる（採点されない）
- 5問ごとに区切り。いつでも「終了」で終われる
- 成績は Even アプリ内に保存

問題はすべて自作です。JDLA の公式問題ではありません。

## 開発

```
npm install
npm run build   # src/ から index.html（1ファイル）を作る
```

`src/questions.js` に問題を追加できます（`choices` の先頭が正解。表示時に並べ替えます）。
