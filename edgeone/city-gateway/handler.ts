import { contestRules, contests, contestPrompts } from '../../src/utils/contestRules';
import { createRankedQuestion } from './rankedGame';
import { drawContestQuestion } from '../../src/utils/contestDrawing';
import { openAnswer, openQuestion, QUESTION_TICKET_LIMIT, sealAnswer, sealQuestion } from './questionTicket';
import { isGameAnswerCorrect } from '../../src/utils/gameAnswers';
import { getGameHint, isGameHintComplete } from '../../src/utils/gameHint';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { cityDataKey } from '../../src/utils/cityDataset';
import { MAX_CITY_BYTES, CITY_CHUNK_BYTES, CITY_UPLOAD_FORMAT, CITY_RECORD_FORMAT } from '../../src/utils/cityTransfer';

export interface UploadStore {
  get(key:string,options?:any):Promise<any>;
  set(key:string,value:string|ArrayBuffer):Promise<void>;
  delete(key:string):Promise<void>;
  list(options?:any):Promise<{blobs:{key:string}[]}>;
}
type Env=Record<string,string|undefined>;
type Session={id:string;city:string;bytes:number;parts:number;sha256:string;format:string;tokenHash:string;expires:number};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const terminal=new Set(['completed','retained','failed']);
const fail=(status:number,message:string)=>Object.assign(Error(message),{status});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const gatewaySignature=(secret:string,text:string)=>createHmac('sha256',secret).update(text).digest('hex');
type GameName = typeof contests[number]['game'];
const validContest = (game: unknown, scope: string): game is GameName =>
  contests.some(contest => contest.game === game && contest.scope === scope);
