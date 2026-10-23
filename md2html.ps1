# md2html.ps1
# クリップボードのHTML/Markdownをジャンル別にDocsへ保存してgit pushする
# 使い方: .\md2html.ps1

$DocsRoot = "$PSScriptRoot\html_hosting\Docs"

function HtmlEncode($s) {
    $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;')
}

# ── 共通: ジャンル選択 ───────────────────────────────────────────
function Select-Genre {
    $genres = Get-ChildItem $DocsRoot -Directory | Sort-Object Name | Select-Object -ExpandProperty Name
    Write-Host ""
    Write-Host "ジャンルを選択してください:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $genres.Count; $i++) {
        Write-Host ("  {0,2}) {1}" -f ($i + 1), $genres[$i])
    }
    $sel = Read-Host "> "
    $idx = [int]$sel - 1
    if ($idx -lt 0 -or $idx -ge $genres.Count) {
        Write-Host "エラー: 無効な選択です。" -ForegroundColor Red
        exit 1
    }
    return $genres[$idx]
}

# ── 共通: 保存 & git push ────────────────────────────────────────
function Save-AndPush($content, $outFile) {
    $outDir = Split-Path $outFile
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }
    $content | Set-Content -Path $outFile -Encoding UTF8
    Write-Host ""
    Write-Host "保存しました: $outFile" -ForegroundColor Green
    Write-Host ""
    $confirm = Read-Host "git push しますか？ (Y/n)"
    if ($confirm -eq "" -or $confirm -match "^[Yy]") {
        Push-Location $PSScriptRoot
        git add $outFile
        $safeBase = [System.IO.Path]::GetFileNameWithoutExtension($outFile)
        $genreName = Split-Path (Split-Path $outFile -Parent) -Leaf
        git commit -m "$(Get-Date -Format 'yyyyMMdd') Add $genreName/$safeBase"
        git push
        Pop-Location
        Write-Host ""
        Write-Host "Git push 完了。Netlifyが自動ビルドを開始します。" -ForegroundColor Cyan
    } else {
        Write-Host "Git push をスキップしました。" -ForegroundColor Yellow
    }
}

# ── 1. クリップボード取得 ────────────────────────────────────────
$clip = Get-Clipboard -Raw
if (-not $clip -or $clip.Trim() -eq "") {
    Write-Host "エラー: クリップボードにテキストがありません。" -ForegroundColor Red
    exit 1
}

# ── 2. HTML / Markdown 判定 ──────────────────────────────────────
$isHtml = $clip.TrimStart() -match '(?i)^<!DOCTYPE\s+html|^<html'

if ($isHtml) {
    # ════════════════════════════════════════════════════════════
    # ▼ HTML モード: Gemini等が生成したHTMLをそのまま保存
    # ════════════════════════════════════════════════════════════
    Write-Host "モード     : HTML（直接保存）" -ForegroundColor Magenta

    # <title> からタイトル抽出
    if ($clip -match '(?i)<title>([^<]+)</title>') {
        $title = $Matches[1].Trim()
    } else {
        $title = (Read-Host "タイトルを入力してください").Trim()
    }
    Write-Host "タイトル : $title" -ForegroundColor Cyan

    $genre   = Select-Genre
    Write-Host "ジャンル : $genre" -ForegroundColor Green

    $safeTitle = ($title -replace '[\\/:*?"<>|]', '_').Trim()
    $outFile   = Join-Path (Join-Path $DocsRoot $genre) "$safeTitle.html"
    Save-AndPush $clip $outFile
    exit 0
}

# ════════════════════════════════════════════════════════════════
# ▼ Markdown モード: 変換してから保存
# ════════════════════════════════════════════════════════════════
Write-Host "モード     : Markdown（変換して保存）" -ForegroundColor Magenta
$md = $clip

# ── 3. URL・リンクテキスト抽出（末尾の「リンク：」「リンクテキスト：」ブロック） ──
$sourceUrl      = ""
$sourceLinkText = ""
$mdLines = $md -split "`r?\n"

for ($i = $mdLines.Count - 1; $i -ge 0; $i--) {
    $l = $mdLines[$i].Trim()
    if ($l -match '^リンクテキスト[：:]\s*$' -and $i + 1 -lt $mdLines.Count) {
        $sourceLinkText = $mdLines[$i + 1].Trim()
    }
    if ($l -match '^リンク[：:]\s*$' -and $i + 1 -lt $mdLines.Count) {
        $sourceUrl = $mdLines[$i + 1].Trim()
    }
}

