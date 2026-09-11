/**
 * クラウド（GitHub Actions）で毎日1本、キューの先頭をInstagramに公開する。
 *
 *   node scripts/publish-next.mjs            公開する
 *   node scripts/publish-next.mjs --dry-run  何を出すか表示し、鍵が使えるかだけ確認する（公開しない）
 *
 * 必要な環境変数（GitHubのシークレット/変数から渡す）：
 *   IG_ACCESS_TOKEN  Instagramの鍵（シークレット）
 *   IG_USER_ID       InstagramのユーザーID（シークレット）
 *   IG_TOKEN_EXPIRES 鍵の期限 YYYY-MM-DD（変数。近づいたらIssueで知らせる）
 *   GITHUB_REPOSITORY / GITHUB_SHA / GH_TOKEN  Actionsが自動で渡す
 *
 * キュー：queue/<profile>/queue.json の先頭の番号 n について
 *   queue/<profile>/<n>.mp4  動画
 *   queue/<profile>/<n>.png  カバー（任意）
 *   queue/<profile>/<n>.json 本文 { n, theme, caption }
 * 公開したら3ファイルを消してキューから外し、queue/<profile>/posted.json に記録してコミットする。
 */
import fs from 'fs';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PROFILE = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : 'zatsugaku';
const { IG_ACCESS_TOKEN: TOKEN, IG_USER_ID: IGID, IG_TOKEN_EXPIRES, GITHUB_REPOSITORY: REPO, GITHUB_SHA: SHA } = process.env;
const QDIR = `queue/${PROFILE}`;
const IG = 'https://graph.instagram.com';
const WARN_DAYS = 14;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), ...a);
const sh = (cmd, a, input) => execFileSync(cmd, a, { encoding: 'utf8', input }).trim();
const cdn = (p) => `https://cdn.jsdelivr.net/gh/${REPO}@${SHA}/${p}`;

function openIssueOnce(title, body) {
  try {
    const open = sh('gh', ['issue', 'list', '--repo', REPO, '--state', 'open', '--search', `"${title}" in:title`, '--json', 'title', '--jq', '.[].title']);
    if (open.split('\n').includes(title)) return log(`（Issueは既にある: ${title}）`);
    sh('gh', ['issue', 'create', '--repo', REPO, '--title', title, '--body', body]);
    log(`Issueを作成: ${title}`);
  } catch (e) {
    log(`⚠ Issue作成に失敗: ${e.message}`);
  }
}

async function ig(method, pathname, params) {
  const url = new URL(`${IG}/${pathname}`);
  let body;
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', TOKEN);
  } else {
    body = new URLSearchParams({ ...params, access_token: TOKEN });
  }
  const r = await fetch(url, { method, body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Instagram API ${method} ${pathname}: ${JSON.stringify(j.error || j)}`);
  return j;
}

async function waitPublic(url, label, timeoutMs = 6 * 60 * 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return log(`${label} 取得OK（${r.headers.get('content-type')}）`);
    } catch {}
    await sleep(10000);
  }
  throw new Error(`${label} が公開URLで取れない: ${url}`);
}

async function main() {
  if (!TOKEN || !IGID) throw new Error('シークレット IG_ACCESS_TOKEN / IG_USER_ID が未登録です（「クラウドに鍵を登録.cmd」を実行）');

  // 1. 鍵の期限
  if (IG_TOKEN_EXPIRES) {
    const left = Math.floor((new Date(IG_TOKEN_EXPIRES) - Date.now()) / 86400000);
    log(`鍵の期限：${IG_TOKEN_EXPIRES}（残り${left}日）`);
    if (left <= WARN_DAYS && !DRY) {
      openIssueOnce(
        'Instagramの鍵の期限が近い',
        `鍵（IG_ACCESS_TOKEN）の期限は ${IG_TOKEN_EXPIRES}（残り${left}日）です。\n\nパソコンで「クラウドに鍵を登録.cmd」をダブルクリックすると、期限が約60日延びます。\n期限が切れると毎日の投稿が止まります。`
      );
    }
  }

  // 2. 鍵が使えるか
  const me = await ig('GET', 'me', { fields: 'username' });
  log(`鍵OK：@${me.username}`);

  // 3. キュー
  const qfile = `${QDIR}/queue.json`;
  const queue = fs.existsSync(qfile) ? JSON.parse(fs.readFileSync(qfile, 'utf8')) : [];
  if (!queue.length) {
    log('⛔ キューが空（在庫切れ）。今日は投稿しない');
    if (!DRY) openIssueOnce('Instagramの投稿キューが空（在庫切れ）', 'キューに動画がありません。パソコンで `node cloud-queue.mjs --numbers <番号>` を実行して積んでください。');
    return;
  }
  const n = queue[0];
  const meta = JSON.parse(fs.readFileSync(`${QDIR}/${n}.json`, 'utf8'));
  const videoUrl = cdn(`${QDIR}/${n}.mp4`);
  const coverUrl = fs.existsSync(`${QDIR}/${n}.png`) ? cdn(`${QDIR}/${n}.png`) : null;

  console.log(`\n===== ${n}本目（${meta.theme}） 残りキュー：${queue.join(', ')} =====\n${meta.caption}\n=====\n`);
  await waitPublic(videoUrl, '動画');
  if (coverUrl) await waitPublic(coverUrl, 'カバー');

  if (DRY) return log('--dry-run のため公開しない');

  // 4. 公開
  const params = { media_type: 'REELS', video_url: videoUrl, caption: meta.caption, share_to_feed: 'true' };
  if (coverUrl) params.cover_url = coverUrl;
  const { id: containerId } = await ig('POST', `${IGID}/media`, params);
  log(`コンテナ作成 ${containerId}`);
  const t0 = Date.now();
  for (;;) {
    const st = await ig('GET', containerId, { fields: 'status_code,status' });
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`コンテナ処理失敗: ${st.status_code} ${st.status || ''}`);
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('10分待っても処理が終わらない');
    await sleep(15000);
  }
  const { id: mediaId } = await ig('POST', `${IGID}/media_publish`, { creation_id: containerId });
  let permalink = null;
  try {
    permalink = (await ig('GET', mediaId, { fields: 'permalink' })).permalink;
  } catch {}
  log(`✅ 公開完了 ${n}本目 ${permalink || mediaId}`);

  // 5. 片付けと記録
  for (const ext of ['mp4', 'png', 'json']) {
    const f = `${QDIR}/${n}.${ext}`;
    if (fs.existsSync(f)) sh('git', ['rm', '-q', f]);
  }
  queue.shift();
  fs.writeFileSync(qfile, JSON.stringify(queue));
  const pfile = `${QDIR}/posted.json`;
  const posted = fs.existsSync(pfile) ? JSON.parse(fs.readFileSync(pfile, 'utf8')) : [];
  posted.push({ n, theme: meta.theme, mediaId, permalink, at: new Date().toISOString() });
  fs.writeFileSync(pfile, JSON.stringify(posted, null, 2));
  sh('git', ['add', qfile, pfile]);
  sh('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-q', '-m', `posted(${PROFILE}): ${n}`]);
  sh('git', ['push', '-q']);
  log(`残りキュー：${queue.length ? queue.join(', ') : '（空）'}`);
}

main().catch((e) => {
  console.error(`::error::${e.message || e}`);
  process.exit(1);
});
