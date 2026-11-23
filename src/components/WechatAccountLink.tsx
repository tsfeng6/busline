import { useState } from 'react';
import { completeWechatLink, requestPhoneOtp, verifyPhoneOtp, type GameAccount } from '../utils/gameAccount';

/** Handles only short-lived links issued by the public-account callback. */
export function WechatAccountLink({onSignedIn}:{onSignedIn:(account:GameAccount,accessToken:string)=>void}) {
  const query=new URLSearchParams(window.location.search),mode=query.get('wechat'),linkToken=query.get('token')||'';
  const active=(mode==='register'||mode==='bind')&&/^[A-Za-z0-9_-]{40,128}$/.test(linkToken);
  const [phone,setPhone]=useState(''),[code,setCode]=useState(''),[name,setName]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  if(!active||done)return null;
  const send=async()=>{setBusy(true);setMessage('');try{await requestPhoneOtp(phone);setMessage('验证码已发送。');}catch(error:any){setMessage(error.message||'发送失败。');}finally{setBusy(false);}};
  const finish=async()=>{setBusy(true);setMessage('');try{const result=await verifyPhoneOtp(phone,code,name||undefined);await completeWechatLink(linkToken,result.accessToken);sessionStorage.setItem('busline_game_access_token',result.accessToken);onSignedIn(result.account,result.accessToken);setDone(true);window.history.replaceState({},'',window.location.pathname);alert('微信已成功绑定到此 Busline 账号。');}catch(error:any){setMessage(error.message||'绑定失败。');}finally{setBusy(false);}};
  return <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/65 p-4"><div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-3">
    <h1 className="text-lg font-black text-slate-900">{mode==='bind'?'绑定已有 Busline 账号':'注册并绑定 Busline 账号'}</h1>
    <p className="text-xs leading-relaxed text-slate-500">请用短信验证码验证账号。链接仅可使用一次，验证成功后会立即失效。</p>
    <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="手机号，如 +8613812345678" className="w-full rounded-xl border px-3 py-2 text-sm" autoComplete="tel" />
    <div className="flex gap-2"><input value={code} onChange={e=>setCode(e.target.value)} placeholder="短信验证码" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" inputMode="numeric" /><button type="button" disabled={busy} onClick={send} className="rounded-xl bg-slate-100 px-3 text-xs font-bold">发送验证码</button></div>
    {mode==='register'&&<input value={name} onChange={e=>setName(e.target.value)} placeholder="昵称（首次注册可填写）" className="w-full rounded-xl border px-3 py-2 text-sm" />}
    <button type="button" disabled={busy} onClick={finish} className="w-full rounded-xl bg-m3-primary py-2.5 text-sm font-black text-m3-on-primary">验证并绑定</button>
    {message&&<p role="status" className="text-xs text-slate-600">{message}</p>}
  </div></div>;
}