if ($sourceUrl) {
    $md = ($mdLines | Where-Object {
        $_.Trim() -notmatch '^リンク[：:]\s*$' -and
        $_.Trim() -notmatch '^リンクテキスト[：:]\s*$' -and
        $_.Trim() -ne $sourceUrl -and
        ($sourceLinkText -eq "" -or $_.Trim() -ne $sourceLinkText)
    }) -join "`n"
    Write-Host "元URL      : $sourceUrl" -ForegroundColor DarkCyan
}

# ── 4. タイトル抽出（最初の # 行） ──────────────────────────────
$titleLine = ($md -split "`n" | Where-Object { $_ -match "^#\s+" } | Select-Object -First 1)
if ($titleLine) {
    $title = ($titleLine -replace "^#+\s+", "").Trim()
} else {
    $title = (Read-Host "タイトルを入力してください").Trim()
}
Write-Host ""
Write-Host "タイトル : $title" -ForegroundColor Cyan

$genre = Select-Genre
Write-Host "ジャンル : $genre" -ForegroundColor Green

# ── 5. Markdown → HTML 変換 ──────────────────────────────────────
function Inline($line) {
    # コード（インライン）
    $line = [regex]::Replace($line, '`([^`]+)`', { '<code>' + (HtmlEncode $args[0].Groups[1].Value) + '</code>' })
    # 太字
    $line = [regex]::Replace($line, '\*\*(.+?)\*\*', '<strong>$1</strong>')
    $line = [regex]::Replace($line, '__(.+?)__',     '<strong>$1</strong>')
    # 斜体
    $line = [regex]::Replace($line, '\*(.+?)\*', '<em>$1</em>')
    $line = [regex]::Replace($line, '_(.+?)_',   '<em>$1</em>')
    # リンク
    $line = [regex]::Replace($line, '\[(.+?)\]\((.+?)\)', '<a href="$2" target="_blank">$1</a>')
    return $line
}

function Convert-MdToHtml($text) {
    $lines  = $text -split "`r?\n"
    $sb     = [System.Text.StringBuilder]::new()
    $paraSb = [System.Text.StringBuilder]::new()
    $inCode = $false
    $inUl   = $false
    $inOl   = $false

    function Flush-Para {
        $p = $paraSb.ToString().Trim()
        if ($p) { $null = $sb.AppendLine("<p>$p</p>") }
        $null = $paraSb.Clear()
    }
    function Close-Lists {
        if ($inUl) { $null = $sb.AppendLine("</ul>"); $script:inUl = $false }
        if ($inOl) { $null = $sb.AppendLine("</ol>"); $script:inOl = $false }
    }

    foreach ($line in $lines) {
        # ── コードブロック開閉 ──
        if ($line -match '^```') {
            if ($inCode) {
                $null = $sb.AppendLine("</code></pre>")
                $script:inCode = $false
            } else {
                Flush-Para; Close-Lists
                $lang = ($line -replace '^```', '').Trim()
                $attr = if ($lang) { " class='language-$lang'" } else { "" }
                $null = $sb.AppendLine("<pre><code$attr>")
                $script:inCode = $true
            }
            continue
        }
        if ($inCode) {
            $null = $sb.AppendLine((HtmlEncode $line))
            continue
        }

        # ── 見出し ──
        if ($line -match '^(#{1,6})\s+(.+)$') {
            Flush-Para; Close-Lists
            $lv  = $Matches[1].Length
            $txt = Inline($Matches[2])
            $null = $sb.AppendLine("<h$lv>$txt</h$lv>")
            continue
        }

        # ── 水平線 ──
        if ($line -match '^(-{3,}|\*{3,}|_{3,})$') {
            Flush-Para; Close-Lists
            $null = $sb.AppendLine("<hr>")
            continue
        }

        # ── 引用 ──
        if ($line -match '^>\s*(.*)$') {
            Flush-Para; Close-Lists
            $null = $sb.AppendLine("<blockquote>" + (Inline $Matches[1]) + "</blockquote>")
            continue
        }

        # ── 順序なしリスト ──
        if ($line -match '^[\-\*\+]\s+(.+)$') {
            Flush-Para
            if ($inOl) { $null = $sb.AppendLine("</ol>"); $script:inOl = $false }
            if (-not $inUl) { $null = $sb.AppendLine("<ul>"); $script:inUl = $true }
            $null = $sb.AppendLine("<li>" + (Inline $Matches[1]) + "</li>")
            continue
        }

        # ── 順序ありリスト ──
        if ($line -match '^\d+\.\s+(.+)$') {
            Flush-Para
            if ($inUl) { $null = $sb.AppendLine("</ul>"); $script:inUl = $false }
            if (-not $inOl) { $null = $sb.AppendLine("<ol>"); $script:inOl = $true }
            $null = $sb.AppendLine("<li>" + (Inline $Matches[1]) + "</li>")
            continue
        }

        # ── 空行 ──
        if ($line.Trim() -eq "") {
            Flush-Para; Close-Lists
            continue
        }

        # ── 通常テキスト（段落に蓄積） ──
        if ($inUl -or $inOl) { Close-Lists }
        if ($paraSb.Length -gt 0) { $null = $paraSb.Append(" ") }
        $null = $paraSb.Append((Inline $line))
    }

    Flush-Para; Close-Lists
    if ($inCode) { $null = $sb.AppendLine("</code></pre>") }
    return $sb.ToString()
}

