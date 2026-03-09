import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp, deleteDoc, collection } from 'firebase/firestore';
import { Heart, Cat, Share2, Calendar, Bell, CheckCircle, AlertTriangle, Info, Plus, Users, Trash2, X, RefreshCw, Copy, BellRing } from 'lucide-react';

/**
 * 【注意】Vercel Analyticsを有効にするには、実際の環境（VS Code等）で 
 * `npm install @vercel/analytics` を実行し、以下のコメントアウトを解除してください。
 */
// import { Analytics } from "@vercel/analytics/react";

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
  const [showReminder, setShowReminder] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState('default');

  // 【設定】24時間（24 * 60 * 60 * 1000 ミリ秒）
  const ALERT_THRESHOLD = 24 * 60 * 60 * 1000; 

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
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

  // 通知許可のリクエスト
  const requestPermission = async () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

    if (!("Notification" in window)) {
      if (isIOS && !isStandalone) {
        showToast("iPhoneは「ホーム画面に追加」すると通知が使えます！", "error");
      } else {
        showToast("このブラウザは通知に対応していません", "error");
      }
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        showToast("通知が有効になりました！");
      } else {
        showToast("通知がオフになっています。スマホの設定を確認してください。", "error");
      }
    } catch (e) {
      showToast("通知の設定中にエラーが発生しました", "error");
    }
  };

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
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. 自分の状態監視
  useEffect(() => {
    if (!user || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'status', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSafetyData(data);
        if (data.name) setUserName(prev => (prev === '' ? data.name : prev));
        
        // 24時間以上経過チェック
        if (data.lastCheckIn) {
          const lastDate = data.lastCheckIn.toDate ? data.lastCheckIn.toDate() : new Date(data.lastCheckIn);
          if (Date.now() - lastDate.getTime() > ALERT_THRESHOLD) {
            setShowReminder(true);
          } else {
            setShowReminder(false);
          }
        }
      } else {
        setShowReminder(true); 
      }
    }, (err) => console.error(err));
    return () => unsubscribe();
  }, [user]);

  // 3. 見守りリスト監視 & 通知ロジック
  useEffect(() => {
    if (!user || !db || (view !== 'watch' && view !== 'add')) return;
    const followingCol = collection(db, 'artifacts', appId, 'users', user.uid, 'following');
    const statusListeners = {};
    const statusMap = {};

    const sortAndSetList = (currentMap) => {
      const list = Object.values(currentMap).filter(item => item !== null);
      // 【並び順】連絡が古い順（時間が経過している人を上）
      list.sort((a, b) => {
        const getTs = (t) => t?.lastCheckIn?.toDate ? t.lastCheckIn.toDate().getTime() : 0;
        return getTs(a) - getTs(b);
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
            const prevData = statusMap[id];
            const newData = sDoc.exists() ? sDoc.data() : { uid: id, name: '未登録', isPending: true };
            statusMap[id] = newData;

            // 状態が変わって「連絡が来ていない」状態になった時にスマホ通知を送る
            if (prevData && !prevData.isPending && sDoc.exists()) {
              const lastDate = newData.lastCheckIn?.toDate ? newData.lastCheckIn.toDate() : new Date(newData.lastCheckIn);
              const isLate = Date.now() - lastDate.getTime() > ALERT_THRESHOLD;
              
              if (isLate && Notification.permission === 'granted') {
                new Notification("みまもり。連絡アラート", {
                  body: `${newData.name || '名前なし'}さんから24時間以上連絡がありません。`,
                  icon: "/apple-touch-icon.png"
                });
              }
            }
            
            sortAndSetList(statusMap);
          }, (err) => console.error(err));
        }
      });
      if (newIds.length === 0) setWatchingList([]);
    }, (err) => console.error(err));

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
      showToast("元気を報告しました！");
      setShowReminder(false);
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
    
    // 24時間判定
    if (diff > ALERT_THRESHOLD) {
      return { label: '連絡が来ていません', color: 'text-rose-500', bg: 'bg-rose-50', icon: <Bell size={18} className="animate-pulse" /> };
    }
    
    return { label: '元気です', color: 'text-emerald-500', bg: 'bg-emerald-50', icon: <CheckCircle size={18} /> };
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-white font-bold text-slate-400 uppercase text-xs tracking-widest">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-28">
      {/* 通知トースト */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-4 rounded-3xl shadow-2xl text-white font-bold text-xs transition-all w-[80%] max-w-xs text-center animate-in fade-in slide-in-from-top-4 ${toast.type === 'error' ? 'bg-rose-500' : 'bg-indigo-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* 24時間超過ポップアップ */}
      {view === 'report' && showReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-xs rounded-[2.5rem] p-8 text-center shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Cat className="text-rose-500 w-10 h-10" />
            </div>
            <h2 className="text-lg font-black text-slate-900 mb-2">おひさしぶり！</h2>
            <p className="text-xs text-slate-500 font-bold mb-8 leading-relaxed">最後に報告してから24時間が経ちました。みんなを安心させてあげてね。</p>
            <button onClick={() => setShowReminder(false)} className="w-full bg-rose-500 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-rose-100 active:scale-95 transition-all">わかった！</button>
          </div>
        </div>
      )}

      <header className="bg-white px-6 py-6 text-center border-b border-slate-100 sticky top-0 z-30 shadow-sm flex items-center justify-center gap-2">
        <Cat className="text-indigo-600" size={24} />
        <h1 className="text-lg font-black tracking-tighter text-slate-900 uppercase">みまもり。</h1>
      </header>

      <main className="max-w-md mx-auto p-4">
        {view === 'report' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* 通知設定カード */}
            {notificationPermission !== 'granted' && (
              <section className="bg-indigo-50 rounded-3xl p-6 border border-indigo-100 flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-indigo-600 shadow-sm">
                  <BellRing size={24} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-black text-indigo-900 mb-1">通知を有効にしますか？</p>
                  <p className="text-[10px] text-indigo-600 font-bold leading-tight">iPhoneはホーム画面に追加して起動してください。</p>
                </div>
                <button 
                  onClick={requestPermission}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-lg active:scale-95 transition-all"
                >
                  有効にする
                </button>
              </section>
            )}

            <section className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100 text-center">
              <div className="mb-6 text-left">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest block mb-2 px-1">Display Name</label>
                <input type="text" placeholder="名前を入力" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full text-center text-xl font-bold bg-slate-50 border-none rounded-2xl py-4 focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              
              <button onClick={handleReport} className="group w-44 h-44 mx-auto flex flex-col items-center justify-center bg-indigo-600 text-white rounded-full shadow-2xl active:scale-95 transition-all border-8 border-indigo-50 relative">
                <Heart className="w-16 h-16 fill-white mb-2" />
                <span className="font-black text-lg">元気です！</span>
                {showReminder && <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] px-3 py-1 rounded-full animate-bounce font-black shadow-lg">報告して！</span>}
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
                        <p className={`text-sm font-black truncate ${getStatus(t).label === '連絡が来ていません' ? 'text-rose-600' : 'text-slate-800'}`}>{t.name || '名前なし'}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className={`text-[10px] font-bold ${getStatus(t).color}`}>{getStatus(t).label}</p>
                          <span className="text-slate-200 text-[10px]">|</span>
                          <p className={`text-[10px] font-mono font-bold truncate ${getStatus(t).label === '連絡が来ていません' ? 'text-rose-400' : 'text-slate-400'}`}>{formatTimestamp(t.lastCheckIn)}</p>
                        </div>
                      </div>
                    </div>
                    <button onClick={async () => {
                      if (!user) return;
                      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'following', t.uid));
                      showToast("解除しました");
                    }} className="p-2 text-slate-200 hover:text-rose-400 transition-colors">
                      <Trash2 size={18} />
                    </button>
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
                if (!targetId.trim() || !user) return;
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