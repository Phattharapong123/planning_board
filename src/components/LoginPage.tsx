import { useState } from 'react';
import { Eye, EyeOff, User, Lock, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) { setError('กรุณากรอก Username และ Password'); return; }
    setLoading(true);
    const result = await login(username.trim(), password, remember);
    setLoading(false);
    if (!result.success) setError(result.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F5F4F2 0%, #EEECE9 100%)' }}>

      {/* Orange decorative shapes */}
      <div className="fixed top-0 left-0 pointer-events-none" style={{ width: 220, height: 220 }}>
        <div className="absolute" style={{
          width: 160, height: 60, background: '#F36B21', opacity: 0.85,
          transform: 'rotate(-35deg)', top: -20, left: -30, borderRadius: 4,
        }} />
        <div className="absolute" style={{
          width: 100, height: 40, background: '#F36B21', opacity: 0.5,
          transform: 'rotate(-35deg)', top: 40, left: -10, borderRadius: 4,
        }} />
        <div className="absolute" style={{
          width: 60, height: 24, background: '#F36B21', opacity: 0.3,
          transform: 'rotate(-35deg)', top: 80, left: 20, borderRadius: 4,
        }} />
      </div>
      <div className="fixed bottom-0 right-0 pointer-events-none" style={{ width: 220, height: 220 }}>
        <div className="absolute" style={{
          width: 160, height: 60, background: '#F36B21', opacity: 0.85,
          transform: 'rotate(-35deg)', bottom: -20, right: -30, borderRadius: 4,
        }} />
        <div className="absolute" style={{
          width: 100, height: 40, background: '#F36B21', opacity: 0.5,
          transform: 'rotate(-35deg)', bottom: 40, right: -10, borderRadius: 4,
        }} />
        <div className="absolute" style={{
          width: 60, height: 24, background: '#F36B21', opacity: 0.3,
          transform: 'rotate(-35deg)', bottom: 80, right: 20, borderRadius: 4,
        }} />
      </div>
      {/* UNC watermark */}
      <div className="fixed right-0 top-1/2 -translate-y-1/2 pointer-events-none select-none"
        style={{ fontSize: 220, fontWeight: 900, color: 'rgba(0,0,0,0.035)', lineHeight: 1, userSelect: 'none', transform: 'translateY(-50%) translateX(20%)' }}>
        UNC
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo above form */}
        <div className="flex flex-col items-center mb-8">
          <img src="/Logo_UNC.png" alt="UNC" className="h-20 w-auto object-contain mb-3 drop-shadow-sm" />
          <p className="text-gray-900 text-[13px] font-black tracking-[0.2em] uppercase mt-1">
            SMART PRODUCTION BOARD
          </p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-black/10 border border-gray-100 overflow-hidden">
          <div className="bg-[#0A0B0D] px-6 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#F36B21] flex items-center justify-center flex-shrink-0">
              <Lock size={14} className="text-white" />
            </div>
            <div className="text-white font-bold text-sm">เข้าสู่ระบบ</div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">Username</label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="กรอก Username" autoComplete="username"
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F36B21] focus:border-transparent placeholder:text-gray-300 transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="กรอก Password" autoComplete="current-password"
                  className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#F36B21] focus:border-transparent placeholder:text-gray-300 transition-all" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div onClick={() => setRemember(v => !v)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${remember ? 'bg-[#F36B21] border-[#F36B21]' : 'border-gray-300 bg-white'}`}>
                {remember && <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span className="text-sm text-gray-500">จดจำการเข้าสู่ระบบ</span>
            </label>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-xl flex items-center gap-2">
                <span className="font-black text-red-500 text-base leading-none flex-shrink-0">!</span>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-[#F36B21]/25 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed">
              <LogIn size={15} />
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-400 text-[11px] mt-5">
          © 2026 UNC Smart Production Board System<br />
          <span className="text-gray-300">Developed by Chawankorn.l PL Dep.</span>
        </p>
      </div>
    </div>
  );
}
