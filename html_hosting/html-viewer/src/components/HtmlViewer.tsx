import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react';

const GAS_URL = import.meta.env.VITE_GAS_API_URL;

export default function HtmlViewer() {
  const [params] = useSearchParams();
  const file = params.get('file');
  const navigate = useNavigate();
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    if (!file) return;

    // 1. ローカルストレージから即座に復元
    try {
      const stored = localStorage.getItem('html-viewer-status');
      if (stored) {
        const status = JSON.parse(stored);
        const val = status[file];
        setIsChecked(val === true || val === 'TRUE' || val === 'true');
      }
    } catch (e) {
      console.error('Fetch status error:', e);
    }

    // 2. バックグラウンドでGASから最新データを取得
    if (GAS_URL) {
      const fetchUrl = GAS_URL.includes('?') ? `${GAS_URL}&t=${Date.now()}` : `${GAS_URL}?t=${Date.now()}`;
      fetch(fetchUrl)
        .then(res => res.json())
        .then(data => {
          localStorage.setItem('html-viewer-status', JSON.stringify(data));
          const val = data[file];
          setIsChecked(val === true || val === 'TRUE' || val === 'true');
        })
        .catch(err => console.error('GAS fetch error:', err));
    }
  }, [file]);

  const toggleCheck = async () => {
    if (!file) return;
    const newState = !isChecked;

    // 1. オプティミスティックUI更新
    setIsChecked(newState);
    try {
      const stored = localStorage.getItem('html-viewer-status');
      const status = stored ? JSON.parse(stored) : {};
      status[file] = newState;
      localStorage.setItem('html-viewer-status', JSON.stringify(status));
    } catch (e) {
      console.error(e);
      setIsChecked(!newState);
      return;
    }

    // 2. GASへPOST
    if (GAS_URL) {
      try {
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
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isChecked
            ? 'bg-green-100 text-green-700 hover:bg-green-200'
            : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
            }`}
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