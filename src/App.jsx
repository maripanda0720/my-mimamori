import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp, deleteDoc, collection } from 'firebase/firestore';
import { Heart, ShieldCheck, Share2, Calendar, Bell, CheckCircle, AlertTriangle, Info, Plus, Users, Trash2, X, RefreshCw, Copy } from 'lucide-react';

// --- Firebase 設定 ---
const firebaseConfig = (() => {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    try {
      return JSON.parse(__firebase_config);
    } catch (e) {
      console.error("Firebase config parse error:", e);
    }
  }
  return {
    apiKey: "AIzaSyCoa6sKhtNAl-8cnk09rOjeh1CUrwlfjO8",
    authDomain: "mimamori-379e5.firebaseapp.com",
    projectId: "mimamori-379e5",
    storageBucket: "mimamori-379e5.firebasestorage.app",
    messagingSenderId: "310666421471",
    appId: "1:310666421471:web:8a65473f3fc254d9f2756a",
    measurementId: "G-VCERL7EFNP"
  };
})();

const appId = typeof __app_id !== 'undefined' ? __app_id : 'my-mimamori-v1';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('report'); 
  const [userName, setUserName] = useState('');
  const [targetId, setTargetId] = useState('');
  const [safetyData, setSafetyData] = useState(null);
  const [watchingList, setWatchingList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const HOURS_24 = 24 * 60 * 60 * 1000;
  const HOURS_48 = 48 * 60 * 60 * 1000;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    try {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      showToast("IDをコピーしました！");
    } catch (err) {
      showToast("コピーに失敗しました", "error");
    }
  };

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

  useEffect(() => {
    if (!user || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'status', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSafetyData(data);
        if (data.name) setUserName(prev => (prev === '' ? data.name : prev));
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !db || (view !== 'watch' && view !== 'add')) return;
    const followingCol = collection(db, 'artifacts', appId, 'users', user.uid, 'following');
    const statusListeners = {};
    const statusMap = {};

    const sortAndSetList = (currentMap) => {
      const list = Object.values(currentMap).filter(item => item !== null);
      list.sort((a, b) => {
        const getTs = (t) => t?.lastCheckIn?.toDate ? t.lastCheckIn.toDate().getTime() : 0;
        return getTs(b) - getTs(a);
      });
      setWatchingList(list);
    };

    const unsubscribeFollowing = onSnapshot(followingCol, (snapshot) => {
      const newIds = snapshot.docs.map(d => d.id);
      Object.keys(statusListeners).forEach(id => {
        if (!newIds.includes(id)) {
          if (statusListeners[id]) statusListeners[id]();
          delete statusListeners[id];
          delete statusMap[id];
        }
      });
      newIds.forEach(id => {
        if (!statusListeners[id]) {
          const targetDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'status', id);
          statusListeners[id] = onSnapshot(targetDocRef, (sDoc) => {
            statusMap[id] = sDoc.exists() ? sDoc.data() : { uid: id, name: '未登録', isPending: true };
            sortAndSetList(statusMap);
          });
        }
      });
      if (newIds.length === 0) setWatchingList([]);
    });
    return () => {
      unsubscribeFollowing();
      Object.values(statusListeners).forEach(unsub => unsub());
    };
  }, [user, view]);

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
    } catch (err) {
      showToast("報告に失敗しました", "error");
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '報告なし';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getStatus = (target) => {
    if (!target || target.isPending || !target.lastCheckIn) return { label: '未確認', color: 'text-slate-400', bg: 'bg-slate-100', icon: <Info size={18} /> };
    const date = target.lastCheckIn.toDate ? target.lastCheckIn.toDate() : new Date(target.lastCheckIn);
    const diff = Date.now() - date.getTime();
    if (diff < HOURS_24) return { label: '良好', color: 'text-emerald-500', bg: 'bg-emerald-50', icon: <CheckCircle size={18} /> };
    if (diff < HOURS_48) return { label: '注意', color: 'text-amber-500', bg: 'bg-amber-50', icon: <AlertTriangle size={18} /> };
    return { label: '警告', color: 'text-rose-500', bg: 'bg-rose-50', icon: <Bell size={18} className="animate-pulse" /> };
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-white font-bold text-slate-400 uppercase text-xs tracking-widest">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-28">
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full shadow-2xl text-white font-bold text-xs transition-all ${toast.type === 'error' ? 'bg-rose-500' : 'bg-indigo-600'}`}>
          {toast.msg}
        </div>
      )}

      <header className="bg-white px-6 py-6 text-center border-b border-slate-100 sticky top-0 z-30 shadow-sm flex items-center justify-center gap-2">
        <ShieldCheck className="text-indigo-600" size={24} />
        <h1 className="text-lg font-black tracking-tighter text-slate-900 uppercase">みまもり。</h1>
      </header>

      <main className="max-w-md mx-auto p-4">
        {view === 'report' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <section className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100 text-center">
              <div className="mb-6 text-left">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest block mb-2 px-1">Display Name</label>
                <input type="text" placeholder="名前を入力" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full text-center text-xl font-bold bg-slate-50 border-none rounded-2xl py-4 focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <button onClick={handleReport} className="group w-44 h-44 mx-auto flex flex-col items-center justify-center bg-indigo-600 text-white rounded-full shadow-2xl active:scale-95 transition-all border-8 border-indigo-50">
                <Heart className="w-16 h-16 fill-white mb-2" />
                <span className="font-black text-lg">元気です！</span>
              </button>
              <div className="mt-8 bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col items-center">
                <p className="text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-widest">Last Update</p>
                <p className="text-sm font-black text-slate-700 font-mono">{formatTimestamp(safetyData?.lastCheckIn)}</p>
              </div>
            </section>
            <section className="bg-white rounded-3xl p-6 shadow-md border border-slate-100">
              <p className="text-xs font-bold text-slate-400 mb-4 flex items-center gap-2"><Share2 size={14} /> あなたのID（共有用）</p>
              <div className="flex items-center gap-2 bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200">
                <div className="flex-1 font-mono text-[9px] text-slate-500 break-all select-all">{user?.uid}</div>
                <button onClick={() => copyToClipboard(user?.uid)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Copy size={16} /></button>
              </div>
            </section>
          </div>
        )}

        {view === 'watch' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-base font-black flex items-center gap-2 text-slate-900"><Users size={18} className="text-indigo-600" /> みまもりリスト</h2>
              <button onClick={() => setView('add')} className="bg-indigo-600 text-white p-2.5 rounded-full shadow-lg active:scale-95 transition-all"><Plus size={20} /></button>
            </div>
            {watchingList.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-dashed border-slate-200 text-slate-400 italic text-xs font-bold shadow-inner">まだ誰も登録されていません</div>
            ) : (
              <div className="grid gap-3">
                {watchingList.map((t) => (
                  <div key={t.uid} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center justify-between group">
                    <div className="flex items-center gap-3 overflow-hidden flex-1">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${getStatus(t).bg} ${getStatus(t).color}`}>{getStatus(t).icon}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">{t.name || '名前なし'}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className={`text-[10px] font-bold ${getStatus(t).color}`}>{getStatus(t).label}</p>
                          <span className="text-slate-200 text-[10px]">|</span>
                          <p className="text-[10px] font-mono font-bold text-slate-400 truncate">{formatTimestamp(t.lastCheckIn)}</p>
                        </div>
                      </div>
                    </div>
                    <button onClick={async () => {
                      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'following', t.uid));
                      showToast("削除しました");
                    }} className="p-2 text-slate-200 hover:text-rose-400 transition-colors"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'add' && (
          <div className="animate-in zoom-in-95 duration-200">
            <section className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100 relative">
              <button onClick={() => setView('watch')} className="absolute top-6 right-6 text-slate-300 hover:text-slate-500"><X size={20} /></button>
              <h3 className="font-black text-slate-800 flex items-center gap-2 mb-6"><Plus size={18} className="text-indigo-600" /> IDを登録する</h3>
              <input type="text" placeholder="IDをペースト" value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-100 rounded-2xl px-5 py-4 text-[10px] font-mono outline-none mb-6 shadow-inner" />
              <button onClick={async () => {
                if (!targetId.trim()) return;
                await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'following', targetId.trim()), { addedAt: serverTimestamp() });
                setTargetId('');
                setView('watch');
                showToast("追加しました");
              }} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all">リストに追加する</button>
            </section>
          </div>
        )}
      </main>

      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-white bg-opacity-80 backdrop-blur-xl border border-white shadow-2xl rounded-[2.5rem] p-2 flex gap-1 items-center z-40">
        <button onClick={() => setView('report')} className={`flex-1 flex flex-col items-center py-3 rounded-full transition-all duration-300 ${view === 'report' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}>
          <Calendar size={20} />
          <span className="text-[9px] font-black mt-1 uppercase">Report</span>
        </button>
        <button onClick={() => setView('watch')} className={`flex-1 flex flex-col items-center py-3 rounded-full transition-all duration-300 ${view === 'watch' || view === 'add' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}>
          <Users size={20} />
          <span className="text-[9px] font-black mt-1 uppercase">List</span>
        </button>
      </nav>
    </div>
  );
};

export default App;