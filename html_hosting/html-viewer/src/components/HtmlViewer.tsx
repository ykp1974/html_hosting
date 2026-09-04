import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';

// .env に設定したGASのURLを読み込む
const GAS_URL = import.meta.env.VITE_GAS_API_URL;

export default function HtmlViewer() {
  const [params] = useSearchParams();
  const file = params.get('file');
  const navigate = useNavigate();
  const [isChecked, setIsChecked] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); // オプショナル: 同期中かどうかの状態

  useEffect(() => {
    if (!file) return;

    // 1. まずローカルストレージから即座に復元（UIのチラつき防止）
    try {
      const stored = localStorage.getItem('html-viewer-status');
      if (stored) {
        const status = JSON.parse(stored);
        setIsChecked(!!status[file]);
      }
    } catch (e) {
      console.error('Fetch status error:', e);
    }

    // 2. バックグラウンドでGASから最新の同期データを取得
    if (GAS_URL) {
      fetch(GAS_URL)
        .then(res => res.json())
        .then(data => {
          // 取得した最新データでローカルストレージを上書き同期
          localStorage.setItem('html-viewer-status', JSON.stringify(data));
          // 現在開いているファイルの既読状態を再設定
          setIsChecked(!!data[file]);
        })
        .catch(err => console.error('GAS fetch error:', err));
    }
  }, [file]);

  const toggleCheck = async () => {
    if (!file) return;
    const newState = !isChecked;

    // 1. オプティミスティックUI更新（先に画面とローカルを更新してサクサク動かす）
    setIsChecked(newState);
    try {
      const stored = localStorage.getItem('html-viewer-status');
      const status = stored ? JSON.parse(stored) : {};
      status[file] = newState;
      localStorage.setItem('html-viewer-status', JSON.stringify(status));
    } catch (e) {
      console.error(e);
      setIsChecked(!newState); // エラー時は元に戻す
      return;
    }

    // 2. GASへPOSTしてスプレッドシートを更新
    if (GAS_URL) {
      setIsSyncing(true);
      try {
        // 【重要】GAS特有のCORSエラー（プリフライトリクエスト失敗）を回避するため、
        // application/json ではなく text/plain を指定して送信します。
        // GAS側の JSON.parse(e.postData.contents) で問題なく解釈されます。
        await fetch(GAS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
          },
          body: JSON.stringify({
            filePath: file,
            isRead: newState
          })
        });
      } catch (err) {
        console.error('GAS post error:', err);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  if (!file) {
    return <div className="p-8 text-center text-red-500">No file specified</div>;
  }

  const isDev = import.meta.env.DEV;
  const fileUrl = isDev
    ? `/api/serve-html?file=${encodeURIComponent(file)}`
    : `/${file}`;

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      <header className="bg-white border-b shadow-sm h-16 flex items-center justify-between px-6 z-10 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to List
        </button>
        <h1 className="text-lg font-semibold text-slate-800 truncate px-4 max-w-xl text-center">
          {file.split('/').pop()}
        </h1>
        <button
          onClick={toggleCheck}
          disabled={isSyncing} // POST中は連打防止
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isChecked
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
            } ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isChecked ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
          {isChecked ? 'Marked as Read' : 'Mark as Read'}
        </button>
      </header>

      <main className="flex-1 p-6 overflow-hidden">
        <div className="w-full h-full bg-white rounded-2xl shadow-xl border overflow-hidden p-0 relative">
          <iframe
            src={fileUrl}
            className="w-full h-full border-none absolute inset-0 rounded-2xl bg-white"
            title="HTML Document Viewer"
          />
        </div>
      </main>
    </div>
  );
}