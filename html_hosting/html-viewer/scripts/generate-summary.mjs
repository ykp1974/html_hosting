import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../'); // html_hosting folder
const docsDir = path.join(rootDir, 'Docs');
const processedFile = path.join(rootDir, 'automation/processed.json');
// デザイン見本として毎回プロンプトに入れる既存HTML
const sampleFile = path.join(docsDir, 'Keep/Useful/Windows高速化とストレージ最適化 分析報告書.html');
// カテゴリ候補から除外するフォルダ（手動管理用）
const excludedCategories = new Set(['Keep', 'etc', 'not-yet']);
const fallbackCategory = 'not-yet';
const maxNameLength = 60;

// ローカル実行時は html-viewer/.env を読み込む（GitHub Actionsでは環境変数を直接使う）
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// 使い方: node scripts/generate-summary.mjs <YouTube URLまたは記事URL> [--no-record] [--title=元タイトル]
const videoUrl = process.argv.slice(2).find((a) => !a.startsWith('--'));
const isYouTube = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(videoUrl ?? '');
const noRecord = process.argv.includes('--no-record');
// 動画の元タイトル（任意）。--title=... で渡す
const videoTitle = process.argv.find((a) => a.startsWith('--title='))?.slice('--title='.length) ?? '';

if (!apiKey || !videoUrl) {
  console.error('GEMINI_API_KEY と URL（第1引数）が必要です。');
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
  const kind = isYouTube ? '動画' : '記事';
  return `あなたは${kind}の内容を分析し、読みやすい日本語の概要説明資料（単体HTML）を作成する編集者です。
${isYouTube ? '添付の動画を視聴し' : `次のURLの記事を読み（${videoUrl}）`}、次の条件で出力してください。

## 条件
- ${kind}の内容を、エグゼクティブ・サマリー、主要な論点（見出しごと）、結論・今後の注目点の順に整理する。
- ${kind}に書かれて（語られて）いない推測や、一般知識による補足を事実として混ぜない。
- 日本語で書く。固有名詞・年・日付・数値は${kind}の通りに正確に記載し、記憶や推測で補わない。${videoTitle ? `\n- ${kind}の元タイトルは「${videoTitle}」。title はこの元タイトルと矛盾させない（年なども元タイトルに合わせる）。` : ''
    }
- HTMLは <!DOCTYPE html> から </html> までの単体ファイルとし、CSSは <style> に埋め込む。外部ライブラリ・外部画像は使わない。
- 冒頭付近に、${kind}へのリンク（${videoUrl}）を target="_blank" 付きで入れる。
- デザイン・構造は下記の見本HTMLに合わせる（配色は内容に合わせて変えてよい）。
- category は次の候補から最も適切なものを1つだけ選ぶ: ${categories.join('、')}
- title は内容を表す日本語の題名（ファイル名にも使うので40文字程度まで）。${isYouTube
      ? ''
      : `
- 記事を読み込めなかった場合（有料・ログイン必須・取得失敗など）は、内容を推測せず、1行目に「ERROR: 理由」とだけ出力する。

## 出力形式（この形式を厳守。JSONや説明文は付けない）
CATEGORY: （カテゴリ名）
TITLE: （題名）
===HTML===
（HTML全文）`
    }

## デザイン見本HTML
${sampleHtml}`;
}

// 記事向けの出力（CATEGORY/TITLE/===HTML===）を分解する
function parseArticleOutput(text) {
  const trimmed = text.trim();
  if (/^ERROR:/i.test(trimmed)) {
    throw new Error(`記事を読み込めませんでした: ${trimmed.split('\n')[0]}`);
  }
  const m = trimmed.match(/^CATEGORY:\s*(.+)\r?\nTITLE:\s*(.+)\r?\n===HTML===\r?\n([\s\S]+)$/);
  if (!m) throw new Error(`出力形式が不正です: ${trimmed.slice(0, 200)}`);
  const html = m[3].replace(/^```(?:html)?\s*\n/, '').replace(/\n```\s*$/, '');
  return { category: m[1].trim(), title: m[2].trim(), html };
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = isYouTube
    ? {
      contents: [
        { parts: [{ fileData: { fileUri: videoUrl, mimeType: 'video/mp4' } }, { text: prompt }] },
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
    }
    : {
      // URL Context はJSON出力指定と併用できないため、区切り形式で受け取る
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ url_context: {} }],
    };
  // 一時的な混雑（429/5xx）は待ってから再試行する
  const maxAttempts = 4;
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    }
    const waitSec = 30 * attempt;
    console.error(`Gemini ${res.status}。${waitSec}秒後に再試行します（${attempt}/${maxAttempts - 1}）`);
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    throw new Error(`Gemini の応答が空です: ${JSON.stringify(data).slice(0, 500)}`);
  }
  console.error(`トークン使用量: ${JSON.stringify(data.usageMetadata)}`);
  if (isYouTube) return JSON.parse(text);

  // 記事は、URLを実際に取得できたことを確認してから結果を採用する
  const statuses = data.candidates?.[0]?.urlContextMetadata?.urlMetadata ?? [];
  if (statuses.some((u) => u.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_PAYWALL')) {
    // 有料記事は対象外（再試行しない）
    throw Object.assign(new Error('有料記事（ペイウォール）のため取得できません'), { code: 'PAYWALL' });
  }
  if (!statuses.some((u) => u.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_SUCCESS')) {
    throw new Error(`記事URLを取得できませんでした: ${JSON.stringify(statuses)}`);
  }
  return parseArticleOutput(text);
}

function recordProcessed(entry) {
  const list = fs.existsSync(processedFile) ? JSON.parse(fs.readFileSync(processedFile, 'utf-8')) : [];
  list.push(entry);
  fs.writeFileSync(processedFile, JSON.stringify(list, null, 2), 'utf-8');
}

async function main() {
  try {
    const videoId = isYouTube ? extractVideoId(videoUrl) : null;
    if (isYouTube && !videoId) throw new Error(`動画IDを取得できません: ${videoUrl}`);

    const categories = listCategories();
    const sampleHtml = fs.readFileSync(sampleFile, 'utf-8');
    console.error(`モデル: ${model} / 対象: ${videoId ?? videoUrl} / カテゴリ候補: ${categories.join(', ')}`);

    const result = await callGemini(buildPrompt(categories, sampleHtml));
    if (!/<html[\s>]/i.test(result.html)) {
      throw new Error('生成結果が HTML として不完全です。');
    }

    const category = categories.includes(result.category) ? result.category : fallbackCategory;
    const outDir = path.join(docsDir, category);
    fs.mkdirSync(outDir, { recursive: true });
    // 同名ファイルがあれば上書きせず連番を付ける
    const baseName = toSafeFileName(result.title);
    let outPath = path.join(outDir, `${baseName}.html`);
    for (let n = 2; fs.existsSync(outPath); n++) {
      outPath = path.join(outDir, `${baseName}_${n}.html`);
    }
    fs.writeFileSync(outPath, result.html, 'utf-8');

    if (!noRecord) {
      recordProcessed({
        videoId,
        url: videoUrl,
        file: path.relative(rootDir, outPath).replace(/\\/g, '/'),
        sourceTitle: videoTitle || '',
        htmlTitle: result.title || '',
        processedAt: new Date().toISOString(),
      });
    }
    console.log(outPath);
  } catch (err) {
    console.error('Error generating summary:', err);
    // 終了コード3：有料記事（呼び出し元が「対象外」として扱う）
    process.exit(err.code === 'PAYWALL' ? 3 : 1);
  }
}

main();
