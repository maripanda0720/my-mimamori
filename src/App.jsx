import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { Heart, Clock, ShieldCheck, Share2, Search, User, AlertTriangle, CheckCircle2, Plus, Users, Trash2, X, RefreshCw, Calendar } from 'lucide-react';

// --- Firebase Configuration ---
const getSafeConfig = () => {
  // プレビュー環境用の設定
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    try { return JSON.parse(__firebase_config); } catch (e) { console.error(e); }
  }
  // あなたのプロジェクト設定（Vercel公開時に使用されます）
  return {
    apiKey: "AIzaSyCoa6sKhtNAl-8cnk09rOjeh1CUrwlfjO8",
    authDomain: "mimamori-379e5.firebaseapp.com",
    projectId: "mimamori-379e5",
    storageBucket: "mimamori-379e5.firebasestorage.app",
    messagingSenderId: "310666421471",
    appId: "1:310666421471:web:8a65473f3fc254d9f2756a",
    measurementId: "G-VCERL7EFNP"
  };
};

const firebaseConfig = getSafeConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'my-mimamori-v1';

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('report'); // 'report', 'watch', 'add'
  const [userName, setUserName] = useState('');
  const [targetId, setTargetId] = useState('');
  const [safetyData, setSafetyData] = useState(null);
  const [watchingList, setWatchingList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const HOURS_24 = 24 * 60 * 60 * 1000;
  const HOURS_48 = 48 * 60 * 60 * 1000;

  // 1. 認証の初期化
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) { 
        console.error("Auth Error:", error); 
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. 自分のデータ同期
  useEffect(() => {
    if (!user || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'status', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSafetyData(data);
        if (data.name) setUserName(prev => prev === '' ? data.name : prev);
      }
    }, (err) => console.error("Firestore Error (Self):", err));
    return () => unsubscribe();
  }, [user]);

  // 3. 見守りリストの同期
  useEffect(() => {
    if (!user || !db || view !== 'watch') return;
    const followingCol = collection(db, 'artifacts', appId, 'users', user.uid, 'following');
    const statusMap = {};
    const statusListeners = {};

    const sortAndSet = (currentMap) => {
      const list = Object.values(currentMap).filter(item => item !== null);
      list.sort((a, b) => {
        const getTs = (t) => {
          if (!t?.lastCheckIn) return 0;
          return t.lastCheckIn.toDate ? t.lastCheckIn.toDate().getTime() : new Date(t.lastCheckIn).getTime();
        };
        return getTs(b) - getTs(a);
      });
      setWatchingList(list);
    };

    const unsubscribeFollowing = onSnapshot(followingCol, (snapshot) => {
      const ids = snapshot.docs.map(d => d.id);
      
      Object.keys(statusListeners).forEach(id => {
        if (!ids.includes(id)) {
          if (statusListeners[id]) statusListeners[id]();
          delete statusListeners[id];
          delete statusMap[id];
        }
      });

      ids.forEach(id => {
        if (!statusListeners[id]) {
          const targetRef = doc(db, 'artifacts', appId, 'public', 'data', 'status', id);
          statusListeners[id] = onSnapshot(targetRef, (sDoc) => {
            statusMap[id] = sDoc.exists() ? sDoc.data() : { uid: id, name: '未報告', isPending: true };
            sortAndSet(statusMap);
          }, (err) => console.error(`Snapshot Error (${id}):`, err));
        }
      });
      if (ids.length === 0) setWatchingList([]);
    }, (err) => console.error("Following Sync Error:", err));

    return () => {
      unsubscribeFollowing();
      Object.values(statusListeners).forEach(u => u());
    };
  }, [user, view]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleReport = async () => {
    if (!user || !db) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'status', user.uid);
      await setDoc(docRef, {
        uid: user.uid,
        name: userName || '匿名ユーザー',
        lastCheckIn: serverTimestamp(),
      }, { merge: true });
      showToast("「元気です！」を報告しました");
    } catch (e) { 
      console.error(e);
      showToast("報告に失敗しました");
    }
  };

  const formatTs = (ts) => {
    if (!ts) return '報告なし';
    try {
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(date.getTime())) return '更新中...';
      return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '更新中...';
    }
  };

  const getStatus = (target) => {
    if (!target?.lastCheckIn || target.isPending) {
      return { label: '未確認', color: 'text-slate-400', bg: 'bg-slate-100', icon: <Clock size={18} /> };
    }
    try {
      const date = target.lastCheckIn.toDate ? target.lastCheckIn.toDate() : new Date(target.lastCheckIn);
      const diff = Date.now() - date.getTime();
      if (diff < HOURS_24) return { label: '良好', color: 'text-emerald-500', bg: 'bg-emerald-50', icon: <CheckCircle2 size={18} /> };
      if (diff < HOURS_48) return { label: '注意', color: 'text-amber-500', bg: 'bg-amber-50', icon: <AlertTriangle size={18} /> };
      return { label: '警告', color: 'text-rose-500', bg: 'bg-rose-50', icon: <AlertTriangle size={18} className="animate-pulse" /> };
    } catch (e) {
      return { label: '同期中', color: 'text-slate-300', bg: 'bg-slate-50', icon: <RefreshCw size={18} className="animate-spin" /> };
    }
  };

  if (loading) return (
    <div className="flex h-screen flex-col items-center justify-center bg-white">
      <RefreshCw className="animate-spin text-indigo-600 mb-4" size={32} />
      <p className="font-bold text-slate-400">読み込み中...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-28">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-indigo-600 text-white rounded-full shadow-2xl font-bold text-xs animate-in fade-in slide-in-from-top-4">
          {toast}
        </div>
      )}

      <header className="bg-white border-b border-slate-100 px-6 py-6 sticky top-0 z-30 shadow-sm">
        <div className="max-w-md mx-auto flex items-center justify-center gap-2">
          <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-md">
            <ShieldCheck size={20} />
          </div>
          <h1 className="text-xl font-black tracking-tighter uppercase text-slate-900">みまもり。</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4">
        {view === 'report' && (
          <div className="animate-in fade-in duration-500 space-y-6">
            <div className="bg-white rounded-[2.5rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-50 text-center">
              <div className="mb-8 text-left">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest block mb-2 px-1">Display Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="お名前を入力"
                  className="w-full bg-slate-50 border-none rounded-2xl py-4 px-6 text-lg font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-inner"
                />
              </div>

              <button
                onClick={handleReport}
                className="group relative w-44 h-44 mx-auto flex flex-col items-center justify-center bg-indigo-600 text-white rounded-full shadow-2xl shadow-indigo-200 active:scale-90 transition-all border-[10px] border-indigo-50"
              >
                <Heart className="w-14 h-14 fill-white mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-black text-lg">元気です！</span>
              </button>

              <div className="mt-10 pt-6 border-t border-slate-50 flex flex-col items-center">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Last Update</p>
                <p className="text-sm font-mono font-bold text-slate-600">{formatTs(safetyData?.lastCheckIn)}</p>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
              <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
                <Share2 size={14} /> 共有用ID
              </p>
              <div className="bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200 font-mono text-[9px] break-all leading-relaxed text-slate-500 select-all">
                {user?.uid}
              </div>
            </div>
          </div>
        )}

        {view === 'watch' && (
          <div className="animate-in fade-in space-y-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-lg font-black flex items-center gap-2 text-slate-800">
                <Users size={20} className="text-indigo-600" /> みまもりリスト
              </h2>
              <button 
                onClick={() => setView('add')} 
                className="bg-indigo-600 text-white p-2.5 rounded-full shadow-lg active:scale-95 transition-all"
              >
                <Plus size={20} />
              </button>
            </div>

            {watchingList.length === 0 ? (
              <div className="bg-white rounded-[2rem] p-12 text-center border border-dashed border-slate-200 shadow-inner">
                <User className="text-slate-200 mx-auto mb-4" size={48} />
                <p className="text-sm font-bold text-slate-400 italic">まだ誰も登録されていません</p>
              </div>
            ) : (
              <div className="space-y-3">
                {watchingList.map(t => (
                  <div key={t.uid} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center justify-between group animate-in slide-in-from-bottom-2">
                    <div className="flex items-center gap-4 overflow-hidden flex-1">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${getStatus(t).bg} ${getStatus(t).color}`}>
                        {getStatus(t).icon}
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-slate-800 truncate text-sm">{t.name || '名前なし'}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className={`text-[10px] font-bold ${getStatus(t).color}`}>{getStatus(t).label}</p>
                          <span className="text-slate-200 text-[10px]">|</span>
                          <p className="text-[10px] font-bold text-slate-400 font-mono truncate">{formatTs(t.lastCheckIn)}</p>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={async () => {
                        if (!user) return;
                        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'following', t.uid));
                        showToast("解除しました");
                      }} 
                      className="p-2 text-slate-200 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'add' && (
          <div className="animate-in zoom-in-95 duration-300">
            <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 relative">
              <button onClick={() => setView('watch')} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500">
                <X size={24} />
              </button>
              <h3 className="text-xl font-black mb-6 flex items-center gap-2 text-slate-800">
                <Plus className="text-indigo-600" /> IDで追加する
              </h3>
              <p className="text-xs text-slate-400 mb-6 font-medium leading-relaxed">
                相手から送られてきたIDをここに貼り付けてください。
              </p>
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="IDをペースト"
                className="w-full bg-slate-50 border-none rounded-2xl py-4 px-6 text-[10px] font-mono mb-6 focus:ring-2 focus:ring-indigo-500 outline-none shadow-inner"
              />
              <button
                onClick={async () => {
                  if (!targetId.trim() || !user) return;
                  try {
                    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'following', targetId.trim()), { 
                      addedAt: serverTimestamp() 
                    });
                    showToast("リストに追加しました");
                    setTargetId('');
                    setView('watch');
                  } catch (e) {
                    showToast("追加に失敗しました");
                  }
                }}
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-indigo-100 active:scale-95 transition-all"
              >
                登録する
              </button>
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-sm bg-white/80 backdrop-blur-xl border border-white/50 shadow-2xl rounded-[2.5rem] p-2 flex gap-1 items-center z-40">
        <button
          onClick={() => setView('report')}
          className={`flex-1 flex flex-col items-center py-3 rounded-full transition-all duration-300 ${view === 'report' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-300'}`}
        >
          <Calendar size={20} />
          <span className="text-[9px] font-black mt-1 uppercase tracking-tighter">Report</span>
        </button>
        <button
          onClick={() => setView('watch') || setView('add')}
          className={`flex-1 flex flex-col items-center py-3 rounded-full transition-all duration-300 ${view === 'watch' || view === 'add' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-300'}`}
        >
          <Users size={20} />
          <span className="text-[9px] font-black mt-1 uppercase tracking-tighter">List</span>
        </button>
      </nav>
    </div>
  );
};

export default App;