import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../'); // html_hosting folder
const processedFile = path.join(rootDir, 'automation/processed.json');

// ローカル実行時は html-viewer/.env を読み込む（GitHub Actionsでは環境変数を直接使う）
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.YOUTUBE_API_KEY;
const playlistId = process.argv[2] || process.env.PLAYLIST_ID;
// --all を付けると処理済みも含めて全件出力する
const includeAll = process.argv.includes('--all');

if (!apiKey || !playlistId) {
  console.error('YOUTUBE_API_KEY と PLAYLIST_ID（または第1引数）が必要です。');
  process.exit(1);
}

function loadProcessed() {
  if (!fs.existsSync(processedFile)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(processedFile, 'utf-8')).map((e) => e.videoId));
}

// プレイリストの全動画をページ送りで取得する
async function fetchPlaylistItems() {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.search = new URLSearchParams({
      part: 'snippet',
      maxResults: '50',
      playlistId,
      key: apiKey,
      ...(pageToken && { pageToken }),
    });
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`YouTube API error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      const s = item.snippet;
      // 削除済み・非公開の動画はスキップ
      if (s.title === 'Deleted video' || s.title === 'Private video') continue;
      items.push({
        videoId: s.resourceId.videoId,
        title: s.title,
        channel: s.videoOwnerChannelTitle ?? '',
        url: `https://www.youtube.com/watch?v=${s.resourceId.videoId}`,
        addedAt: s.publishedAt,
      });
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return items;
}

async function main() {
  try {
    const items = await fetchPlaylistItems();
    const processed = loadProcessed();
    const result = includeAll ? items : items.filter((i) => !processed.has(i.videoId));
    console.error(`取得 ${items.length} 件 / 処理済み ${processed.size} 件 / 出力 ${result.length} 件`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error fetching playlist:', err);
    process.exit(1);
  }
}

main();
