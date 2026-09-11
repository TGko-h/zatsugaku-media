# zatsugaku-media

「聞いてないけど雑学」（@kiitenaikedo）の Instagram リールを、**毎日18時ごろに自動で公開する**ための置き場。GitHub Actions で動くので、パソコンの電源に関係なく投稿される。

- `queue/zatsugaku/queue.json` … 出す順番
- `queue/zatsugaku/<n>.mp4 / .png / .json` … 動画・カバー・本文（公開したら自動で消える）
- `queue/zatsugaku/posted.json` … 公開した記録
- `scripts/publish-next.mjs` … 公開するスクリプト
- `.github/workflows/instagram-daily.yml` … 毎日 09:00 UTC（18:00 JST）に起動

動画はもともと SNS で公開するものなので公開リポジトリに置いている。**未公開の動画や個人情報は置かない。**鍵は GitHub のシークレットにだけ保存している。
