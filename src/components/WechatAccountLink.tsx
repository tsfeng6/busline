import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { compressAvatar, deleteGameAccount, endGameSession, passwordLogin, updateGameProfile, type GameAccount } from '../utils/gameAccount';

const gateway = (import.meta.env.VITE_GAME_GATEWAY_URL || import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || '').replace(/\/$/, '');
type AccountTab = 'profile' | 'general' | 'about';
const avatarInitials = (name: string) => { const value = name.trim() || '人'; return /^[A-Za-z]/.test(value) ? (value.match(/[A-Za-z]/g)?.join('').slice(0, 2).toUpperCase() || '人') : value.slice(0, 1); };

function Avatar({ name, image, className = '' }: { name: string; image?: string; className?: string }) {
  return <div className={`overflow-hidden rounded-full bg-m3-primary text-white shadow-sm ${className}`}>{image ? <img src={image} alt="用户头像" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center font-black">{avatarInitials(name)}</span>}</div>;
}

export function getWechatRegistrationToken() {
  const query = new URLSearchParams(window.location.search), fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return (query.get('wechat') === 'register' ? query.get('token') : fragment.get('wechat') === 'register' ? fragment.get('token') : '') || '';
}

type AccountCardProps = {
  account: GameAccount | null;
  accessToken: string;
  authLoading: boolean;
  open: boolean;
  tab: AccountTab;
  onTabChange: (tab: AccountTab) => void;
  onOpen: () => void;
  onClose: () => void;
  onSignedIn: (account: GameAccount, accessToken: string) => void;
  onLogout: () => void;
  children: ReactNode;
};

export function WechatAccountLink({ account, accessToken, authLoading, open, tab, onTabChange, onOpen, onClose, onSignedIn, onLogout, children }: AccountCardProps) {
  const registrationToken = getWechatRegistrationToken();
  const [mode, setMode] = useState<'qr' | 'password' | 'register'>(registrationToken ? 'register' : 'qr');
  const [message, setMessage] = useState(''), [name, setName] = useState(''), [avatar, setAvatar] = useState<File | null>(null), [avatarPreview, setAvatarPreview] = useState('');
  const [accountName, setAccountName] = useState(''), [password, setPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState(''), [loginCode, setLoginCode] = useState('');
  const [busy, setBusy] = useState<'save' | 'register' | 'login' | 'logout' | 'delete' | null>(null), [deleteConfirm, setDeleteConfirm] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const close = () => {
    if (busy) return;
    onClose();
    setMessage('');
    setDeleteConfirm(false);
  };
  const chooseAvatar = (file?: File | null) => { if (!file) return; if (!file.type.startsWith('image/')) { setMessage('请选择图片文件。'); return; } setAvatar(file); setAvatarPreview(URL.createObjectURL(file)); setMessage(''); };
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  useEffect(() => { if (!registrationToken) return; void fetch(`${gateway}/wechat/registration?token=${encodeURIComponent(registrationToken)}`, { credentials: 'include' }).then(async response => { const body = await response.json(); if (!response.ok) throw Error(body.error); setName(body.nickname || '巴士玩家'); }).catch((error: any) => setMessage(error.message || '注册链接无效或已过期。')); }, [registrationToken]);

  const save = async () => { try { setBusy('save'); setMessage(avatar ? '正在上传头像并保存资料…' : '正在保存资料…'); const result = await updateGameProfile(name || account!.displayName, avatar || undefined, accessToken); onSignedIn(result.account, accessToken); setAvatar(null); setAvatarPreview(''); setMessage('资料已保存。'); } catch (error: any) { setMessage(error.message || '保存失败。'); } finally { setBusy(null); } };
  const loginWithPassword = async () => {
    setBusy('login');
    setMessage('正在登录…');
    try {
      const { account: signedInAccount } = await passwordLogin(accountName, password);
      onSignedIn(signedInAccount, 'cookie');
      setPassword('');
      setMessage('');
    } catch (error: any) {
      setMessage(error.message || '登录失败。');
    } finally {
      setBusy(null);
    }
  };
  const confirmWechatCode = async () => { try { setBusy('login'); setMessage('正在核验登录码…'); if (!gateway) throw Error('账号服务尚未配置。'); const response = await fetch(`${gateway}/wechat/web-login?code=${encodeURIComponent(loginCode.trim().toUpperCase())}`, { credentials: 'include' }), body = await response.json(); if (!response.ok) throw Error(body.error || '登录码无效。'); if (!body.actionUrl) throw Error('登录码无效或已过期。'); window.location.assign(body.actionUrl); } catch (error: any) { setMessage(error.message || '登录失败。'); setBusy(null); } };
  const register = async () => { try { if (password !== confirmPassword) throw Error('两次密码输入不一致。'); setBusy('register'); setMessage(avatar ? '正在上传头像并创建账号…' : '正在创建账号…'); const avatarData = avatar ? await compressAvatar(avatar) : undefined; const response = await fetch(`${gateway}/wechat/registration?token=${encodeURIComponent(registrationToken)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountName, displayName: name, password, avatarData }) }), body = await response.json(); if (!response.ok) throw Error(body.error || '注册失败。'); window.location.assign(body.actionUrl); } catch (error: any) { setMessage(error.message || '注册失败。'); setBusy(null); } };
  const logout = async () => {
    setBusy('logout');
    setMessage('正在退出登录…');
    try {
      await endGameSession();
      onLogout();
      setPassword('');
      setLoginCode('');
      setAvatar(null);
      setAvatarPreview('');
      setMode('qr');
      setMessage('');
      setDeleteConfirm(false);
      onTabChange('profile');
    } catch (error: any) {
      setMessage(error.message || '退出登录失败，请重试。');
    } finally {
      setBusy(null);
    }
  };
  const destroy = async () => { try { setBusy('delete'); setMessage('正在注销账号并删除资料…'); await deleteGameAccount(accessToken); onLogout(); onClose(); setDeleteConfirm(false); setMessage(''); } catch (error: any) { setMessage(error.message || '注销账号失败。'); } finally { setBusy(null); } };
  const busyLabel = (label: string, current: typeof busy) => busy === current ? '处理中…' : label;
  const fileInput = <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={event => chooseAvatar(event.target.files?.[0])} />;

  const loginPanel = mode === 'password' ? <><h2 className="text-xl font-black">账号密码登录</h2><input value={accountName} onChange={event => setAccountName(event.target.value.toLowerCase())} placeholder="登录账号" className="w-full rounded-xl border border-slate-300 px-3 py-3" /><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="密码" className="w-full rounded-xl border border-slate-300 px-3 py-3" /><button disabled={!!busy} onClick={() => void loginWithPassword()} className="w-full rounded-xl bg-m3-primary py-3 font-bold text-white disabled:opacity-60">{busyLabel('登录', 'login')}</button><button disabled={!!busy} onClick={() => { setMode('qr'); setMessage(''); }} className="w-full text-sm text-m3-primary">使用公众号登录码</button></> : <><h2 className="text-xl font-black">公众号登录</h2><img src="/wechat-official-account-qr.jpg" alt="巴士线路图公众号二维码" className="mx-auto h-52 w-52 rounded-2xl" /><p className="text-center text-sm font-semibold leading-6 text-slate-600">扫描并关注公众号后发送“账户登录”<br />收到动态码后填入下方</p><input value={loginCode} onChange={event => setLoginCode(event.target.value.toUpperCase())} maxLength={8} placeholder="8 位登录码" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center font-mono tracking-[0.3em]" /><button disabled={!!busy} onClick={() => void confirmWechatCode()} className="w-full rounded-xl bg-m3-primary py-3 font-bold text-white disabled:opacity-60">{busyLabel('使用登录码登录', 'login')}</button><button disabled={!!busy} onClick={() => { setMode('password'); setMessage(''); }} className="w-full text-sm text-slate-500">账号密码登录</button></>;
  const registerPanel = <><div className="text-center"><button type="button" onClick={() => avatarInput.current?.click()} className="relative mx-auto block h-20 w-20 rounded-full ring-4 ring-m3-primary-container focus:outline-none"><Avatar name={name || '人'} image={avatarPreview} className="h-20 w-20 text-3xl" /><span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">点击上传头像</span></button>{fileInput}</div><div><h2 className="text-xl font-black">完成注册</h2><p className="mt-1 text-sm leading-5 text-slate-500">填写账号、昵称和密码。头像可选，未上传时会使用昵称首字作为默认头像。</p></div><input value={accountName} onChange={event => setAccountName(event.target.value.toLowerCase())} placeholder="登录账号（小写字母、数字或下划线）" className="w-full rounded-xl border border-slate-300 px-3 py-3" /><input value={name} onChange={event => setName(event.target.value)} placeholder="昵称" className="w-full rounded-xl border border-slate-300 px-3 py-3" /><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="设置密码（至少 8 位）" className="w-full rounded-xl border border-slate-300 px-3 py-3" /><input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="再次输入密码" className="w-full rounded-xl border border-slate-300 px-3 py-3" /><button disabled={!!busy} onClick={() => void register()} className="w-full rounded-xl bg-m3-primary py-3 font-bold text-white disabled:opacity-60">{busyLabel('注册并登录', 'register')}</button></>;

  const profileContent = account && (
    <section className="mx-auto max-w-lg space-y-5">
      <h2 className="text-xl font-black">个人资料</h2>
      <div className="flex items-center gap-4">
        <button type="button" disabled={!!busy} onClick={() => avatarInput.current?.click()} className="shrink-0 text-center text-xs font-bold text-m3-primary">
          <Avatar name={name || account.displayName} image={avatarPreview || account.avatarUrl} className="mx-auto mb-1 h-16 w-16 text-2xl" />
          更换头像
        </button>
        {fileInput}
        <label className="min-w-0 flex-1 space-y-1 text-sm font-bold">
          <span>昵称</span>
          <input value={name} onChange={event => setName(event.target.value)} placeholder={account.displayName}
            className="w-full rounded-xl border border-m3-outline-variant bg-m3-surface px-3 py-2.5" />
        </label>
      </div>
      <button type="button" disabled={!!busy} onClick={() => void save()} className="w-full rounded-xl bg-m3-primary py-3 font-bold text-white disabled:opacity-60">{busyLabel('保存资料', 'save')}</button>
      <section className="border-t border-m3-outline-variant/30 pt-4">
        <h3 className="text-sm font-black">游戏数据</h3>
        <p className="mt-1 text-sm text-slate-600">已建立排行榜会话的对局会提交成绩。</p>
      </section>
      <section className="border-t border-m3-outline-variant/30 pt-4">
        {deleteConfirm ? <>
          <p className="mb-3 text-sm text-slate-600">注销后，账号资料、绑定关系与游戏成绩无法恢复。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => void destroy()} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{busyLabel('确认永久注销', 'delete')}</button>
            <button type="button" disabled={!!busy} onClick={() => setDeleteConfirm(false)} className="rounded-xl border px-4 py-2 text-sm font-bold">取消</button>
          </div>
        </> : <button type="button" disabled={!!busy} onClick={() => setDeleteConfirm(true)} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600">注销账号</button>}
      </section>
    </section>
  );

  const openAccount = () => {
    if (open) return;
    setMode(registrationToken ? 'register' : 'qr');
    if (account) setName(account.displayName);
    setMessage('');
    onOpen();
  };

  return <>
    {!open && <button type="button" aria-label="打开个人主页" onClick={openAccount} className="pointer-events-auto fixed right-4 top-5 z-[110] h-[42px] w-[42px] rounded-full border border-white/80 bg-m3-primary shadow-sm transition-transform hover:scale-105 active:scale-95">
      <Avatar name={account?.displayName || '人'} image={account?.avatarUrl} className="h-full w-full text-base" />
    </button>}
    <AnimatePresence>
      {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[101] flex items-center justify-center bg-m3-dark-surface/30 p-3 backdrop-blur-sm pointer-events-auto sm:p-6" onClick={close}>
        <motion.div role="dialog" aria-modal="true" aria-label="个人主页"
          initial={{ scale: .96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .96, y: 12 }}
          transition={{ type: 'spring', damping: 24, stiffness: 220 }}
          onClick={event => event.stopPropagation()}
          className="relative flex h-[680px] max-h-[86dvh] w-full max-w-[920px] flex-col overflow-hidden rounded-[28px] border border-m3-outline-variant/30 bg-m3-surface shadow-2xl md:flex-row">
          <nav aria-label="个人主页导航" className="flex shrink-0 flex-wrap items-center gap-1.5 bg-m3-surface-container-highest p-3 pr-14 md:w-[210px] md:flex-col md:items-stretch md:border-r md:border-m3-outline-variant/20 md:p-4">
            {([{ id: 'profile', label: '个人主页' }, { id: 'general', label: '应用设置' }, { id: 'about', label: '关于' }] as const).map(({ id, label }) => (
              <button key={id} type="button" disabled={!!busy} aria-current={tab === id ? 'page' : undefined}
                onClick={() => onTabChange(id)}
                className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold transition-colors md:px-4 md:py-2.5 ${tab === id ? 'bg-m3-primary-container text-m3-on-primary-container shadow-sm' : 'text-slate-600 hover:bg-m3-primary/5'}`}>
                {id === 'profile' && <Avatar name={account?.displayName || '人'} image={account?.avatarUrl} className="hidden h-9 w-9 shrink-0 text-sm md:block" />}
                <span className="min-w-0">
                  {label}
                  {id === 'profile' && account && <span className="hidden truncate pt-0.5 text-[10px] text-slate-500 md:block">{account.displayName}</span>}
                </span>
              </button>
            ))}
            {account && <button type="button" disabled={!!busy} onClick={() => { onTabChange('profile'); void logout(); }} className="rounded-xl px-2.5 py-2 text-left text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-60 md:mt-auto md:px-4 md:py-2.5">{busyLabel('退出登录', 'logout')}</button>}
          </nav>
          <button type="button" aria-label="关闭" disabled={!!busy} onClick={close} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-m3-surface-container text-slate-500 hover:bg-m3-surface-container-high disabled:opacity-50 sm:right-4 sm:top-4">
            <X className="h-5 w-5" />
          </button>
          <div key={tab} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 md:p-8">
            {tab !== 'profile' ? children : <>
              {authLoading ? <div role="status" className="flex min-h-[280px] flex-col items-center justify-center gap-4">
                <span className="h-10 w-10 animate-spin rounded-full border-4 border-m3-primary/20 border-t-m3-primary" />
                <p className="text-sm font-bold text-slate-600">正在确认登录状态…</p>
              </div> : account ? profileContent : <section className="mx-auto max-w-sm space-y-4 md:py-4">
                {mode === 'register' ? registerPanel : loginPanel}
              </section>}
              {message && <p role="status" className="mx-auto mt-5 max-w-lg rounded-xl bg-m3-surface-container p-3 text-sm text-slate-600">{message}</p>}
            </>}
          </div>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  </>;
}