$bodyHtml   = Convert-MdToHtml $md
$titleEnc   = HtmlEncode $title
$genreEnc   = HtmlEncode $genre

# ソースリンクHTML（URLがある場合のみ出力）
if ($sourceUrl) {
    $linkTextEnc = if ($sourceLinkText) { HtmlEncode $sourceLinkText } else { HtmlEncode $sourceUrl }
    $urlEnc      = HtmlEncode $sourceUrl
    $sourceLinkHtml = "    <a class=`"source-link`" href=`"$urlEnc`" target=`"_blank`" rel=`"noopener`">$linkTextEnc</a>"
} else {
    $sourceLinkHtml = ""
}

$fullHtml = @"
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>$titleEnc</title>
<style>
:root {
  --bg:#0f172a; --panel:#1e293b; --text:#e2e8f0;
  --muted:#94a3b8; --accent:#38bdf8; --accent2:#818cf8;
  --line:rgba(255,255,255,.1);
}
*{box-sizing:border-box}
body{
  margin:0;padding:40px 16px;
  background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",
    "Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;
  line-height:1.85;
}
.container{max-width:860px;margin:auto}
header{
  border-left:4px solid var(--accent);
  padding:4px 0 4px 20px;margin-bottom:40px;
}
header h1{
  margin:8px 0 0;font-size:clamp(1.5rem,4vw,2.2rem);
  line-height:1.3;color:#fff;
}
.badge{
  display:inline-block;padding:3px 12px;
  border:1px solid rgba(56,189,248,.4);border-radius:999px;
  color:var(--accent);font-size:.75rem;font-weight:700;
  letter-spacing:.1em;background:rgba(56,189,248,.08);
}
article h2{
  font-size:1.35rem;margin:2.2em 0 .6em;
  padding-bottom:.3em;border-bottom:1px solid var(--line);
  color:var(--accent);
}
article h3{font-size:1.1rem;margin:1.8em 0 .5em;color:var(--accent2)}
article h4,article h5,article h6{margin:1.4em 0 .4em}
article p{margin:.8em 0}
article ul,article ol{padding-left:1.6em;margin:.8em 0}
article li{margin:.35em 0}
article strong{color:#fff}
article code{
  background:rgba(255,255,255,.08);border-radius:4px;
  padding:1px 6px;font-size:.88em;
  font-family:"Cascadia Code","Consolas",monospace;
}
article pre{
  background:#0d1525;border:1px solid var(--line);
  border-radius:10px;padding:18px 20px;overflow-x:auto;margin:1.2em 0;
}
article pre code{background:none;padding:0;font-size:.9em}
article a{color:var(--accent)}
article a:hover{text-decoration:underline}
article hr{border:none;border-top:1px solid var(--line);margin:2em 0}
article blockquote{
  border-left:3px solid var(--accent);margin:1em 0;
  padding:.5em 1em;color:var(--muted);
  background:rgba(56,189,248,.05);border-radius:0 8px 8px 0;
}
.source-link{
  display:inline-flex;align-items:center;gap:6px;
  margin-top:12px;padding:8px 16px;
  border:1px solid rgba(56,189,248,.3);border-radius:8px;
  background:rgba(56,189,248,.06);
  color:var(--accent);font-size:.85rem;text-decoration:none;
  transition:.15s;
}
.source-link:hover{border-color:var(--accent);background:rgba(56,189,248,.12)}
.source-link::before{content:"▶";font-size:.75em;opacity:.7}
</style>
</head>
<body>
<div class="container">
  <header>
    <span class="badge">$genreEnc</span>
    <h1>$titleEnc</h1>
$sourceLinkHtml
  </header>
  <article>
$bodyHtml
  </article>
</div>
</body>
</html>
"@

# ── 6. ファイル保存 & git push ───────────────────────────────────
$safeTitle = ($title -replace '[\\/:*?"<>|]', '_').Trim()
$outFile   = Join-Path (Join-Path $DocsRoot $genre) "$safeTitle.html"
Save-AndPush $fullHtml $outFile
