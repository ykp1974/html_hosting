// 既読管理（html_hosting_mgmt）と、要約待ちキュー（summary_queue）を扱うGAS。
// 合言葉は、プロジェクトの設定 → スクリプトプロパティ の QUEUE_TOKEN に保存する（コードには書かない）。

const QUEUE_SHEET_NAME = 'summary_queue';
const QUEUE_HEADERS = ['URL', 'タイトル', '登録日時', '状態', '処理日時', '試行回数', 'メモ'];
const MAX_ATTEMPTS = 3;

function getSheet() {
  const sheetName = 'html_hosting_mgmt';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  // シートが存在しない場合は自動作成
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['ファイルパス', '既読状態', '変更日時']);
  }

  return sheet;
}

function getQueueSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(QUEUE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(QUEUE_SHEET_NAME);
    sheet.appendRow(QUEUE_HEADERS);
  }
  return sheet;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('QUEUE_TOKEN');
  if (!expected || token !== expected) {
    throw new Error('認証に失敗しました');
  }
}

// 末尾の #fragment を除いて比較しやすくする
function normalizeUrl(url) {
  return String(url).trim().replace(/#.*$/, '');
}

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function doGet(e) {
  try {
    // 要約待ちキューの未処理一覧（GitHub Actionsが取得する）
    if (e && e.parameter && e.parameter.action === 'pending') {
      checkToken(e.parameter.token);
      return jsonOutput(listPending());
    }

    // 従来どおり：既読状態の一覧
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const result = {};

    for (let i = 1; i < data.length; i++) {
      const filePath = data[i][0];
      const isRead = data[i][1];
      if (filePath) {
        result[filePath] = isRead;
      }
    }

    return jsonOutput(result);
  } catch (error) {
    // エラー時もJSON形式で返し、CORSを回避する
    return jsonOutput({ error: error.toString() });
  }
}

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);

    if (postData.action === 'enqueue') return enqueue(postData);
    if (postData.action === 'mark') return mark(postData);

    // 従来どおり：既読状態の更新
    const sheet = getSheet();
    const filePath = postData.filePath;
    const isRead = postData.isRead;
    const timestamp = new Date();

    if (!filePath) {
      throw new Error("filePathが指定されていません");
    }

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === filePath) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex !== -1) {
      sheet.getRange(rowIndex, 2).setValue(isRead);
      sheet.getRange(rowIndex, 3).setValue(timestamp);
    } else {
      sheet.appendRow([filePath, isRead, timestamp]);
    }

    return jsonOutput({ success: true, filePath, isRead });

  } catch (error) {
    return jsonOutput({ success: false, error: error.toString() });
  }
}

// URLを要約待ちキューに追加する
function enqueue(postData) {
  checkToken(postData.token);
  const url = normalizeUrl(postData.url || '');
  if (!/^https?:\/\//i.test(url)) throw new Error('URLが不正です');
  if (isYouTubeUrl(url)) throw new Error('YouTubeは再生リストに入れてください');

  const sheet = getQueueSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === url) {
      return jsonOutput({ success: true, duplicate: true, url });
    }
  }
  sheet.appendRow([url, postData.title || '', new Date(), '未処理', '', 0, '']);
  return jsonOutput({ success: true, duplicate: false, url });
}

// 未処理（と、試行回数に余裕のある失敗）のURL一覧
function listPending() {
  const data = getQueueSheet().getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const [url, title, , status, , attempts] = data[i];
    if (!url) continue;
    if (status === '未処理' || (status === '失敗' && Number(attempts) < MAX_ATTEMPTS)) {
      items.push({ url, title });
    }
  }
  return items;
}

// 処理結果（済／失敗）を書き戻す
function mark(postData) {
  checkToken(postData.token);
  const url = normalizeUrl(postData.url || '');
  if (!['済', '失敗', '対象外'].includes(postData.status)) {
    throw new Error('statusは「済」「失敗」「対象外」のいずれかです');
  }
  const sheet = getQueueSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === url) {
      const row = i + 1;
      sheet.getRange(row, 4).setValue(postData.status);
      sheet.getRange(row, 5).setValue(new Date());
      if (postData.status === '失敗') {
        sheet.getRange(row, 6).setValue(Number(data[i][5]) + 1);
      }
      sheet.getRange(row, 7).setValue(postData.note || '');
      return jsonOutput({ success: true, url, status: postData.status });
    }
  }
  throw new Error('該当URLが見つかりません');
}
