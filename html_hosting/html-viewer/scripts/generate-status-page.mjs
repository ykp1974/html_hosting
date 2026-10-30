// generate-status-page.mjs
// processed.json と run-log.json を読んでステータスページを生成する
// 出力先: html_hosting/Docs/etc/[自動化ログ].html

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../'); // html_hosting folder
const processedFile = path.join(rootDir, 'automation/processed.json');
const runLogFile = path.join(rootDir, 'automation/run-log.json');
const outputFile = path.join(rootDir, 'Docs/etc/[自動化ログ].html');

function loadJson(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtJST(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// processed.json の file フィールド（例: "Docs/AI関連/xxx.html"）から
// ステータスページ（Docs/etc/）への相対パスに変換する
function toRelPath(filePath) {
  if (!filePath) return '#';
  // "Docs/xxx/yyy.html" → "../xxx/yyy.html"
  const withoutDocs = filePath.replace(/^Docs\//, '');
  return `../${withoutDocs}`;
}

function buildHtml(processed, runLog) {
  const recentSummaries = [...processed].reverse().slice(0, 30);
  const recentRuns = [...runLog].reverse().slice(0, 10);
  const lastRun = recentRuns[0] ?? null;

  const totalProcessed = processed.length;
  const lastStatus = lastRun
    ? (lastRun.failed === 0 ? '正常' : `${lastRun.failed}件失敗`)
    : '未実行';
  const lastStatusClass = lastRun
    ? (lastRun.failed === 0 ? 'ok' : 'warn')
    : '';

  const runRows = recentRuns.length
    ? recentRuns.map((r) => `
      <tr>
        <td>${esc(fmtJST(r.runAt))}</td>
        <td class="num">${r.pending ?? '—'}</td>
        <td class="num">${r.processed ?? '—'}</td>
        <td class="num ${r.failed > 0 ? 'warn' : ''}">${r.failed ?? '—'}</td>
        <td class="muted small">${r.failures?.length ? esc(r.failures.join(', ')) : '—'}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="muted">データなし</td></tr>';

  const summaryRows = recentSummaries.length
    ? recentSummaries.map((e) => {
        const relPath = toRelPath(e.file);
        const htmlTitle = esc(e.htmlTitle || path.basename(e.file ?? '', '.html'));
        const srcTitle = esc(e.sourceTitle || '—');
        const category = esc(e.file?.split('/')[1] ?? '—');
        return `
      <tr>
        <td class="muted small">${esc(fmtJST(e.processedAt))}</td>
        <td class="src-title">${srcTitle}</td>
        <td><a href="${esc(relPath)}" target="_blank">${htmlTitle}</a></td>
        <td class="muted">${category}</td>
        <td class="small"><a href="${esc(e.url ?? '')}" target="_blank" class="yt-btn">YT</a></td>
      </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">データなし</td></tr>';

  const generatedAt = fmtJST(new Date().toISOString());

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>自動化ログ</title>
<style>
:root{
  --bg:#0f172a;--panel:#1e293b;--text:#e2e8f0;
  --muted:#94a3b8;--accent:#38bdf8;--accent2:#818cf8;
  --line:rgba(255,255,255,.1);--green:#22c55e;--amber:#f59e0b;
}
*{box-sizing:border-box}
body{
  margin:0;padding:32px 16px;
  background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",
    "Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;
  font-size:.88rem;line-height:1.7;
}
.wrap{max-width:1100px;margin:auto}
h1{font-size:1.4rem;margin:0 0 4px;color:#fff}
.sub{color:var(--muted);margin:0 0 28px;font-size:.8rem}
.cards{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
  gap:12px;margin-bottom:32px;
}
.card{
  background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:16px 20px;
}
.card .lbl{font-size:.72rem;color:var(--muted);margin-bottom:4px}
.card .val{font-size:1.5rem;font-weight:700;color:#fff;line-height:1.2}
.card .val.ok{color:var(--green)}.card .val.warn{color:var(--amber)}
.card .val.sm{font-size:1rem}
h2{
  font-size:.95rem;margin:28px 0 10px;color:var(--accent);
  border-bottom:1px solid var(--line);padding-bottom:6px;
}
table{width:100%;border-collapse:collapse}
th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.72rem;color:var(--muted);font-weight:600;white-space:nowrap}
tr:hover td{background:rgba(255,255,255,.02)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.yt-btn{
  color:var(--muted);border:1px solid var(--line);
  padding:1px 7px;border-radius:4px;font-size:.75rem;
  white-space:nowrap;
}
.yt-btn:hover{border-color:var(--muted);text-decoration:none}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.warn{color:var(--amber)}.ok{color:var(--green)}
.muted{color:var(--muted)}.small{font-size:.8rem}
.src-title{color:var(--muted);font-size:.82rem;max-width:240px}
.footer{font-size:.75rem;color:var(--muted);margin-top:24px;text-align:right}
@media(max-width:640px){
  .cards{grid-template-columns:1fr 1fr}
  .src-title{display:none}
  th:nth-child(2),td:nth-child(2){display:none}
}
</style>
</head>
<body>
<div class="wrap">
  <h1>自動化ログ</h1>
  <p class="sub">YouTube「後で見る」リストの自動サマリ稼働状況</p>

  <div class="cards">
    <div class="card">
      <div class="lbl">最終実行（JST）</div>
      <div class="val sm">${esc(lastRun ? fmtJST(lastRun.runAt) : '—')}</div>
    </div>
    <div class="card">
      <div class="lbl">最終ステータス</div>
      <div class="val ${lastStatusClass}">${esc(lastStatus)}</div>
    </div>
    <div class="card">
      <div class="lbl">累計処理済み</div>
      <div class="val">${totalProcessed}</div>
    </div>
    <div class="card">
      <div class="lbl">前回処理本数</div>
      <div class="val">${lastRun?.processed ?? '—'}</div>
    </div>
    <div class="card">
      <div class="lbl">前回未処理残</div>
      <div class="val ${(lastRun?.pending ?? 0) > 0 ? 'warn' : ''}">${lastRun?.pending ?? '—'}</div>
    </div>
  </div>

  <h2>実行履歴（直近10回）</h2>
  <table>
    <thead><tr>
      <th>実行日時（JST）</th>
      <th class="num">未処理残</th>
      <th class="num">成功</th>
      <th class="num">失敗</th>
      <th>失敗URL</th>
    </tr></thead>
    <tbody>${runRows}</tbody>
  </table>

  <h2>最近のサマリ（直近30件・新しい順）</h2>
  <table>
    <thead><tr>
      <th>処理日時（JST）</th>
      <th>YouTube元タイトル</th>
      <th>HTMLタイトル</th>
      <th>カテゴリ</th>
      <th></th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>

  <p class="footer">ページ生成: ${esc(generatedAt)}</p>
</div>
</body>
</html>`;
}

function main() {
  const processed = loadJson(processedFile);
  const runLog = loadJson(runLogFile);
  const html = buildHtml(processed, runLog);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, html, 'utf-8');
  console.log(`ステータスページ生成: ${outputFile}`);
}

main();
