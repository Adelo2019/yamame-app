// アプリ全体: ログイン → 記録者名 → 画面切替(今日の記録 / 導入登録 / 確認)
import { useEffect, useState, type FormEvent } from 'react';
import { api, getRecorder, setRecorder, setUnauthorizedHandler } from './api';
import { Button, ErrorBox } from './ui';
import Today from './pages/Today';
import Intake from './pages/Intake';
import Status from './pages/Status';

type Tab = 'today' | 'intake' | 'status';
type Auth = 'checking' | 'loggedOut' | 'loggedIn' | 'notConfigured';

export default function App() {
  const [auth, setAuth] = useState<Auth>('checking');
  const [recorder, setRecorderState] = useState(getRecorder());
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('loggedOut'));
    api<{ loggedIn: boolean; configured: boolean }>('/api/auth/me')
      .then((r) => setAuth(!r.configured ? 'notConfigured' : r.loggedIn ? 'loggedIn' : 'loggedOut'))
      .catch(() => setAuth('loggedOut'));
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-xl px-4 pb-24">
      <header className="sticky top-0 z-10 -mx-4 mb-4 bg-[#0f3d3e] px-4 py-3 text-white">
        <h1 className="text-lg font-bold">ヤマメ養殖管理</h1>
        {auth === 'loggedIn' && recorder && <p className="text-xs opacity-80">記録者：{recorder}</p>}
      </header>

      {auth === 'checking' && <p className="text-sm text-stone-500">確認中…</p>}
      {auth === 'notConfigured' && (
        <ErrorBox message="パスコードがまだ設定されていません。Cloudflareの「変数とシークレット」で APP_PASSCODE を設定してください。" />
      )}
      {auth === 'loggedOut' && <Login onSuccess={() => setAuth('loggedIn')} />}
      {auth === 'loggedIn' && !recorder && (
        <RecorderForm onSave={(n) => { setRecorder(n); setRecorderState(n); }} />
      )}
      {auth === 'loggedIn' && recorder && (
        <>
          {tab === 'today' && <Today onGoIntake={() => setTab('intake')} />}
          {tab === 'intake' && <Intake onDone={() => setTab('today')} />}
          {tab === 'status' && <Status onLogout={() => setAuth('loggedOut')} />}
          <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto grid max-w-xl grid-cols-3">
              {([['today', '今日の記録'], ['intake', '導入登録'], ['status', '確認']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)}
                  className={`py-3.5 text-sm font-semibold ${tab === k ? 'text-[#0f3d3e]' : 'text-stone-400'}`}>
                  {tab === k && <span className="mx-auto mb-1 block h-0.5 w-8 rounded bg-[#0f3d3e]" />}
                  {label}
                </button>
              ))}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: { passcode: code } });
      onSuccess();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="mt-10 space-y-4">
      <p className="text-sm text-stone-600">パスコードを入力してください。この端末では次回から入力不要です。</p>
      <ErrorBox message={error} />
      <input type="password" inputMode="numeric" autoComplete="current-password" value={code}
        onChange={(e) => setCode(e.target.value)} autoFocus
        className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-center text-2xl tracking-widest" />
      <Button type="submit" className="w-full py-3.5 text-base" disabled={busy || !code}>{busy ? '確認中…' : '入る'}</Button>
    </form>
  );
}

function RecorderForm({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="mt-10 space-y-4">
      <p className="text-sm text-stone-600">この端末で記録する人の名前を入れてください。記録に「誰が入力したか」として残ります（後から「確認」画面で変更できます）。</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：佐々木" autoFocus
        className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-lg" />
      <Button className="w-full py-3.5 text-base" disabled={!name.trim()} onClick={() => onSave(name.trim())}>はじめる</Button>
    </div>
  );
}
