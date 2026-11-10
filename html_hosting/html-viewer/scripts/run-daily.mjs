import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../'); // html_hosting folder
const runLogFile = path.join(rootDir, 'automation/run-log.json');

// 1回の実行で処理する最大本数（費用の暴走を防ぐ）
const maxPerRun = Number(process.env.MAX_PER_RUN || 10);

function runNode(script, args = []) {
  return execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function appendRunLog(entry) {
  const list = fs.existsSync(runLogFile)
    ? JSON.parse(fs.readFileSync(runLogFile, 'utf-8'))
    : [];
  list.push(entry);
  fs.mkdirSync(path.dirname(runLogFile), { recursive: true });
  fs.writeFileSync(runLogFile, JSON.stringify(list, null, 2), 'utf-8');
}

// 記事の要約待ちキュー（GAS経由のスプレッドシート）。未設定なら記事の処理は行わない
const gasUrl = process.env.GAS_URL;
const queueToken = process.env.QUEUE_TOKEN;

async function fetchArticleQueue() {
  if (!gasUrl || !queueToken) {
    console.log('GAS_URL / QUEUE_TOKEN が未設定のため、記事の処理はスキップします。');
    return [];
  }
  const url = new URL(gasUrl);
  url.search = new URLSearchParams({ action: 'pending', token: queueToken });
  const res = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`キューの取得に失敗: ${data.error ?? JSON.stringify(data)}`);
  return data;
}

async function markArticle(url, status, note = '') {
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'mark', token: queueToken, url, status, note }),
    });
    const data = await res.json();
    if (!data.success) console.error(`  シートへの書き戻しに失敗: ${data.error}`);
  } catch (err) {
    console.error(`  シートへの書き戻しに失敗: ${err.message}`);
  }
}

async function main() {
  const runAt = new Date().toISOString();
  const pending = JSON.parse(runNode('fetch-playlist.mjs'));
  const targets = pending.slice(0, maxPerRun);

  // 記事キューの取得に失敗しても、動画の処理は続ける
  let articles = [];
  try {
    articles = (await fetchArticleQueue()).slice(0, maxPerRun);
  } catch (err) {
    console.error(`記事キューを取得できませんでした（動画の処理は続行）: ${err.message}`);
  }
  console.log(`動画 未処理 ${pending.length} 件 / 今回処理 ${targets.length} 件 / 記事 今回処理 ${articles.length} 件`);

  const failed = [];
  for (const item of targets) {
    console.log(`処理中: ${item.title} (${item.url})`);
    try {
      // 成功時は generate-summary 側が processed.json に記録する
      console.log(`  -> ${runNode('generate-summary.mjs', [item.url, `--title=${item.title}`]).trim()}`);
    } catch (err) {
      // 失敗した動画は記録されないため、次回の実行で再試行される
      console.error(`  失敗: ${item.url}`);
      failed.push(item.url);
    }
  }

  const failedVideos = failed.length;
  let articleDone = 0;
  for (const item of articles) {
    console.log(`処理中(記事): ${item.title} (${item.url})`);
    try {
      console.log(`  -> ${runNode('generate-summary.mjs', [item.url, `--title=${item.title}`]).trim()}`);
      await markArticle(item.url, '済');
      articleDone++;
    } catch (err) {
      // 失敗は試行回数つきでシートに残り、上限までは翌日以降に再試行される
      console.error(`  失敗: ${item.url}`);
      failed.push(item.url);
      await markArticle(item.url, '失敗', 'Actionsのログを確認');
    }
  }

  // 実行ログを記録（処理0件でも毎回記録して「動いている」ことを確認できるようにする）
  appendRunLog({
    runAt,
    pending: pending.length + articles.length,
    processed: targets.length - failedVideos + articleDone,
    failed: failed.length,
    failures: failed,
  });

  // ステータスページを更新
  try {
    runNode('generate-status-page.mjs');
  } catch (err) {
    console.error('ステータスページ生成に失敗しました（処理は続行）:', err.message);
  }

  if (failed.length > 0) {
    console.error(`失敗 ${failed.length} 件:\n${failed.join('\n')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
