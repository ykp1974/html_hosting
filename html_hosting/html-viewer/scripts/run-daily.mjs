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

function main() {
  const runAt = new Date().toISOString();
  const pending = JSON.parse(runNode('fetch-playlist.mjs'));
  const targets = pending.slice(0, maxPerRun);
  console.log(`未処理 ${pending.length} 件 / 今回処理 ${targets.length} 件`);

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

  // 実行ログを記録（処理0件でも毎回記録して「動いている」ことを確認できるようにする）
  appendRunLog({
    runAt,
    pending: pending.length,
    processed: targets.length - failed.length,
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

main();
