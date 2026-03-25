import { useEffect, useState, useMemo } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle2, Circle, FileText, FolderOpen, LayoutTemplate, Search } from 'lucide-react';
import HtmlViewer from './components/HtmlViewer';

type StatusMap = Record<string, boolean>;

function FileList() {
  const [files, setFiles] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusMap>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      setFiles(data);
    } catch (e) {
      console.error('Fetch files error:', e);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('Fetch status error:', e);
    }
  };

  useEffect(() => {
    Promise.all([fetchFiles(), fetchStatus()]).then(() => setLoading(false));
  }, []);

  const toggleCheck = async (file: string, currentState: boolean) => {
    const newState = !currentState;
    setStatus(prev => ({ ...prev, [file]: newState }));
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: file, checked: newState })
      });
    } catch (e) {
      console.error('Update status error:', e);
      setStatus(prev => ({ ...prev, [file]: currentState }));
    }
  };

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const lowerQ = searchQuery.toLowerCase();
    return files.filter(f => f.toLowerCase().includes(lowerQ));
  }, [files, searchQuery]);

  const filesByDir = useMemo(() => {
    return filteredFiles.reduce((acc, file) => {
      const parts = file.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root';
      if (!acc[dir]) acc[dir] = [];
      acc[dir].push(file);
      return acc;
    }, {} as Record<string, string[]>);
  }, [filteredFiles]);

  const readCount = Object.values(status).filter(Boolean).length;
  const progress = files.length > 0 ? Math.round((readCount / files.length) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse flex flex-col items-center">
          <LayoutTemplate className="w-12 h-12 text-indigo-400 mb-4" />
          <div className="text-xl font-medium text-slate-500">Loading documents...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 animate-in fade-in duration-500">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold mb-4">
            HTML Reader App
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 flex items-center gap-3 tracking-tight">
            Document Center
          </h1>
          <p className="text-slate-500 mt-2 text-lg">Browse, read, and track your HTML files across the project.</p>
        </div>
        
        <div className="glass-panel p-4 flex flex-col min-w-[200px]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-slate-600">Reading Progress</span>
            <span className="text-sm font-bold text-indigo-600">{progress}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
            <div 
              className="bg-indigo-600 h-2.5 rounded-full transition-all duration-1000 ease-out" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="text-xs text-slate-500 mt-2 text-right">
            {readCount} of {files.length} read
          </div>
        </div>
      </header>

      <div className="mb-8 relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input 
          type="text" 
          placeholder="Search files or directories..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 shadow-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-slate-700 text-lg transition-all"
        />
      </div>
      
      {Object.keys(filesByDir).length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 border-dashed">
          <p className="text-slate-500 text-lg">No visible HTML files found. Try a different search.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(filesByDir).map(([dir, dirFiles]) => (
            <div key={dir} className="glass-panel p-6 shadow-sm hover:shadow-md transition-shadow group">
              <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-3 mb-6 border-b border-slate-100 pb-3">
                <FolderOpen className="w-6 h-6 text-indigo-500 group-hover:text-indigo-600 transition-colors" />
                {dir}
                <span className="ml-auto text-sm font-medium bg-slate-100 text-slate-500 px-3 py-1 rounded-full">
                  {dirFiles.length} {dirFiles.length === 1 ? 'file' : 'files'}
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {dirFiles.map(file => {
                  const isChecked = !!status[file];
                  const fileName = file.split('/').pop() || file;
                  return (
                    <div 
                      key={file} 
                      className={`relative flex items-center justify-between p-4 rounded-xl border transition-all duration-300 transform hover:-translate-y-1 ${
                        isChecked 
                          ? 'bg-green-50/60 border-green-200 outline outline-1 outline-green-200 shadow-sm' 
                          : 'bg-white border-slate-200 hover:border-indigo-300 shadow-sm hover:shadow-md'
                      }`}
                    >
                      <Link
                        to={`/view?file=${encodeURIComponent(file)}`}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <div className={`p-2 rounded-lg ${isChecked ? 'bg-green-100' : 'bg-indigo-50'}`}>
                          <FileText className={`w-5 h-5 flex-shrink-0 ${isChecked ? 'text-green-600' : 'text-indigo-600'}`} />
                        </div>
                        <span className={`truncate font-medium text-sm md:text-base ${isChecked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                          {fileName.replace(/\.html$/, '')}
                        </span>
                      </Link>
                      <button
                        onClick={() => toggleCheck(file, isChecked)}
                        className="ml-2 p-2 focus:outline-none rounded-full hover:bg-white/80 transition-colors group/btn"
                        title={isChecked ? "Mark as unread" : "Mark as read"}
                      >
                        {isChecked ? (
                          <CheckCircle2 className="w-6 h-6 text-green-500 group-hover/btn:scale-110 transition-transform" />
                        ) : (
                          <Circle className="w-6 h-6 text-slate-300 group-hover/btn:text-indigo-400 group-hover/btn:scale-110 transition-transform" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-900">
      <Routes>
        <Route path="/" element={<FileList />} />
        <Route path="/view" element={<HtmlViewer />} />
      </Routes>
    </div>
  );
}