const gameAccount=(user:any,profile?:any):{id:string;displayName:string;avatarUrl?:string}=>({id:String(user?.id||profile?.id||''),displayName:String(profile?.display_name||'巴士玩家').slice(0,24),avatarUrl:profile?.avatar_url||profile?.avatar_path?String(profile?.avatar_url||profile?.avatar_path):undefined});
const xmlEscape=(value:string)=>value.replace(/[<>&'\"]/g,char=>({"<":'&lt;',">":'&gt;','&':'&amp;',"'":'&apos;','\"':'&quot;'}[char]!));
const xmlValue=(xml:string,name:string)=>{const found=new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>|<${name}>([\\s\\S]*?)<\\/${name}>`).exec(xml);return (found?.[1]||found?.[2]||'').trim();};
const wechatSignature=(token:string,timestamp:string,nonce:string)=>createHash('sha1').update([token,timestamp,nonce].sort().join('')).digest('hex');
const xmlCdata=(value:string)=>value.replace(/]]>/g,']]]]><![CDATA[>');
const wechatReply=(to:string,from:string,content:string)=>`<xml><ToUserName><![CDATA[${xmlCdata(to)}]]></ToUserName><FromUserName><![CDATA[${xmlCdata(from)}]]></FromUserName><CreateTime>${Math.floor(Date.now()/1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${xmlCdata(content)}]]></Content></xml>`;
const publicUrl=(value:string|undefined)=>{try{const url=new URL(value||'');return url.protocol==='https:'?url.toString().replace(/\/$/,''):null;}catch{return null;}};
async function handleWechatGateway(request:Request,env:Env,json:(data:unknown,status?:number)=>Response,transport:typeof fetch){
  const url=new URL(request.url),path=url.pathname;
  if(path!=='/wechat/callback'&&path!=='/wechat/login'&&path!=='/wechat/web-login'&&path!=='/wechat/qr-login'&&path!=='/wechat/registration')return null;
  // Supabase's sb_secret keys supersede the legacy service_role JWT. Accept
  // both during migration, but only send a legacy JWT as Authorization.
  const base=env.SUPABASE_URL?.replace(/\/$/,'')||'',serviceKey=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  const callbackToken=env.WECHAT_CALLBACK_TOKEN||'',appUrl=publicUrl(env.PUBLIC_APP_URL),gatewayUrl=publicUrl(env.PUBLIC_GATEWAY_URL);
  if(!base||!serviceKey||!callbackToken||!appUrl||!gatewayUrl)throw fail(503,'微信公众号账号服务尚未配置。');
  if(!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(base)||callbackToken.length<16)throw fail(503,'微信公众号账号服务配置无效。');
  const admin=async(pathname:string,init:RequestInit={})=>{
    const legacyJwt=/^eyJ/.test(serviceKey);const response=await transport(base+pathname,{...init,headers:{apikey:serviceKey,...(legacyJwt?{Authorization:`Bearer ${serviceKey}`} : {}),'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>({}));if(!response.ok)throw fail(503,String(body.message||body.msg||'账号服务暂时不可用。').slice(0,120));return body;
  };
  const xml=(content:string,status=200)=>new Response(content,{status,headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});
  const wechatAccessToken=async()=>{
    const appId=env.WECHAT_APP_ID||'',secret=env.WECHAT_APP_SECRET||'';
    if(!appId||!secret)throw fail(502,'公众号 AppID 或 AppSecret 尚未配置。');
    let data:any;try{data=await (await transport(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`)).json();}catch{throw fail(502,'无法连接微信公众号授权服务，请稍后重试。');}
    if(!data.access_token)throw fail(502,'公众号 AppID 或 AppSecret 无效，或接口权限尚未生效。');
    return String(data.access_token);
  };
  const wechatProfile=async(openid:string)=>{try{const token=await wechatAccessToken(),info=await (await transport(`https://api.weixin.qq.com/cgi-bin/user/info?access_token=${encodeURIComponent(token)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`)).json();return {nickname:String(info.nickname||'').replace(/\s/g,'').slice(0,24)||'巴士玩家',avatarUrl:/^https:\/\//.test(String(info.headimgurl||''))?String(info.headimgurl):''};}catch{return {nickname:'巴士玩家',avatarUrl:''};}};
  const magicLink=async(userId:string)=>{
    const user=await admin('/auth/v1/admin/users/'+encodeURIComponent(userId),{method:'GET'});let email=String(user?.email||'');
    if(!email){email=`wx-${hash(userId).slice(0,32)}@login.busline.invalid`;await admin('/auth/v1/admin/users/'+encodeURIComponent(userId),{method:'PUT',body:JSON.stringify({email,email_confirm:true})});}
    const generated=await admin('/auth/v1/admin/generate_link',{method:'POST',body:JSON.stringify({type:'magiclink',email,options:{redirectTo:appUrl+'/?wechat=logged-in'}})});
    const action=String(generated?.properties?.action_link||generated?.action_link||'');if(!/^https:\/\//.test(action))throw fail(503,'登录服务暂时不可用。');return action;
  };
  if(path==='/wechat/web-login'){
    if(request.method==='GET'){
      const code=url.searchParams.get('code')||'';if(!/^[A-Z0-9]{8}$/.test(code))throw fail(400,'登录码无效。');
      const result=await admin('/rest/v1/rpc/consume_wechat_web_login',{method:'POST',body:JSON.stringify({p_code_hash:hash(code)})});const row=Array.isArray(result)?result[0]:result;
      return json({actionUrl:row?.user_id?await magicLink(String(row.user_id)):undefined,pending:!row?.user_id});
    }
    throw fail(404,'没有这个账号接口。');
  }
  if(path==='/wechat/qr-login'){
    throw fail(410,'当前公众号不使用网页登录二维码，请扫描公众号二维码后发送“账户登录”。');
  }
  if(path==='/wechat/registration'){
    const token=url.searchParams.get('token')||'';
    if(!/^[A-Za-z0-9_-]{40,128}$/.test(token))throw fail(400,'注册链接无效或已过期。');
    const tokenHash=hash(token);
    if(request.method==='GET'){
      const rows=await admin('/rest/v1/wechat_link_tokens?token_hash=eq.'+tokenHash+'&purpose=eq.register&used_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=nickname,avatar_url');
      const row=Array.isArray(rows)?rows[0]:null;if(!row)throw fail(400,'注册链接无效或已过期。');return json({nickname:String(row.nickname||'巴士玩家'),avatarUrl:String(row.avatar_url||'')});
    }
    if(request.method==='POST'){
      const input=await jsonBody(request,300000),accountName=String(input.accountName||'').trim().toLowerCase(),displayName=String(input.displayName||'').trim().slice(0,24),password=String(input.password||''),avatarData=input.avatarData===undefined?'':String(input.avatarData);
      if(!/^[a-z0-9_]{3,24}$/.test(accountName))throw fail(400,'登录账号须为 3–24 位小写字母、数字或下划线。');
      if(displayName.length<2||password.length<8||password.length>128)throw fail(400,'请填写昵称和至少 8 位密码。');
      const rows=await admin('/rest/v1/wechat_link_tokens?token_hash=eq.'+tokenHash+'&purpose=eq.register&used_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=id,openid,scene_hash,nickname,avatar_url');
      const row=Array.isArray(rows)?rows[0]:null;if(!row)throw fail(400,'注册链接无效或已过期。');
      const email=`acct-${hash(accountName).slice(0,32)}@login.busline.invalid`;
      let created:any;try{created=await admin('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true,user_metadata:{display_name:displayName,account_name:accountName}})});}catch{throw fail(409,'该登录账号已被使用，请换一个。');}
      const userId=String(created?.id||'');if(!userId)throw fail(503,'账号创建失败。');
      let avatarPath:string|null=null;
      if(avatarData){
        const matched=/^data:image\/(webp|jpeg);base64,([a-z0-9+/=]+)$/i.exec(avatarData);if(!matched)throw fail(400,'头像格式无效。');
        const bytes=Buffer.from(matched[2],'base64');if(bytes.length<64||bytes.length>180*1024)throw fail(400,'头像大小无效。');
        avatarPath=userId+'/avatar.'+matched[1].toLowerCase();
        const uploaded=await transport(base+'/storage/v1/object/game-avatars/'+avatarPath,{method:'PUT',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'image/'+matched[1].toLowerCase(),'x-upsert':'true'},body:bytes,signal:AbortSignal.timeout(15000)});if(!uploaded.ok)throw fail(400,'头像上传失败。');
      }
      try{await admin('/rest/v1/wechat_bindings',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({openid:row.openid,user_id:userId})});await admin('/rest/v1/game_profiles?id=eq.'+encodeURIComponent(userId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({display_name:displayName,avatar_url:String(row.avatar_url||'')||null})});await admin('/rest/v1/wechat_link_tokens?id=eq.'+encodeURIComponent(String(row.id)),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({used_at:new Date().toISOString()})});if(row.scene_hash)await admin('/rest/v1/rpc/approve_wechat_web_login',{method:'POST',body:JSON.stringify({p_code_hash:row.scene_hash,p_user_id:userId})});}catch(error){throw error;}
      if(avatarPath)await admin('/rest/v1/game_profiles?id=eq.'+encodeURIComponent(userId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({avatar_path:avatarPath,avatar_url:null})});
      if(!avatarPath)await admin('/rest/v1/game_profiles?id=eq.'+encodeURIComponent(userId),{method:'PATCH',headers:{Prefer:'return-minimal'},body:JSON.stringify({avatar_url:null})});
      return json({actionUrl:await magicLink(userId)});
    }
    throw fail(404,'没有这个账号接口。');
  }
  if(path==='/wechat/login'){
    if(request.method!=='GET')throw fail(404,'没有这个账号接口。');
    const token=url.searchParams.get('token')||'';if(!/^[A-Za-z0-9_-]{40,128}$/.test(token))throw fail(400,'登录链接无效或已过期。');
    const result=await admin('/rest/v1/rpc/consume_wechat_login_token',{method:'POST',body:JSON.stringify({p_token_hash:hash(token)})});
    const row=Array.isArray(result)?result[0]:result;if(!row?.user_id)throw fail(400,'登录链接无效或已过期。');
    const action=await magicLink(String(row.user_id));
    return new Response(null,{status:302,headers:{Location:action,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  const timestamp=url.searchParams.get('timestamp')||'',nonce=url.searchParams.get('nonce')||'',signature=url.searchParams.get('signature')||'';
  if(!/^\d{10,13}$/.test(timestamp)||nonce.length<1||nonce.length>128||!equal(wechatSignature(callbackToken,timestamp,nonce),signature))throw fail(401,'微信签名验证失败。');
  if(request.method==='GET')return new Response(url.searchParams.get('echostr')||'',{headers:{'Content-Type':'text/plain;charset=utf-8'}});
  if(request.method!=='POST')throw fail(404,'没有这个账号接口。');
  if(Math.abs(Date.now()-Number(timestamp)*(timestamp.length===10?1000:1))>300000)throw fail(401,'微信请求已过期。');
  const raw=new TextDecoder().decode(await bodyBytes(request,16384)),from=xmlValue(raw,'FromUserName'),to=xmlValue(raw,'ToUserName'),content=xmlValue(raw,'Content').replace(/\s/g,''),msgId=xmlValue(raw,'MsgId'),msgType=xmlValue(raw,'MsgType').toLowerCase(),event=xmlValue(raw,'Event').toLowerCase(),rawScene=xmlValue(raw,'EventKey');
  if(!from||!to||(!content&&msgType!=='event'))throw fail(400,'微信消息格式无效。');
  const eventKey=msgId?`msg:${msgId}`:`body:${hash(`${from}\n${to}\n${xmlValue(raw,'CreateTime')}\n${content||event+rawScene}`)}`;
  const claimed=await admin('/rest/v1/rpc/claim_wechat_inbound',{method:'POST',body:JSON.stringify({p_event_key:eventKey})});
  if(claimed!==true)return xml('success');
  const binding=await admin('/rest/v1/wechat_bindings?openid=eq.'+encodeURIComponent(from)+'&select=user_id');
  const userId=Array.isArray(binding)&&binding[0]?.user_id?String(binding[0].user_id):'';
  const scene=(event==='subscribe'?rawScene.replace(/^qrscene_/i,''):rawScene).toLowerCase();
  if(msgType==='event'&&(event==='scan'||event==='subscribe')&&/^[a-f0-9]{24}$/.test(scene)){
    if(userId){await admin('/rest/v1/rpc/approve_wechat_web_login',{method:'POST',body:JSON.stringify({p_code_hash:hash(scene),p_user_id:userId})});return xml(wechatReply(from,to,'登录已确认，请回网页继续。'));}
    const profile=await wechatProfile(from),token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+15*60_000).toISOString();
    await admin('/rest/v1/rpc/create_wechat_link_token',{method:'POST',body:JSON.stringify({p_openid:from,p_purpose:'register',p_token_hash:hash(token),p_expires_at:expires})});
    await admin('/rest/v1/wechat_link_tokens?token_hash=eq.'+hash(token),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({scene_hash:hash(scene),nickname:profile.nickname,avatar_url:profile.avatarUrl||null})});
    return xml(wechatReply(from,to,`欢迎使用巴士线路图。请在 15 分钟内打开链接完成注册：${appUrl}/?wechat=register&token=${encodeURIComponent(token)}\n请勿转发给他人。`));
  }
  const registrationLink=async()=>{const profile=await wechatProfile(from),token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+15*60_000).toISOString();await admin('/rest/v1/rpc/create_wechat_link_token',{method:'POST',body:JSON.stringify({p_openid:from,p_purpose:'register',p_token_hash:hash(token),p_expires_at:expires})});await admin('/rest/v1/wechat_link_tokens?token_hash=eq.'+hash(token),{method:'PATCH',headers:{Prefer:'return-minimal'},body:JSON.stringify({nickname:profile.nickname,avatar_url:profile.avatarUrl||null})});return `${appUrl}/?wechat=register&token=${encodeURIComponent(token)}`;};
  let purpose:'bind'|'login'|null=null,message='可发送“账户登录”、“账户注册”或“账号状态”。';
  const desktop=/^(?:登录|login)([A-Z0-9]{8})$/i.exec(content);
  if(desktop){if(!userId)message='尚未注册。请先发送“注册账号”，再重新输入登录码。';else {const approved=await admin('/rest/v1/rpc/approve_wechat_web_login',{method:'POST',body:JSON.stringify({p_code_hash:hash(desktop[1].toUpperCase()),p_user_id:userId})});message=approved===true?'登录已确认，请回网页继续。':'登录码无效或已过期，请在网页重新获取。';}}
  else if(content==='账户登录'||content==='登录'){
    if(!userId)message=`这是首次使用，请在 15 分钟内打开链接完成注册：${await registrationLink()}\n请勿转发给他人。`;
    else {const code=randomBytes(6).toString('hex').slice(0,8).toUpperCase(),expires=new Date(Date.now()+5*60_000).toISOString(),codeHash=hash(code);await admin('/rest/v1/rpc/create_wechat_web_login',{method:'POST',body:JSON.stringify({p_code_hash:codeHash,p_expires_at:expires})});await admin('/rest/v1/rpc/approve_wechat_web_login',{method:'POST',body:JSON.stringify({p_code_hash:codeHash,p_user_id:userId})});message=`网页登录验证码：${code}\n请在 5 分钟内填回巴士线路图网页。请勿转发给他人。`;}
  }
  else if(content==='账户注册'||content==='注册账号'){
    if(userId)message='该微信已注册 Busline 账号，无需重复注册。';
    else message=`请在 15 分钟内打开链接完成注册：${await registrationLink()}\n请勿转发给他人。`;
  }
  else if(content==='绑定账号'){purpose=userId?null:'bind';message=userId?'该微信已绑定 Busline 账号，无需重复绑定。':'';}
  else if(content==='免密登录'){purpose=userId?'login':null;message=userId?'':'该微信尚未绑定账号，请先发送“注册账号”或“绑定账号”。';}
  else if(content==='账号状态')message=userId?'此微信已绑定 Busline 账号。为保护隐私，不在消息中展示账号信息。':'此微信尚未绑定 Busline 账号。可发送“账户登录”或“账户注册”。';
  if(purpose){const token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+15*60_000).toISOString();await admin('/rest/v1/rpc/create_wechat_link_token',{method:'POST',body:JSON.stringify({p_openid:from,p_purpose:purpose,p_token_hash:hash(token),p_expires_at:expires})});
    const link=purpose==='login'?`${gatewayUrl}/wechat/login?token=${encodeURIComponent(token)}`:`${appUrl}/?wechat=${purpose}&token=${encodeURIComponent(token)}`;
    message=purpose==='login'?`请在 15 分钟内打开此免密登录链接：${link}\n请勿转发给他人。`:`请在 15 分钟内打开链接${purpose==='bind'?'验证现有账号后完成绑定':'注册或验证账号后完成绑定'}：${link}\n请勿转发给他人。`;}
  return xml(wechatReply(from,to,message));
}
const preparingRankedPacks = new Map<string, Promise<string>>();

async function handleGameGateway(request:Request,env:Env,json:(data:unknown,status?:number)=>Response,transport:typeof fetch){
  const url=new URL(request.url),path=url.pathname;
  const configured=!!env.SUPABASE_URL&&!!env.SUPABASE_ANON_KEY;
  if(!path.startsWith('/game-auth/')&&!path.startsWith('/game-runs')&&!path.startsWith('/ranked-game-runs')&&path!=='/contest-leaderboards'&&path!=='/contest-results'&&path!=='/game-profile'&&path!=='/wechat/complete')return null;
  if(!configured)throw fail(503,'账号与排行榜服务尚未配置。');
  const base=env.SUPABASE_URL!.replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(base))throw fail(503,'账号服务配置无效。');
  // A browser session is held in an HttpOnly, same-site cookie.  Keep the
  // Authorization fallback solely for the one-time bootstrap request and
  // older clients; normal game traffic never exposes a token to JavaScript.
  const cookieValue=(name:string)=>{const part=(request.headers.get('cookie')||'').split(';').map(item=>item.trim()).find(item=>item.startsWith(name+'='));try{return part?decodeURIComponent(part.slice(name.length+1)):'';}catch{return '';}};
  const headerBearer=request.headers.get('authorization')||'';
  const cookieToken=cookieValue('busline_game_session');
  const bearer=/^Bearer\s+\S+$/i.test(headerBearer)?headerBearer:cookieToken?`Bearer ${cookieToken}`:'';
  const sessionCookie=(value:string,maxAge:number)=>{let domain='';try{const appHost=new URL(env.PUBLIC_APP_URL||'').hostname.replace(/^www\./i,'');const gatewayHost=new URL(request.url).hostname;if(appHost&&gatewayHost.endsWith(appHost))domain=`; Domain=${appHost}`;}catch{}return `busline_game_session=${encodeURIComponent(value)}; Path=/${domain}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;};
  const supabase=async(pathname:string,init:RequestInit={},needsUser=false)=>{
    if(needsUser&&!/^Bearer\s+\S+$/i.test(bearer))throw fail(401,'请先登录。');
    const response=await transport(base+pathname,{...init,headers:{apikey:env.SUPABASE_ANON_KEY!,...(needsUser?{Authorization:bearer}:{}),'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const message=String(body.msg||body.message||body.error_description||'账号服务暂时不可用。');if(/get_game_leaderboard|start_game_run/.test(message))throw fail(409,'排行榜数据库尚未升级，请在 Supabase SQL Editor 重新执行 docs/supabase-game-auth.sql。');throw fail(response.status===401?401:400,message.slice(0,160));}
    return body;
  };
  const profileFor=async(auth:string)=>{
    const response=await transport(base+'/rest/v1/rpc/current_game_profile',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY!,Authorization:auth,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
    if(response.status===401)throw fail(401,'登录已失效，请重新登录。');
    if(!response.ok)throw fail(503,'用户资料读取失败。');
    return response.json();
  };
  const withAvatarUrl=(account:ReturnType<typeof gameAccount>)=>{if(account.avatarUrl)account.avatarUrl=base+'/storage/v1/object/public/game-avatars/'+account.avatarUrl;return account;};
  const authenticatedProfile = async (auth: string, verifiedUser?: { id?: string }) => {
    if (!auth) throw fail(401, '请先登录。');
    const profile = await profileFor(auth);
    const row = Array.isArray(profile) ? profile[0] : profile;
    if (typeof row?.display_name !== 'string') throw fail(401, '未找到登录资料，请重新登录。');
    // Older versions of the profile RPC omit the ID.
    const user = uuid.test(row.id || '') ? null
      : uuid.test(verifiedUser?.id || '') ? verifiedUser
      : await supabase('/auth/v1/user', {}, true);
    const account = withAvatarUrl(gameAccount(user, row));
    if (!uuid.test(account.id)) throw fail(401, '登录已失效，请重新登录。');
    return account;
  };
  const signedIn = (token: string, account: ReturnType<typeof gameAccount>) => {
    const response = json({signedIn: true, account});
    response.headers.set('Set-Cookie', sessionCookie(token, 3600));
    return response;
  };
  if(path==='/game-auth/session'&&request.method==='POST'){
    if(!/^Bearer\s+\S+$/i.test(headerBearer))throw fail(401,'请先登录。');
    const account = await authenticatedProfile(headerBearer);
    return signedIn(headerBearer.replace(/^Bearer\s+/i, ''), account);
  }
  if(path==='/game-auth/logout'&&request.method==='POST'){
    const response=json({signedOut:true});response.headers.set('Set-Cookie',sessionCookie('',0));return response;
  }
  if(path==='/game-auth/delete'&&request.method==='POST'){
    const input=await jsonBody(request,256);
    if(input.confirm!=='DELETE')throw fail(400,'请确认注销账号。');
    const user=await supabase('/auth/v1/user',{},true),userId=String(user?.id||'');
    if(!uuid.test(userId))throw fail(400,'账号资料读取失败。');
    const serviceKey=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
    if(!serviceKey)throw fail(503,'注销服务尚未配置。');
    const legacyJwt=/^eyJ/.test(serviceKey);
    const admin=async(pathname:string,init:RequestInit={})=>{
      const response=await transport(base+pathname,{...init,headers:{apikey:serviceKey,...(legacyJwt?{Authorization:`Bearer ${serviceKey}`} : {}),'Content-Type':'application/json',...(init.headers||{})},signal:AbortSignal.timeout(15000)});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw fail(503,String(body.message||body.msg||'注销服务暂时不可用。').slice(0,120));}
      return response;
    };
    // Profile rows and game records are linked to auth.users with cascade
    // deletion. Remove the independently stored avatar and outstanding WeChat
    // links first so that a deleted account cannot retain reusable bindings.
    await admin('/storage/v1/object/game-avatars/'+encodeURIComponent(userId)+'/avatar.webp',{method:'DELETE'}).catch(()=>{});
    await admin('/storage/v1/object/game-avatars/'+encodeURIComponent(userId)+'/avatar.jpeg',{method:'DELETE'}).catch(()=>{});
    const bindingsResponse=await admin('/rest/v1/wechat_bindings?user_id=eq.'+encodeURIComponent(userId)+'&select=openid',{method:'GET'});
    const bindings=await bindingsResponse.json().catch(()=>[]);
    await Promise.all((Array.isArray(bindings)?bindings:[]).map((binding:any)=>admin('/rest/v1/wechat_link_tokens?openid=eq.'+encodeURIComponent(String(binding.openid)),{method:'DELETE'})));
    await admin('/auth/v1/admin/users/'+encodeURIComponent(userId),{method:'DELETE'});
    const response=json({deleted:true});response.headers.set('Set-Cookie',sessionCookie('',0));return response;
  }
  if(path==='/game-auth/password-login'&&request.method==='POST'){
    const input=await jsonBody(request,2048),accountName=String(input.accountName||'').trim().toLowerCase(),password=String(input.password||'');
    if(!/^[a-z0-9_]{3,24}$/.test(accountName)||password.length<8||password.length>128)throw fail(400,'账号或密码格式无效。');
    const email=`acct-${hash(accountName).slice(0,32)}@login.busline.invalid`;
    const response=await transport(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY!,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(15000)}),data=await response.json().catch(()=>({}));
    if (response.status === 429) throw fail(429, '登录尝试过于频繁，请稍后再试。');
    if (response.status >= 500) throw fail(503, '登录服务暂时不可用。');
    if(!response.ok||typeof data.access_token!=='string'||!data.access_token)throw fail(401,'账号或密码错误。');
    const account = await authenticatedProfile('Bearer ' + data.access_token, data.user);
    return signedIn(data.access_token, account);
  }
  if(path==='/game-auth/otp'&&request.method==='POST'){
    const input=await jsonBody(request,1024),phone=String(input.phone||'').trim();
    if(!/^\+[1-9]\d{7,14}$/.test(phone))throw fail(400,'请输入带国家区号的手机号，例如 +8613812345678。');
    await supabase('/auth/v1/otp',{method:'POST',body:JSON.stringify({phone,create_user:true})});
    return json({sent:true});
  }
  if(path==='/game-auth/verify'&&request.method==='POST'){
    const input=await jsonBody(request,2048),phone=String(input.phone||'').trim(),token=String(input.token||'').trim(),displayName=String(input.displayName||'').trim();
    if(!/^\+[1-9]\d{7,14}$/.test(phone)||!/^\d{4,10}$/.test(token))throw fail(400,'手机号或验证码无效。');
    const data=await supabase('/auth/v1/verify',{method:'POST',body:JSON.stringify({phone,token,type:'sms'})}),auth='Bearer '+data.access_token;
    if(displayName){if(displayName.length<2||displayName.length>24)throw fail(400,'昵称须为 2–24 个字。');await transport(base+'/rest/v1/rpc/update_game_profile',{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY!,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({p_display_name:displayName,p_avatar_path:null})});}
    const profile=await profileFor(auth),account=withAvatarUrl(gameAccount(data.user,Array.isArray(profile)?profile[0]:profile));
    return json({account,accessToken:data.access_token});
  }
  // current_game_profile derives auth.uid() from the same verified bearer and
  // also returns the profile id. This avoids a second, serial /auth/v1/user
  // round trip on every page-load session restore.
  if(path==='/game-auth/me'&&request.method==='GET'){
    return json({account:await authenticatedProfile(bearer)});
  }
  if(path==='/game-profile'&&request.method==='POST'){
    const input=await jsonBody(request,300000),displayName=String(input.displayName||'').trim(),avatarData=input.avatarData===undefined?undefined:String(input.avatarData);
    if(displayName.length<2||displayName.length>24)throw fail(400,'昵称须为 2–24 个字。');
    const user=await supabase('/auth/v1/user',{},true);let avatarPath:string|null=null;
    if(avatarData){
      const matched=/^data:image\/(webp|jpeg);base64,([a-z0-9+/=]+)$/i.exec(avatarData);if(!matched)throw fail(400,'头像格式无效。');
      const bytes=Buffer.from(matched[2],'base64');if(bytes.length<64||bytes.length>180*1024)throw fail(400,'头像大小无效。');
      avatarPath=String(user.id)+'/avatar.'+matched[1].toLowerCase();
      const uploaded=await transport(base+'/storage/v1/object/game-avatars/'+avatarPath,{method:'PUT',headers:{apikey:env.SUPABASE_ANON_KEY!,Authorization:bearer,'Content-Type':'image/'+matched[1].toLowerCase(),'x-upsert':'true'},body:bytes,signal:AbortSignal.timeout(15000)});
      if(!uploaded.ok)throw fail(400,'头像上传失败。');
    }
    const profile=await supabase('/rest/v1/rpc/update_game_profile',{method:'POST',body:JSON.stringify({p_display_name:displayName,p_avatar_path:avatarPath})},true);
    return json({account:withAvatarUrl(gameAccount(user,Array.isArray(profile)?profile[0]:profile))});
  }
  if(path==='/wechat/complete'&&request.method==='POST'){
    const input=await jsonBody(request,1024),token=String(input.token||'');
    if(!/^[A-Za-z0-9_-]{40,128}$/.test(token))throw fail(400,'注册链接无效或已过期。');
    await supabase('/rest/v1/rpc/complete_wechat_link_token',{method:'POST',body:JSON.stringify({p_token_hash:hash(token)})},true);
    return json({bound:true});
  }
  if (path === '/contest-leaderboards' && request.method === 'GET') {
    const game = url.searchParams.get('game');
    const scope = url.searchParams.get('scope')?.trim() ?? '';
    if (!validContest(game, scope)) throw fail(400, '不存在这个竞赛榜单。');
    const data = await supabase('/rest/v1/rpc/get_game_contest_board', {
      method: 'POST', body: JSON.stringify({ p_game: game, p_scope: scope }),
    }, !!bearer);
    return json({ entries: (Array.isArray(data) ? data : []).map(item => ({
      rank: Number(item.rank), displayName: String(item.display_name), score: Number(item.score),
      achievedAt: String(item.achieved_at), isCurrentUser: item.is_current_user === true,
      avatarUrl: item.avatar_url || (item.avatar_path ? base + '/storage/v1/object/public/game-avatars/' + item.avatar_path : undefined),
    })) });
  }
  if (path === '/contest-results' && request.method === 'POST') {
    const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw fail(503, '排行榜暂不可用。');
    const { id: user } = await authenticatedProfile(bearer);
    const input = await jsonBody(request, 2048);
    const scope = typeof input.scope === 'string' ? input.scope.trim() : '';
    if (!validContest(input.game, scope)) throw fail(400, '不存在这个竞赛项目。');
    if (!Number.isSafeInteger(input.correctCount) || input.correctCount < 0) throw fail(400, '答对题数无效。');
    let rules;
    try { rules = contestRules(input.game, input.tags ?? []); }
    catch (error) { throw fail(400, (error as Error).message); }
    const score = input.correctCount * rules.multiplier;
    if (score > Number.MAX_SAFE_INTEGER) throw fail(400, '分数无效。');

    const service = async (resource: string, init: RequestInit = {}) => {
      const response = await transport(base + '/rest/v1/' + resource, {
        ...init,
        signal: AbortSignal.timeout(15000),
        headers: { apikey: serviceKey, ...(serviceKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serviceKey}` }),
          'Content-Type': 'application/json', ...init.headers },
      });
      if (!response.ok) throw fail(503, '排行榜成绩暂时无法保存，请重试。');
      return response;
    };
    const suspensions = await (await service(`game_contest_suspensions?user_id=eq.${user}&select=user_id&limit=1`)).json();
    if (suspensions.length) throw fail(403, '此账号暂无法参加巴士猜线竞赛。');

    const achieved_at = new Date().toISOString();
    const insert = await service('game_contest_entries?on_conflict=game,scope,user_id&select=score', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ game: input.game, scope, user_id: user, score, achieved_at }),
    });
    if (!(await insert.json()).length) {
      // Compare inside the write so retries and concurrent completions cannot lower a best score.
      const query = new URLSearchParams({ game: 'eq.' + input.game, scope: 'eq.' + scope, user_id: 'eq.' + user, score: 'lt.' + score });
      await service(`game_contest_entries?${query}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ score, achieved_at }),
      });
    }
    return json({ saved: true });
  }
  const rankedPath = /^\/ranked-game-runs(?:\/([a-f0-9-]{36})\/(pack|question|answer|hint))?$/.exec(path);
  if (rankedPath && request.method === 'POST') {
    const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    const appOrigin = publicUrl(env.PUBLIC_APP_URL);
    if (!serviceKey || !appOrigin) throw fail(503, '服务端计分尚未配置。');
    const { id: user } = await authenticatedProfile(bearer);
    const input = await jsonBody(request, rankedPath[2] === 'question' ? QUESTION_TICKET_LIMIT : rankedPath[2] === 'answer' ? 4096 : 2048);
    const runId = rankedPath[1] ?? null;
    const action = async (operation: string, payload = {}) => {
      const response = await transport(base + '/rest/v1/rpc/ranked_game_action', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { apikey: serviceKey, ...(serviceKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serviceKey}` }), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user: user, p_action: operation, p_run: runId, p_input: payload }),
      });
      const body = await response.json().catch(() => null);
      if (body?.code === '42501' && /^此账号暂无法参加巴士(?:竞猜|猜线)竞赛。$/.test(body?.message ?? '')) throw fail(403, '此账号暂无法参加巴士猜线竞赛。');
      if (!response.ok) throw fail(409, response.status === 404 ? '服务端计分数据库尚未升级。' : '计分请求暂时无法完成，请重试。');
      return body;
    };
    const reply = (body: unknown, code = 200) => {
      const response = json(body, code);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    };
    if (!runId) {
      const scope = input.game === 'city' ? '全国' : typeof input.scope === 'string' ? input.scope.trim() : '';
      if (!validContest(input.game, scope)) throw fail(400, '不存在这个竞赛项目。');
      if (input.game === 'accessibility') throw fail(400, '请从巴士猜线大厅开始这个竞赛。');
      let rules;
      try { rules = contestRules(input.game, input.tags ?? []); }
      catch (error) { throw fail(400, (error as Error).message); }
      const difficulty = rules.perQuestion ? 'easy' : 'hard';
      const browserQuestions = input.browserQuestions === true;
      const run = await action('start', { game: input.game, difficulty, scope, rules: { ...rules, browserQuestions } });
      return reply({ run: { ...run, browserQuestions } }, 201);
    }
    const unlock = (saved: { encrypted?: boolean; correctAnswer: string; isFillIn: boolean }, number: number) =>
      saved.encrypted ? openQuestion(saved.correctAnswer, serviceKey, runId, number).question : saved;
    if (rankedPath[2] === 'answer') {
      if (!uuid.test(input.id || '') || typeof input.answer !== 'string' || input.answer.length > 150) throw fail(400, '答案格式无效。');
      let verifier: ReturnType<typeof openAnswer> | undefined;
      if (typeof input.answerTicket === 'string') {
        try { verifier = openAnswer(input.answerTicket, serviceKey, runId, user, input.id); }
        catch { /* An older ticket may survive key rotation. Read the authoritative question. */ }
      }
      if (!verifier) {
        const current = await action('read');
        if (current.id === input.id && current.question) {
          verifier = { ...unlock(current.question, current.number), game: current.game, preserveRouteQualifier: current.rules.range === 'unlimited' };
        }
      }
      const correct = !!verifier && isGameAnswerCorrect(
        input.answer, verifier.correctAnswer, verifier.isFillIn, verifier.game as GameName, verifier.preserveRouteQualifier,
      );
      // The RPC still checks ownership, question ID, deadline and repeat submissions.
      const result = await action('answer', { id: input.id, answer: input.answer.trim(), timeout: input.timeout === true, correct });
      return reply(result.question?.encrypted ? { ...result, question: unlock(result.question, result.number) } : result);
    }
    const current = await action('read');
    const prepare = async (previous: string, useCityThumbnail = false, number?: number) => {
      try {
        const question = await createRankedQuestion(appOrigin, transport, current.game, current.scope, previous, current.rules, useCityThumbnail,
          current.rules.browserQuestions && number !== undefined ? { run: runId, number } : undefined);
        if (current.rules.browserQuestions) {
          return { question: { targetCity: question.targetCity, correctAnswer: question.correctAnswer,
            isFillIn: question.isFillIn, options: [], promptText: '', sourceRevision: question.sourceRevision },
            drawing: { path: '', stops: [], terminals: [], county: false } };
        }
        const drawing = drawContestQuestion(question, current.game, current.rules.cycle);
        const { contextPaths, networkImage, ...review } = question;
        return { question: review, drawing };
      } catch {
        throw fail(409, '暂时无法准备计分题目，请稍后重试。');
      }
    };
    if (rankedPath[2] === 'pack') {
      const number = input.number;
      if (current.finished || !Number.isSafeInteger(number) || number !== current.number + 1) throw fail(409, '题目顺序无效。');
      const key = runId + ':' + number;
      let pending = preparingRankedPacks.get(key);
      if (!pending) {
        const previous = current.question
          ? unlock(current.question, current.number).correctAnswer
          : current.rules.browserQuestions && current.previousAnswer
            ? openQuestion(current.previousAnswer, serviceKey, runId, current.number).question.correctAnswer
            : current.previousAnswer;
        pending = prepare(previous, true, number)
          .then(prepared => sealQuestion(prepared, serviceKey, runId, number))
          .finally(() => preparingRankedPacks.delete(key));
        preparingRankedPacks.set(key, pending);
      }
      return reply({ number, ticket: await pending });
    }
    if (rankedPath[2] === 'hint') {
      if (input.id !== current.id || !current.question || !Number.isInteger(input.step) || input.step < 1 || input.step > current.rules.hintLimit) throw fail(400, '提示不可用。');
      if (input.step > current.hintsOnQuestion && isGameHintComplete(unlock(current.question, current.number).correctAnswer, current.hintsOnQuestion)) throw fail(409, '本题提示已全部揭示。');
      const next = await action('hint', { id: input.id, step: input.step });
      const answer = unlock(next.question, current.number).correctAnswer;
      return reply({ text: getGameHint(answer, next.hintsOnQuestion),
        remaining: current.rules.hintLimit - next.hints, used: next.hintsOnQuestion,
        complete: isGameHintComplete(answer, next.hintsOnQuestion) });
    }
    const number = input.number;
    if (current.finished || !Number.isSafeInteger(number) || number !== current.number + (current.question ? 0 : 1)) throw fail(409, '题目顺序无效。');
    let issued = current;
    if (!current.question) {
      let prepared;
      if (typeof input.ticket === 'string') {
        try {
          prepared = openQuestion(input.ticket, serviceKey, runId, number);
        } catch {
          throw fail(400, '竞赛题包无效，请重新出题。');
        }
      } else {
        if (current.rules.browserQuestions) throw fail(400, '缺少竞赛校验题包。');
        // Previously opened clients may still use the original request.
        prepared = await prepare(current.previousAnswer);
      }
      if (current.rules.browserQuestions && input.sourceRevision !== prepared.question.sourceRevision) {
        throw fail(409, '线路数据刚更新，请刷新后重新开始竞赛。');
      }
      issued = await action('issue', current.rules.browserQuestions ? {
        number, drawing: prepared.drawing,
        // Keep the verifier sealed in the database. The RPC carries it forward for retries and next-question exclusion.
        question: { correctAnswer: input.ticket, encrypted: true, options: [], isFillIn: prepared.question.isFillIn },
      } : { number, ...prepared });
    }
    const question = issued.question;
    const promptText = contestPrompts[current.game as GameName];
    const { correctAnswer, isFillIn } = unlock(question, issued.number);
    const sealed = sealAnswer({
      correctAnswer, isFillIn, game: current.game, preserveRouteQualifier: current.rules.range === 'unlimited',
    }, serviceKey, runId, user, issued.id);
    const answerTicket = sealed.length <= 2048 ? sealed : undefined;
    return reply({ id: issued.id, number: issued.number, options: question.isFillIn ? [] : question.options, isFillIn: question.isFillIn, promptText,
      answerTicket, drawing: issued.drawing, remainingMs: issued.remainingMs, hints: current.rules.hintLimit - issued.hints, hintLimit: current.rules.hintLimit });
  }
  if (path.startsWith('/game-runs')) throw fail(410, '排行榜已升级，请刷新网页。');
  throw fail(404,'没有这个账号接口。');
}
async function bodyBytes(request:Request,limit:number){
  if(Number(request.headers.get('content-length')||0)>limit)throw fail(413,'请求内容过大。');
  // Some Node function adapters expose arrayBuffer()/text(), but not a Web ReadableStream body.
  if(!request.body||typeof request.body.getReader!=='function'){
    const bytes=typeof request.arrayBuffer==='function'?new Uint8Array(await request.arrayBuffer()):new TextEncoder().encode(await request.text());
    if(bytes.byteLength>limit)throw fail(413,'请求内容过大。');
    return bytes;
  }
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();throw fail(413,'请求内容过大。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
async function jsonBody(request:Request,limit=8192){try{return JSON.parse(new TextDecoder().decode(await bodyBytes(request,limit)));}catch(e:any){if(e.status)throw e;throw fail(400,'请求格式无效。');}}
/** Instance-local serialization; Blob has no compare-and-swap, so it is not a distributed lock. */
const tasks=new Map<string,Promise<unknown>>();
async function serial<T>(key:string,action:()=>Promise<T>):Promise<T>{
  const previous=tasks.get(key)||Promise.resolve();const task=previous.catch(()=>{}).then(action);tasks.set(key,task);
  try{return await task;}finally{if(tasks.get(key)===task)tasks.delete(key);}
}
export async function handleEdgeOneGateway(request:Request,env:Env,store:UploadStore,transport:typeof fetch=fetch,clientIp=''){
  const origin=request.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGINS||'https://busline.cc,https://www.busline.cc').split(',').map(x=>x.trim());
  const cors:Record<string,string>=allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Vary':'Origin'}:{};
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'}});
  const get=async(key:string)=>store.get(key,{type:'json',consistency:'strong'});
  const put=(key:string,value:unknown)=>store.set(key,JSON.stringify(value));
  const sessionKey=(id:string)=>`sessions/${id}.json`,jobKey=(id:string)=>`jobs/${id}.json`;
  const adminSessionToken=(issuedAt:number)=>{
    const payload=Buffer.from(JSON.stringify({issuedAt})).toString('base64url');
    return `${payload}.${createHmac('sha256',env.ADMIN_SESSION_SECRET||'').update(payload).digest('base64url')}`;
  };
  // Bounded cleanup makes progress across requests without loading large objects into memory.
  const cleanup=async(id:string)=>{
    const chunks=await store.list({prefix:`chunks/${id}/`,consistency:'strong'});
    for(let i=0;i<Math.min(chunks.blobs.length,64);i+=8)await Promise.all(chunks.blobs.slice(i,i+8).map(item=>store.delete(item.key)));
    if(chunks.blobs.length<=64)await store.delete(sessionKey(id));
  };
  const gc=async()=>{
    const entries=await store.list({prefix:'sessions/',consistency:'strong'});
    let active=0,reserved=0,swept=0;
    for(const item of entries.blobs){const session:Session|null=await get(item.key);if(!session)continue;
      if(session.expires<=Date.now()){if(swept++<2)await cleanup(session.id);}
      else{const job=await get(jobKey(session.id));if(terminal.has(job?.state)){if(swept++<2)await cleanup(session.id);}else{active++;reserved+=session.bytes;}}
    }
    return {active,reserved};
  };
  try{
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET')return json({service:'busline-city-gateway',platform:'edgeone',version:1,
      configured:!!env.GITHUB_DISPATCH_TOKEN&&(env.CALLBACK_SECRET?.length||0)>=32&&(env.RATE_LIMIT_SALT?.length||0)>=16});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,x-admin-session,x-city-upload-token','Access-Control-Max-Age':'600'}});
    if(path==='/admin/verify'){
      if(request.method!=='POST')throw fail(405,'管理员验证只接受 POST 请求。');
      if(!env.ADMIN_PASSWORD||!env.ADMIN_SESSION_SECRET)throw fail(503,'管理员服务尚未配置。');
      const ip=clientIp||request.headers.get('X-Forwarded-For')||'unknown';
      const attemptKey=`admin-login/${gatewaySignature(env.ADMIN_SESSION_SECRET,ip).slice(0,40)}.json`;
      const previous=await get(attemptKey),now=Date.now(),windowMs=15*60_000;
      const attempt=previous&&previous.resetAt>now?previous:{count:0,resetAt:now+windowMs};
      if(attempt.count>=5)throw fail(429,'尝试次数过多，请 15 分钟后再试。');
      const input=await jsonBody(request,512),password=typeof input.password==='string'?input.password:'';
      if(!equal(password,env.ADMIN_PASSWORD)){
        await put(attemptKey,{...attempt,count:attempt.count+1});
        throw fail(401,'管理员密钥不正确。');
      }
      await store.delete(attemptKey);
      return json({success:true,sessionToken:adminSessionToken(now),expiresIn:6*60*60_000});
    }
    const wechatResponse=await handleWechatGateway(request,env,json,transport);if(wechatResponse)return wechatResponse;
    const gameResponse=await handleGameGateway(request,env,json,transport);if(gameResponse)return gameResponse;
    if(!env.GITHUB_DISPATCH_TOKEN||(env.CALLBACK_SECRET?.length||0)<32||(env.RATE_LIMIT_SALT?.length||0)<16)throw fail(503,'上传入口尚未配置完成。');
    const repo=env.GITHUB_REPO||'tsfeng6/busline',ref=env.GITHUB_WORKFLOW_REF||'main';
    if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!/^[-\w/]+$/.test(ref))throw fail(503,'仓库配置无效。');
    if(path==='/jobs/callback'&&request.method==='POST'){
      const raw=new TextDecoder().decode(await bodyBytes(request,8192));
      if(!equal(gatewaySignature(env.CALLBACK_SECRET!,raw),request.headers.get('x-city-signature')||''))throw fail(401,'回调认证失败。');
      let input:any;try{input=JSON.parse(raw);}catch{throw fail(400,'请求格式无效。');}
      if(!uuid.test(input.id||'')||!Number.isFinite(input.at)||Math.abs(Date.now()-input.at)>300000||!['running','completed','retained','failed'].includes(input.state))throw fail(400,'回调参数无效。');
      return await serial(input.id,async()=>{
        const job=await get(jobKey(input.id));
        if(!job||cityDataKey(job.city)!==cityDataKey(input.city)||job.expires<=Date.now())throw fail(409,'任务已失效。');
        if(terminal.has(job.state))return json({accepted:job.state===input.state},job.state===input.state?200:409);
        const result=input.result?{promoted:input.result.promoted===true,lineDirections:Number(input.result.lineDirections)||0,
          stops:Number(input.result.stops)||0,snapshotId:String(input.result.snapshotId||'').slice(0,100)}:undefined;
        await put(jobKey(input.id),{...job,state:input.state,message:String(input.message||'正在保存。').slice(0,200),result,updatedAt:Date.now()});
        if(terminal.has(input.state))try{await cleanup(input.id);}catch{/* A later sweep retries cleanup; never fail a saved result. */}
        return json({accepted:true});
      });
    }
    const match=/^\/uploads\/([^/]+)(?:\/(complete|chunks\/(\d+)))?$/.exec(path);
    // Actions authenticate downloads with a short-lived HMAC, independently of browser Origin.
    if(match&&request.method==='GET'){
      const [,id,,index]=match;const at=Number(request.headers.get('x-city-timestamp'));
      if(!uuid.test(id)||!Number.isFinite(at)||Math.abs(Date.now()-at)>300000||!equal(gatewaySignature(env.CALLBACK_SECRET!,`${id}:${index===undefined?'manifest':index}:${at}`),request.headers.get('x-city-signature')||''))throw fail(401,'下载认证失败。');
      const session:Session|null=await get(sessionKey(id)),job=await get(jobKey(id));
      if(!session||session.expires<=Date.now()||!job||!['queued','running'].includes(job.state)||!job.submitted)throw fail(409,'上传未完成或已过期。');
      if(index===undefined)return json({id,city:session.city,bytes:session.bytes,parts:session.parts,sha256:session.sha256,format:session.format});
      const number=Number(index);if(!Number.isInteger(number)||number<0||number>=session.parts)throw fail(400,'片段编号无效。');
      const part=await store.get(`chunks/${id}/${number}`,{type:'arrayBuffer',consistency:'strong'});
      if(!part)throw fail(404,'片段不存在。');
      return new Response(part,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
    }
    if(!allowed.includes(origin))throw fail(403,'此来源不允许访问上传入口。');
    if(request.method==='GET'&&/^\/jobs\/[^/]+$/.test(path)){
      const id=path.split('/')[2];if(!uuid.test(id))throw fail(400,'任务编号无效。');
      const job=await get(jobKey(id));if(!job)throw fail(404,'任务不存在。');
      if(!terminal.has(job.state)&&job.expires<=Date.now()){
        job.state='failed';job.message='保存任务已超时，请重新提交。';await put(jobKey(id),job);
      }
      return json({id:job.id,city:job.city,state:job.state,message:job.message,createdAt:job.createdAt,updatedAt:job.updatedAt,result:job.result});
    }
    if(path==='/uploads'&&request.method==='POST'){
      const input=await jsonBody(request,1024);try{cityDataKey(input.city);}catch{throw fail(400,'城市名称无效。');}
      const size=input.bytes,parts=input.parts;
      if(!Number.isInteger(size)||size<2||size>MAX_CITY_BYTES||parts!==Math.ceil(size/CITY_CHUNK_BYTES)||!/^[a-f0-9]{64}$/.test(input.sha256||'')||![CITY_UPLOAD_FORMAT,CITY_RECORD_FORMAT,'json'].includes(input.format||'json'))throw fail(400,'上传信息无效或超过1GB（1GiB）。');
      return await serial('create',async()=>{
        const {active,reserved}=await gc();if(active>=8||reserved+size>MAX_CITY_BYTES*1.5)throw fail(429,'上传任务繁忙，请稍后重试。');
        if(clientIp){const key=`rate/${gatewaySignature(env.RATE_LIMIT_SALT!,clientIp).slice(0,40)}.json`,last=await get(key);
          if(last&&Date.now()-last.at<60000)throw fail(429,'提交过于频繁，请稍后重试。');await put(key,{at:Date.now()});}
        const id=randomUUID(),token=randomBytes(32).toString('hex'),now=Date.now(),expires=now+2*3600000;
        await put(sessionKey(id),{id,city:input.city,bytes:size,parts,sha256:input.sha256,format:input.format||'json',tokenHash:hash(token),expires});
        await put(jobKey(id),{id,city:input.city,state:'queued',message:'正在接收本地检索结果。',createdAt:now,updatedAt:now,expires,submitted:false});
        return json({id,token,chunkSize:CITY_CHUNK_BYTES});
      });
    }
    if(!match||!uuid.test(match[1]))throw fail(404,'没有这个上传接口。');
    const [,id,action,index]=match;
    const session:Session|null=await get(sessionKey(id));
    if(!session||session.expires<=Date.now())throw fail(409,'上传任务已过期。');
    if(!equal(hash(request.headers.get('x-city-upload-token')||''),session.tokenHash))throw fail(401,'上传认证失败。');
    if(request.method==='PUT'&&index!==undefined){
      const job=await get(jobKey(id));if(job.submitted||terminal.has(job.state))throw fail(409,'结果已提交保存。');
      const number=Number(index);if(!Number.isInteger(number)||number<0||number>=session.parts)throw fail(400,'片段编号无效。');
      const bytes=await bodyBytes(request,CITY_CHUNK_BYTES);
      if(bytes.length!==(number===session.parts-1?session.bytes-number*CITY_CHUNK_BYTES:CITY_CHUNK_BYTES))throw fail(400,'片段长度不符。');
      await store.set(`chunks/${id}/${number}`,bytes.buffer);return json({received:number});
    }
    return await serial(id,async()=>{
      const job=await get(jobKey(id));
      if(request.method==='DELETE'){
        if(job.submitted)throw fail(409,'结果正在保存，请等待完成。');
        await put(jobKey(id),{...job,state:'failed',message:'上传已取消。',updatedAt:Date.now()});await cleanup(id);return json({cancelled:true});
      }
      if(request.method!=='POST'||action!=='complete')throw fail(404,'没有这个上传接口。');
      if(job.submitted)return json({id,city:job.city,state:job.state,message:job.message},202);
      const uploaded=new Set((await store.list({prefix:`chunks/${id}/`,consistency:'strong'})).blobs.map(item=>item.key));
      for(let n=0;n<session.parts;n++)if(!uploaded.has(`chunks/${id}/${n}`))throw fail(409,'上传尚未完整，请重试。');
      await put(jobKey(id),{...job,submitted:true,message:'上传完成，等待校验并保存到 GitHub。',updatedAt:Date.now()});
      let response:Response;
      try{response=await transport(`https://api.github.com/repos/${repo}/actions/workflows/update-city-data.yml/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'Busline-EdgeOne-Gateway','Content-Type':'application/json'},body:JSON.stringify({ref,inputs:{city:session.city,request_id:id,uploaded:true}}),signal:AbortSignal.timeout(15000)});}catch{response=new Response(null,{status:502});}
      if(!response.ok){await put(jobKey(id),{...job,submitted:true,state:'failed',message:'无法确认远端保存任务是否启动，请稍后检查任务。',updatedAt:Date.now()});throw fail(502,'无法启动远端保存；本地地图不受影响。');}
      return json({id,city:job.city,state:'queued',message:'已提交，等待校验并保存到 GitHub。'},202);
    });
  }catch(error:any){const status=[400,401,403,404,405,409,410,413,429,502,503].includes(error.status)?error.status:503;
    return json({error:status===503?'上传服务暂时不可用，请稍后重试。':error.message},status);}
}
