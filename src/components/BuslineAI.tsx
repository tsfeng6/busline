import { getBuslineAIEndpoint, readBuslineAIResponse, describeBuslineAIError } from '../utils/buslineAIClient';
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Sparkles, Send, Loader2 } from 'lucide-react';

export interface AIRegionContext {
  city: string;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  lines: Array<{ name: string; start: string; end: string; stopsInArea: string[] }>;
}
interface Message { role: 'user' | 'assistant'; content: string; city?: string; lines?: string[] }
interface Props {
  onClose: () => void;
  context: AIRegionContext | null;
  disabled: boolean;
  searchProgress: string;
  onApply: (city: string, lines: string[]) => Promise<string>;
}

export function BuslineAI({ onClose, context, disabled, searchProgress, onApply }: Props) {
  const [mode, setMode] = useState<'summary' | 'filter'>('filter');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy, error]);
  const send = async () => {
    if (busy || applying || disabled || (mode === 'summary' && !context)) return;
    const question = input.trim() || (mode === 'summary' ? '请总结本次检索结果中的公交线网。' : '');
    if (!question) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setInput(''); setError(''); setBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 190000);
    try {
      const res = await fetch(getBuslineAIEndpoint(import.meta.env.VITE_API_BASE_URL || '', window.location.href), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ mode, message: question, history, context: mode === 'summary' ? context : { city: context?.city || '' } }),
      });
      const data = await readBuslineAIResponse(res);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, city: data.city, lines: data.lines }]);
    } catch (e: any) { if (!controller.signal.aborted) setError(describeBuslineAIError(e)); else setError('请求已停止或超时，请重试。'); }
    finally { window.clearTimeout(timeout); setBusy(false); }
  };
  return (
    <motion.aside initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
      aria-label="Busline AI 对话" className="fixed top-20 left-4 bottom-24 z-[70] w-[calc(100vw-32px)] sm:w-[380px] flex flex-col rounded-3xl bg-m3-surface/95 backdrop-blur-xl border border-m3-outline-variant/50 shadow-2xl overflow-hidden pointer-events-auto">
      <div className="px-4 py-3 flex items-center justify-between border-b border-m3-outline-variant/30">
        <div><h2 className="text-sm font-black text-m3-primary flex gap-2 items-center"><Sparkles className="w-4 h-4" />Busline AI</h2><p className="text-[10px] text-slate-500 mt-1">你的公交线网助手</p></div>
        <button onClick={onClose} aria-label="关闭 Busline AI" className="p-2 rounded-full hover:bg-m3-primary/10"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 flex gap-2">
        {(['filter', 'summary'] as const).map(item => <button key={item} onClick={() => setMode(item)} disabled={busy || applying} className={`flex-1 rounded-full py-2 text-xs font-bold transition-colors ${mode === item ? 'bg-m3-primary text-white' : 'bg-m3-surface-container text-slate-600'}`}>{item === 'filter' ? '线路筛选' : '区域总结'}</button>)}
      </div>
      <div className="px-4 pb-2 text-[11px] text-slate-500 leading-relaxed">{mode === 'summary' ? context ? `基于 ${context.city} 本次检索结果中 ${context.lines.length} 条线路。` : '先在地图上完成普通检索，即可总结检索结果中的公交线网。' : '例如：筛选北京市跨省公交线路。AI 提供候选，地图核验存在性。'}</div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-3">
        {messages.length === 0 && <div className="rounded-2xl p-4 bg-m3-primary-container/40 text-sm text-m3-on-primary-container leading-relaxed">你好，我是 Busline AI。告诉我你想找的线路，或让我解读当前区域的公交线网。</div>}
        {messages.map((m, index) => <div key={index} className={`rounded-2xl px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${m.role === 'user' ? 'ml-8 bg-m3-primary text-white' : 'mr-2 bg-m3-surface-container text-slate-800'}`}>
          {m.content}
          {!!m.lines?.length && m.city && <><p className="mt-2 font-bold">{m.city} · {m.lines.length} 条候选线路</p><p className="mt-1">{m.lines.join('、')}</p><button disabled={busy || applying || disabled} onClick={async () => {
            setApplying(true); setError('');
            try { const report = await onApply(m.city!, m.lines!); setMessages(prev => [...prev, { role: 'assistant', content: report }]); }
            catch (e: any) { setError(e.message || '加载线路失败，请重试。'); }
            finally { setApplying(false); }
          }} className="mt-3 px-3 py-2 rounded-xl bg-m3-primary text-white font-bold disabled:opacity-40">{applying ? '正在逐条检索…' : '逐条检索并全部显示到地图'}</button></>}
        </div>)}
        {searchProgress && <p role="status" className="text-xs text-m3-primary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin shrink-0" />{searchProgress}</p>}
        {busy && <p role="status" className="text-xs text-m3-primary flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Busline AI 正在深度思考…</p>}
        {error && <p role="alert" className="text-xs text-red-600 whitespace-pre-wrap">{error}</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={e => { e.preventDefault(); void send(); }} className="p-3 border-t border-m3-outline-variant/30 flex gap-2 items-end">
        <textarea aria-label="给 Busline AI 的需求" rows={2} maxLength={4000} value={input} onChange={e => setInput(e.target.value)} placeholder={mode === 'summary' ? '你想了解这片区域的什么？' : '输入城市和筛选条件…'} className="min-w-0 flex-1 resize-none rounded-2xl border border-m3-outline-variant/50 bg-m3-surface-container p-3 text-xs outline-none focus:border-m3-primary" />
        <button aria-label="发送" type="submit" disabled={busy || applying || disabled || (mode === 'summary' && !context) || (mode === 'filter' && !input.trim())} className="p-3 rounded-full bg-m3-primary text-white disabled:opacity-40"><Send className="w-4 h-4" /></button>
      </form>
      {disabled && <p className="px-4 pb-2 text-[10px] text-slate-500">请先结束游戏或等待地图检索完成。</p>}
    </motion.aside>
  );
}
