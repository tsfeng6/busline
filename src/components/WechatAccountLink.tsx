import { useEffect, useState } from 'react';
import { endGameSession, getGameAccount, passwordLogin, updateGameProfile, type GameAccount } from '../utils/gameAccount';

const gateway = (import.meta.env.VITE_GAME_GATEWAY_URL || import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || '').replace(/\/$/, '');

export function WechatAccountLink({ account, accessToken, onSignedIn, onLogout }: { account: GameAccount | null; accessToken: string; onSignedIn: (account: GameAccount, accessToken: string) => void; onLogout: () => void }) {
  const query = new URLSearchParams(window.location.search);
  const registrationToken = query.get('wechat') === 'register' ? query.get('token') || '' : '';
  const [open, setOpen] = useState(Boolean(registrationToken));
  const [mode, setMode] = useState<'qr' | 'password' | 'register'>(registrationToken ? 'register' : 'qr');
  const [scene, setScene] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [remoteAvatar, setRemoteAvatar] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const begin = async () => {
    if (!gateway) throw Error('账号服务尚未配置。');
    const response = await fetch(gateway + '/wechat/qr-login', { method: 'POST', credentials: 'include' });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || '暂时无法生成登录二维码。');
    setScene(body.scene); setQrUrl(body.qrUrl);
    setMessage('请用微信扫描二维码。已注册用户将自动登录；首次使用会在公众号收到注册链接。');
  };
  useEffect(() => { if (open && mode === 'qr' && !account) void begin().catch((error: any) => setMessage(error.message)); }, [open, mode, account]);
  useEffect(() => { const show = () => { setOpen(true); setMode('qr'); }; window.addEventListener('busline-account', show); return () => window.removeEventListener('busline-account', show); }, []);
  useEffect(() => {
    if (!open || mode !== 'qr' || !scene || account) return;
    const timer = window.setInterval(async () => { try { const response = await fetch(`${gateway}/wechat/qr-login?scene=${encodeURIComponent(scene)}`, { credentials: 'include' }), body = await response.json(); if (body.actionUrl) window.location.assign(body.actionUrl); } catch {} }, 1800);
    return () => clearInterval(timer);
  }, [open, mode, scene, account]);
  useEffect(() => {
    if (!registrationToken) return;
    void fetch(`${gateway}/wechat/registration?token=${encodeURIComponent(registrationToken)}`, { credentials: 'include' }).then(async response => { const body = await response.json(); if (!response.ok) throw Error(body.error); setName(body.nickname || '巴士玩家'); setRemoteAvatar(body.avatarUrl || ''); }).catch((error: any) => setMessage(error.message || '注册链接无效或已过期。'));
  }, [registrationToken]);

  const save = async () => { try { const result = await updateGameProfile(name || account!.displayName, avatar || undefined, accessToken); onSignedIn(result.account, accessToken); setAvatar(null); setMessage('资料已保存。'); } catch (error: any) { setMessage(error.message || '保存失败。'); } };
  const loginWithPassword = async () => { try { await passwordLogin(accountName, password); const result = await getGameAccount(); onSignedIn(result.account, 'cookie'); setOpen(false); } catch (error: any) { setMessage(error.message || '登录失败。'); } };
  const register = async () => { try { if (password !== confirmPassword) throw Error('两次密码输入不一致。'); const response = await fetch(`${gateway}/wechat/registration?token=${encodeURIComponent(registrationToken)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountName, displayName: name, password }) }), body = await response.json(); if (!response.ok) throw Error(body.error || '注册失败。'); window.location.assign(body.actionUrl); } catch (error: any) { setMessage(error.message || '注册失败。'); } };
  const logout = async () => { try { await endGameSession(); } finally { onLogout(); setOpen(false); } };

  const loginPanel = mode === 'password' ? <><h2 className="text-lg font-black">账号密码登录</h2><input value={accountName} onChange={event => setAccountName(event.target.value.toLowerCase())} placeholder="登录账号" className="w-full rounded-xl border px-3 py-2" /><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="密码" className="w-full rounded-xl border px-3 py-2" /><button onClick={() => void loginWithPassword()} className="w-full rounded-xl bg-m3-primary py-2 font-bold text-white">登录</button><button onClick={() => { setMode('qr'); setMessage(''); }} className="w-full text-sm text-m3-primary">使用微信扫码登录</button></> : <><h2 className="text-lg font-black">微信扫码登录</h2>{qrUrl ? <img src={qrUrl} alt="微信登录二维码" className="mx-auto h-52 w-52" /> : <div className="mx-auto h-52 w-52 animate-pulse rounded-2xl bg-slate-100" />}<p className="text-sm text-slate-600">已注册：扫码后自动登录。首次使用：公众号会发送注册链接。</p><button onClick={() => void begin().catch((error: any) => setMessage(error.message))} className="w-full text-sm text-m3-primary">刷新二维码</button><button onClick={() => { setMode('password'); setMessage(''); }} className="w-full text-sm text-slate-500">账号密码登录</button></>;
  const registerPanel = <><h2 className="text-lg font-black">完成注册</h2><p className="text-sm text-slate-500">昵称和头像已从微信预填写；登录账号用于以后账号密码登录。</p>{remoteAvatar && <img src={remoteAvatar} alt="微信头像" className="mx-auto h-16 w-16 rounded-full object-cover" />}<input value={accountName} onChange={event => setAccountName(event.target.value.toLowerCase())} placeholder="登录账号（小写字母、数字或下划线）" className="w-full rounded-xl border px-3 py-2" /><input value={name} onChange={event => setName(event.target.value)} placeholder="昵称" className="w-full rounded-xl border px-3 py-2" /><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="设置密码（至少 8 位）" className="w-full rounded-xl border px-3 py-2" /><input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="再次输入密码" className="w-full rounded-xl border px-3 py-2" /><button onClick={() => void register()} className="w-full rounded-xl bg-m3-primary py-2 font-bold text-white">注册并登录</button></>;

  return <><button type="button" aria-label="账号" onClick={() => { setOpen(true); setMode('qr'); setMessage(''); setName(account?.displayName || ''); }} className="pointer-events-auto fixed right-5 top-5 z-[110] h-12 w-12 overflow-hidden rounded-full border-2 border-white bg-m3-primary shadow-lg">{account?.avatarUrl ? <img src={account.avatarUrl} alt="用户头像" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-lg font-black text-white">人</span>}</button>{open && <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/65 p-4"><div className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl"><button type="button" onClick={() => setOpen(false)} className="float-right text-xl text-slate-400">×</button>{account ? <><h2 className="text-lg font-black">账号管理</h2><p className="text-sm text-slate-500">已登录：{account.displayName}</p><input value={name} onChange={event => setName(event.target.value)} placeholder="昵称" className="w-full rounded-xl border px-3 py-2" /><input type="file" accept="image/*" onChange={event => setAvatar(event.target.files?.[0] || null)} className="w-full text-xs" /><button onClick={() => void save()} className="w-full rounded-xl bg-m3-primary py-2 font-bold text-white">保存资料</button><button onClick={() => void logout()} className="w-full text-sm text-slate-500">退出登录</button></> : mode === 'register' ? registerPanel : loginPanel}{message && <p className="text-xs text-slate-500">{message}</p>}</div></div>}</>;
}
