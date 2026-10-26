import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../'); // html_hosting folder
const docsDir = path.join(rootDir, 'Docs');
const processedFile = path.join(rootDir, 'automation/processed.json');
// デザイン見本として毎回プロンプトに入れる既存HTML
const sampleFile = path.join(docsDir, 'AI関連/[デザインサンプル]AIマネジタイズ 5つの統合戦略.html');
// カテゴリ候補から除外するフォルダ（手動管理用）
const excludedCategories = new Set(['Keep', 'etc', 'not-yet']);
const fallbackCategory = 'not-yet';
const maxNameLength = 60;

// ローカル実行時は html-viewer/.env を読み込む（GitHub Actionsでは環境変数を直接使う）
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// 使い方: node scripts/generate-summary.mjs <YouTube URL> [--no-record]
const videoUrl = process.argv.slice(2).find((a) => !a.startsWith('--'));
const noRecord = process.argv.includes('--no-record');

if (!apiKey || !videoUrl) {
  console.error('GEMINI_API_KEY と YouTube URL（第1引数）が必要です。');
  process.exit(1);
}

function extractVideoId(url) {
  const u = new URL(url);
  return u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
}

function listCategories() {
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !excludedCategories.has(e.name))
    .map((e) => e.name);
}

// ファイル名に使えない文字を除き、60文字に切り詰める
function toSafeFileName(title) {
  const cleaned = title.replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, maxNameLength).join('') || 'untitled';
}

function buildPrompt(categories, sampleHtml) {
  return `あなたは動画の内容を分析し、読みやすい日本語の概要説明資料（単体HTML）を作成する編集者です。
添付の動画を視聴し、次の条件で出力してください。

## 条件
- 動画の内容を、エグゼクティブ・サマリー、主要な論点（見出しごと）、結論・今後の注目点の順に整理する。
- 動画で語られていない推測や、一般知識による補足を事実として混ぜない。
- 日本語で書く。固有名詞・数値は動画の通りに正確に記載する。
- HTMLは <!DOCTYPE html> から </html> までの単体ファイルとし、CSSは <style> に埋め込む。外部ライブラリ・外部画像は使わない。
- 冒頭付近に、動画へのリンク（${videoUrl}）を target="_blank" 付きで入れる。
- デザイン・構造は下記の見本HTMLに合わせる（配色は内容に合わせて変えてよい）。
- category は次の候補から最も適切なものを1つだけ選ぶ: ${categories.join('、')}
- title は内容を表す日本語の題名（ファイル名にも使うので40文字程度まで）。

## デザイン見本HTML
${sampleHtml}`;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [
      {
        parts: [{ fileData: { fileUri: videoUrl, mimeType: 'video/mp4' } }, { text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING' },
          title: { type: 'STRING' },
          html: { type: 'STRING' },
        },
        required: ['category', 'title', 'html'],
      },
      // 長尺動画のトークン消費を抑える
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    throw new Error(`Gemini の応答が空です: ${JSON.stringify(data).slice(0, 500)}`);
  }
  console.error(`トークン使用量: ${JSON.stringify(data.usageMetadata)}`);
  return JSON.parse(text);
}

function recordProcessed(entry) {
  const list = fs.existsSync(processedFile) ? JSON.parse(fs.readFileSync(processedFile, 'utf-8')) : [];
  list.push(entry);
  fs.writeFileSync(processedFile, JSON.stringify(list, null, 2), 'utf-8');
}

async function main() {
  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) throw new Error(`動画IDを取得できません: ${videoUrl}`);

    const categories = listCategories();
    const sampleHtml = fs.readFileSync(sampleFile, 'utf-8');
    console.error(`モデル: ${model} / 動画: ${videoId} / カテゴリ候補: ${categories.join(', ')}`);

    const result = await callGemini(buildPrompt(categories, sampleHtml));
    if (!/<html[\s>]/i.test(result.html)) {
      throw new Error('生成結果が HTML として不完全です。');
    }

    const category = categories.includes(result.category) ? result.category : fallbackCategory;
    const outDir = path.join(docsDir, category);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${toSafeFileName(result.title)}.html`);
    fs.writeFileSync(outPath, result.html, 'utf-8');

    if (!noRecord) {
      recordProcessed({
        videoId,
        url: videoUrl,
        file: path.relative(rootDir, outPath).replace(/\\/g, '/'),
        processedAt: new Date().toISOString(),
      });
    }
    console.log(outPath);
  } catch (err) {
    console.error('Error generating summary:', err);
    process.exit(1);
  }
}

main();
