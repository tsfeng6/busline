import { AMAP_API_PRIVACY_NOTICE, citySearchApiStatus } from '../utils/citySearchApi';
import { DaxingMapPreview } from './DaxingMapPreview';
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  Check,
  Sparkles,
  Zap,
  RefreshCw,
  KeyRound,
  Compass,
  BoxSelect,
  X,
  Map as MapIcon,
  MapPin,
} from 'lucide-react';

interface OnboardingGuideProps {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  lineThickness: 'thick' | 'thin';
  setLineThickness: (val: 'thick' | 'thin') => void;
  enableLineCache: boolean;
  onSelectLineCache: (enabled: boolean) => void;
  useCustomApiKey: boolean;
  onSelectCustomApiKey: (enabled: boolean) => void;
  customApiKey: string;
  setCustomApiKey: (val: string) => void;
  customApiSecurityCode: string;
  setCustomApiSecurityCode: (val: string) => void;
  onFinishOnboarding: () => void;
  barButtonRefs: React.MutableRefObject<(HTMLElement | null)[]>;
}

interface TourStepInfo {
  title: string;
  desc: string;
  icon: React.ReactNode;
}

const TOUR_STEPS: TourStepInfo[] = [
  {
    title: '框选统计区域',
    desc: '在检索出线网后开启框选模式，可拖拽框选任意一片站点，批量查看区域内的公交线路汇总与通达度。',
    icon: <BoxSelect className="w-4 h-4 text-m3-primary" />,
  },
  {
    title: '清空当前画布',
    desc: '一键清除地图上已绘制的所有公交线网、站点标记与选中面板，还原清爽画布。',
    icon: <X className="w-4 h-4 text-[#B56666]" />,
  },
  {
    title: '检索公交线网',
    desc: '核心按钮！放大地图到街区比例后点击它，即可抓取当前区域的所有公交站点并绘制密度叠加线路网。',
    icon: <Compass className="w-4 h-4 text-m3-primary" />,
  },
  {
    title: '切换底图样式',
    desc: '点击在「正常底图 → 卫星底图 → 空白底图」间循环切换，选择空白底图可纯粹欣赏城市线网结构。',
    icon: <MapIcon className="w-4 h-4 text-m3-primary" />,
  },
  {
    title: '切换站点显示',
    desc: '点击在「显示全部站点 → 仅终点站 → 隐藏站点」间切换，快速聚焦各大枢纽总站或隐藏圆点。',
    icon: <MapPin className="w-4 h-4 text-m3-primary" />,
  },
];

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({
  step,
  setStep,
  lineThickness,
  setLineThickness,
  enableLineCache,
  onSelectLineCache,
  useCustomApiKey,
  onSelectCustomApiKey,
  customApiKey,
  setCustomApiKey,
  customApiSecurityCode,
  setCustomApiSecurityCode,
  onFinishOnboarding,
  barButtonRefs,
}) => {
  const [confirmSkipAll, setConfirmSkipAll] = useState(false);
  const [previewReplay, setPreviewReplay] = useState(0);
  const [apiErrorHint, setApiErrorHint] = useState('');
  const [bubblePos, setBubblePos] = useState<{
    left: number;
    bottom: number;
    arrowLeft: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    setConfirmSkipAll(false);
    setApiErrorHint('');
  }, [step]);

  useEffect(() => {
    if (step < 6 || step > 10) {
      setBubblePos(null);
      return;
    }

    const updatePosition = () => {
      const idx = step - 6;
      const el = barButtonRefs.current[idx];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const bubbleWidth = Math.min(288, vw - 24);
      const centerX = rect.left + rect.width / 2;
      let left = centerX - bubbleWidth / 2;
      left = Math.max(12, Math.min(vw - bubbleWidth - 12, left));
      const arrowLeft = Math.max(20, Math.min(bubbleWidth - 20, centerX - left));
      const bottom = window.innerHeight - rect.top + 18;
      setBubblePos({ left, bottom, arrowLeft, width: bubbleWidth });
    };

    updatePosition();
    const timer = setTimeout(updatePosition, 80);
    window.addEventListener('resize', updatePosition);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [step, barButtonRefs]);

  if (step === 0) return null;

  // Step 6 ~ 10: Bottom bar bubble tour
  if (step >= 6 && step <= 10) {
    const tourIdx = step - 6;
    const currentTour = TOUR_STEPS[tourIdx];
    const isLastTour = tourIdx === TOUR_STEPS.length - 1;

    return (
      <>
        <div
          className="fixed inset-0 z-[120] bg-slate-900/25 backdrop-blur-[1px] pointer-events-auto"
          onClick={() => {
            if (isLastTour) {
              onFinishOnboarding();
            } else {
              if(step>=5)onFinishOnboarding();else setStep(step + 1);
            }
          }}
        />
        <AnimatePresence mode="wait">
          {bubblePos && (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              style={{
                left: bubblePos.left,
                bottom: bubblePos.bottom,
                width: bubblePos.width,
              }}
              className="fixed z-[135] pointer-events-auto"
            >
              <div className="relative bg-m3-surface border border-m3-primary/35 rounded-2xl p-4 shadow-[0_14px_36px_rgba(28,47,39,0.25)]">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-m3-primary-container flex items-center justify-center shrink-0">
                      {currentTour.icon}
                    </div>
                    <h4 className="text-sm font-black text-slate-900">{currentTour.title}</h4>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-m3-surface-container text-[10px] font-black text-m3-primary shrink-0">
                    {tourIdx + 1} / {TOUR_STEPS.length}
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-600 leading-relaxed mb-3">
                  {currentTour.desc}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={onFinishOnboarding}
                    className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  >
                    跳过指引
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isLastTour) {
                        onFinishOnboarding();
                      } else {
                        if(step>=5)onFinishOnboarding();else setStep(step + 1);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-m3-primary text-m3-on-primary text-xs font-black shadow-sm hover:opacity-95 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{isLastTour ? '完成引导' : '下一步'}</span>
                    {isLastTour ? <Check className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Bubble downward pointer */}
                <div
                  style={{ left: bubblePos.arrowLeft - 8 }}
                  className="absolute -bottom-2 w-4 h-4 bg-m3-surface border-r border-b border-m3-primary/35 rotate-45"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // Step 1 ~ 5: Onboarding Wizard Cards
  const handleNext = () => {
    if (step === 4 && useCustomApiKey && citySearchApiStatus(true, customApiKey, customApiSecurityCode) === 'missing') {
      setApiErrorHint('请填写有效的高德 Web端 API Key 和 Security Code，或暂时关闭自定义 API，仅查看共享线路');
      return;
    }
    if(step>=5)onFinishOnboarding();else setStep(step + 1);
  };

  return (
    <div className="fixed inset-0 z-[130] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto">
      <AnimatePresence mode="wait">
        <motion.div
          key="onboarding-card"
          initial={{ opacity: 0, scale: 0.94, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: -10 }}
          transition={{ type: 'spring', damping: 24, stiffness: 240 }}
          className="w-[520px] max-w-[94vw] max-h-[92dvh] bg-m3-surface border border-m3-outline-variant/40 rounded-[28px] shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Top progress bar */}
          <div className="px-6 pt-5 pb-1 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <div
                  key={n}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    n === step
                      ? 'w-6 bg-m3-primary'
                      : n < step
                      ? 'w-2.5 bg-m3-primary/45'
                      : 'w-2.5 bg-m3-surface-container-highest'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] font-black text-slate-400 tracking-wider">
              {step} / 5
            </span>
          </div>

          {/* Step Content */}
          <div className="px-6 pt-4 pb-1 shrink-0">
            <DaxingMapPreview thickness={lineThickness} searchMode={step === 3 ? (enableLineCache ? 'fast' : 'realtime') : 'static'}
              replay={previewReplay} showCampusArrow={step >= 4 && !useCustomApiKey} />
          </div>
          <div className="px-6 py-4 flex flex-col gap-4 min-h-0 overflow-y-auto custom-scrollbar">
            {step === 1 && (
              <>

                <div className="space-y-1.5 pt-1">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container text-[10px] font-black">
                    <Sparkles className="w-3 h-3" />
                    busline 5.5
                  </div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">
                    欢迎使用巴士线路图
                  </h2>
                  <p className="text-xs font-medium text-slate-500 leading-relaxed">
                    探索城市公交线网分布、站点通达度与线路叠加密度的轻量级可视化工具。
                  </p>
                </div>
              </>
            )}

            {step === 2 && (
              <>

                <div className="space-y-2.5">
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">
                    您愿意选择何种粗细的线路？
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setLineThickness('thick')}
                      className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                        lineThickness === 'thick'
                          ? 'bg-m3-primary-container/50 border-m3-primary shadow-sm'
                          : 'bg-m3-surface-container-low border-m3-outline-variant/30 hover:border-m3-outline'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-black text-slate-900">粗线条</span>
                        <div className="w-8 h-2 rounded-full bg-[#5E8271]" />
                      </div>
                      <span className="text-[10px] font-medium text-slate-500 leading-tight block">
                        线条饱满醒目，适合整体线网密度俯瞰
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLineThickness('thin')}
                      className={`p-3 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                        lineThickness === 'thin'
                          ? 'bg-m3-primary-container/50 border-m3-primary shadow-sm'
                          : 'bg-m3-surface-container-low border-m3-outline-variant/30 hover:border-m3-outline'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-black text-slate-900">细线条</span>
                        <div className="w-8 h-[3px] rounded-full bg-[#5E8271]" />
                      </div>
                      <span className="text-[10px] font-medium text-slate-500 leading-tight block">
                        线条纤细利落，适合密集街区细节辨识
                      </span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <div className="space-y-3 py-1">
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  您愿意快速检索吗？
                </h2>
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => { onSelectLineCache(true); setPreviewReplay(value => value + 1); }}
                    className={`w-full p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-start gap-3 ${
                      enableLineCache
                        ? 'bg-m3-primary-container/50 border-m3-primary shadow-sm'
                        : 'bg-m3-surface-container-low border-m3-outline-variant/30 hover:border-m3-outline'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${enableLineCache ? 'bg-m3-primary text-m3-on-primary' : 'bg-m3-surface-container text-slate-600'}`}>
                      <Zap className="w-4.5 h-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-slate-900">快速检索</span>
                        {enableLineCache && (
                          <span className="px-2 py-0.5 rounded-full bg-m3-primary text-m3-on-primary text-[9px] font-black">
                            已开启线路缓存
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-medium text-slate-500 mt-1 leading-relaxed">
                        检索后缓存线路并加速下次检索
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => { onSelectLineCache(false); setPreviewReplay(value => value + 1); }}
                    className={`w-full p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-start gap-3 ${
                      !enableLineCache
                        ? 'bg-m3-primary-container/50 border-m3-primary shadow-sm'
                        : 'bg-m3-surface-container-low border-m3-outline-variant/30 hover:border-m3-outline'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${!enableLineCache ? 'bg-m3-primary text-m3-on-primary' : 'bg-m3-surface-container text-slate-600'}`}>
                      <RefreshCw className="w-4.5 h-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-black text-slate-900 block">实时检索</span>
                      <p className="text-[11px] font-medium text-slate-500 mt-1 leading-relaxed">
                        每次检索均调用API以获取实时线路数据
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3 py-1">
                <div className="space-y-1">
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">
                    您是否愿意提供自定义的API以检索？
                  </h2>
                  <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                    查看已有共享线路无需填写；城市缺少数据或需要重新检索时，须填写您自己的高德 API Key 与 Security Code。
                  </p>
                </div>

                {/* Toggle card matching Settings style */}
                <div className="p-3.5 rounded-2xl bg-m3-surface-container-low border border-m3-outline-variant/30 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shrink-0">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-800">全市检索使用自有高德 API</span>
                        <span className="text-[10px] font-medium text-slate-400">
                          {useCustomApiKey ? '仅全市检索使用您的 API' : '仅使用公共搜索与已有共享线路'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setApiErrorHint('');
                        onSelectCustomApiKey(!useCustomApiKey);
                      }}
                      className={`w-12 h-6.5 rounded-full transition-colors duration-200 relative flex items-center px-1 border-2 shrink-0 cursor-pointer ${
                        useCustomApiKey
                          ? 'bg-m3-primary border-m3-primary'
                          : 'bg-m3-surface-container-highest border-m3-outline'
                      }`}
                    >
                      <motion.div
                        animate={{ x: useCustomApiKey ? 22 : 0 }}
                        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        className={`rounded-full shadow-sm transition-colors duration-200 ${
                          useCustomApiKey
                            ? 'w-4.5 h-4.5 bg-m3-on-primary'
                            : 'w-3.5 h-3.5 bg-m3-outline'
                        }`}
                      />
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">{AMAP_API_PRIVACY_NOTICE}</p>
                  {useCustomApiKey && (
                    <div className="space-y-2.5 pt-2 border-t border-m3-outline-variant/20">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block mb-1">
                          高德 Web端 API Key (VITE_AMAP_KEY)
                        </label>
                        <input
                          type="text"
                          value={customApiKey}
                          onChange={(e) => {
                            setApiErrorHint('');
                            setCustomApiKey(e.target.value);
                          }}
                          placeholder="请输入高德API Key"
                          className="px-3.5 py-2 bg-m3-surface border border-m3-outline-variant text-slate-800 rounded-xl outline-none text-xs font-bold focus:border-m3-primary transition-all w-full"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block mb-1">
                          高德安全密钥 Security Code (VITE_AMAP_SECURITY_CODE)
                        </label>
                        <input
                          type="text"
                          value={customApiSecurityCode}
                          onChange={(e) => setCustomApiSecurityCode(e.target.value)}
                          placeholder="请输入高德API Security Code"
                          className="px-3.5 py-2 bg-m3-surface border border-m3-outline-variant text-slate-800 rounded-xl outline-none text-xs font-bold focus:border-m3-primary transition-all w-full"
                        />
                      </div>
                      {apiErrorHint ? (
                        <p className="text-[10px] font-bold text-red-500">{apiErrorHint}</p>
                      ) : (
                        <p className="text-[10px] font-medium text-slate-400">
                          配置自动保存在本机浏览器，下次全市检索时生效；普通搜索继续使用公共 API。
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="py-5 flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-m3-primary-container text-m3-on-primary-container flex items-center justify-center shadow-sm">
                  <Compass className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">
                  设置完成，开始浏览
                </h2>
                <p className="text-xs font-medium text-slate-500 leading-relaxed max-w-[320px]">
                  缩小查看各地线网概览，放大到城市后自动加载详细线路。暂无数据时，可按页面提示进行全市检索。
                </p>
              </div>
            )}
          </div>

          {/* Footer Action Bar */}
          <div className="px-6 pb-5 pt-2 flex items-center justify-between gap-3 shrink-0">
            {/* Left button: Skip on step 1 (with confirmation) or step 5 */}
            <div>
              {step === 1 && !confirmSkipAll && (
                <button
                  type="button"
                  onClick={() => setConfirmSkipAll(true)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-m3-surface-container transition-all cursor-pointer"
                >
                  进入地图
                </button>
              )}
              {step === 1 && confirmSkipAll && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onFinishOnboarding}
                    className="px-3 py-1.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-black transition-all cursor-pointer"
                  >
                    确认跳过全部
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmSkipAll(false)}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-m3-surface-container cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              )}
              {step === 5 && (
                <button
                  type="button"
                  onClick={onFinishOnboarding}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-m3-surface-container transition-all cursor-pointer"
                >
                  进入地图
                </button>
              )}
            </div>

            {/* Right prominent arrow button */}
            <motion.button
              type="button"
              onClick={handleNext}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              className="w-12 h-12 rounded-2xl bg-m3-primary text-m3-on-primary shadow-lg shadow-m3-primary/30 hover:opacity-95 flex items-center justify-center transition-all cursor-pointer ml-auto"
              title="下一步"
            >
              <ArrowRight className="w-5.5 h-5.5" />
            </motion.button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
