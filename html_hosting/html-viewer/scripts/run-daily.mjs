import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 1回の実行で処理する最大本数（費用の暴走を防ぐ）
const maxPerRun = Number(process.env.MAX_PER_RUN || 10);

function runNode(script, args = []) {
  return execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function main() {
  const pending = JSON.parse(runNode('fetch-playlist.mjs'));
  const targets = pending.slice(0, maxPerRun);
  console.log(`未処理 ${pending.length} 件 / 今回処理 ${targets.length} 件`);

  const failed = [];
  for (const item of targets) {
    console.log(`処理中: ${item.title} (${item.url})`);
    try {
      // 成功時は generate-summary 側が processed.json に記録する
      console.log(`  -> ${runNode('generate-summary.mjs', [item.url]).trim()}`);
    } catch (err) {
      // 失敗した動画は記録されないため、次回の実行で再試行される
      console.error(`  失敗: ${item.url}`);
      failed.push(item.url);
    }
  }

  if (failed.length > 0) {
    console.error(`失敗 ${failed.length} 件:\n${failed.join('\n')}`);
    process.exit(1);
  }
}

main();
