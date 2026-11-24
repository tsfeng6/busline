import {NearbyRoutes,type NearbyState} from './components/NearbyRoutes';
import { loadNearbyTransitTiles } from './utils/nearbyTransitTiles';
import {loadPublishedCities,loadGameCity} from './utils/publishedTransit';
import {createOfflineQuestion,shuffle} from './utils/offlineGame';
import {DAILY_LOCATION_KEY,claimDailyLocation,gpsToMap,nearbyLines,cityTouchesRadius,radiusRing,type PublishedCity,type Point} from './utils/localTransit';
import { getCitySearchServices } from './utils/citySearchRealm';
import { AMAP_API_PRIVACY_NOTICE, citySearchApiStatus } from './utils/citySearchApi';
import { resolveAmapCredentials } from './utils/amapCredentials';
import {MapActivityIndicator} from './components/MapActivityIndicator';
import { CityOverviewLayer } from './components/CityOverviewLayer';
import { ViewportTransitLayer, type ViewportTransitSelection, type ViewportRoute, type ViewportStop } from './components/ViewportTransitLayer';
import { GeometryDebugPanel } from './components/GeometryDebugPanel';
import { CITY_DETAIL_ZOOM } from './utils/cityOverview';
import { cityDataCache } from './utils/spatialLoader';
import { lazyTimelineRoute } from './utils/lazyTimelineRoute';
import { lazyStopMarker, viewportStopMarkers, syncLazyMarkers, clearStopMarkerGroup } from './utils/lazyStopMarker';
import { RouteRenderIndex, offsetRoutePath, type RenderRoute } from './utils/routeRenderIndex';
import { CityUploadDialog } from './components/CityUploadDialog';
import { uploadCitySnapshot } from './utils/cityUploadClient';
import { CityUpdateStatus } from './components/CityUpdateStatus';
import type { CityUpdateJob } from './utils/cityUpdateJobs';
import { CityDataPanel } from './components/CityDataPanel';
import { cityDatasetExpiresAt, normalizeCityDataset, type CityDataset } from './utils/cityDataset';
import { actionsCityUpdatesEnabled, cityUpdateJobs, loadSharedCity, invalidateSharedCityRead, gatewayBase, citySnapshotFresh, citySnapshotPreviewable, sharedCityDataEnabled } from './utils/sharedCityClient';
import { lineBaseIdentity, matchesLineQuery, matchesReturnedLine } from './utils/lineIdentity';
import { resolveSearchCity } from './utils/searchCity';
import { discoverStationLines, segmentGridKeys } from './utils/stationCoverage';
import { joinLineSegments } from './utils/mapPerformance';
import { getSuggestionKind, rankSearchSuggestions } from './utils/searchSuggestions';
import { BusPlanner } from './components/BusPlanner';
import { isLocalBusLine, type BusPlan, type PlannerPoint } from './utils/busPlanner';
import { TimelineBar } from './components/TimelineBar';
import { isLineOperating, updateTimelineVisibility, type TimelineOverlayEntry } from './utils/timeline';
import { discoverCityStops, searchCityLine } from './utils/citySearch';
import { getOperatingHours, SCHEDULE_DATA_VERSION } from './utils/operatingHours';
import { OperatingHours } from './components/OperatingHours';
import { BuslineAI, type AIRegionContext } from './components/BuslineAI';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { BusStop, BusLine, LineSegment } from './types';
import {
  APP_LINE_CACHE_ENABLED_KEY,
  GeoBox,
  LineCacheStats,
  checkAndPurgeIfMonthChanged,
  clearAllLineCache,
  getCityCacheData,
  getLineCacheStats,
  isSearchScopeCached,
  saveCitySearchToCache,
  saveLinesToCache,
} from './utils/lineCache';
import { Bus, Map as MapIcon, ZoomIn, Info, Loader2, List, X, Search, Camera, Eye, EyeOff, Navigation, Paintbrush, ClipboardCheck, Database, Trash2, Edit3, Undo, Redo, MapPin, Check, LogOut, Magnet, GitCommit, BoxSelect, ImagePlus, RefreshCw, AlertTriangle, Flag, Satellite, Minus, Plus, Zap, Gamepad2, Trophy, Award, Sparkles, Clock, Route, Shield, RotateCcw, History, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import { getGameHint, isGameHintComplete } from './utils/gameHint';
import { getGameTimeLimit, formatGameTime } from './utils/gameTimer';
import { establishGameSession, gameAccountEnabled, finishGameRun, getGameAccount, getGameLeaderboard, startGameRun, type GameAccount, type GameLeaderboardKey, type GameRun, type LeaderboardEntry } from './utils/gameAccount';
import { getWechatRegistrationToken, WechatAccountLink } from './components/WechatAccountLink';
import { GameModeVisual } from './components/GameModeVisual';
import { GameLadderPanel } from './components/GameLadderPanel';

const isFirebaseEnabled = () => true;

const submitLineToFirebase = async (data: any) => {
  const response = await fetch(`${API_BASE_URL}/api/submissions/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Submission failed');
  return response.json();
};

const fetchApprovedLinesFromFirebase = async () => {
  const response = await fetch(`${API_BASE_URL}/api/submissions/approved`);
  if (!response.ok) throw new Error('Failed to fetch approved lines');
  return response.json();
};

const checkSubmissionStatusFromFirebase = async (ids: string[]) => {
  const response = await fetch(`${API_BASE_URL}/api/submissions/status?ids=${ids.join(',')}`);
  if (!response.ok) return {};
  return response.json();
};

const getPendingSubmissionsFromFirebase = async (adminSession?: string) => {
  const response = await fetch(`${API_BASE_URL}/api/admin/pending`, {
    headers: { 'x-admin-session': adminSession || '' }
  });
  if (!response.ok) throw new Error('Failed to fetch pending lines (Unauthorized)');
  return response.json();
};

const updateSubmissionStatusInFirebase = async (id: string, status: string, rejectReason?: string, adminSession?: string) => {
  const endpoint = status === 'approved' ? '/api/admin/approve' : '/api/admin/reject';
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-admin-session': adminSession || ''
    },
    body: JSON.stringify({ id, rejectReason }),
  });
  if (!response.ok) throw new Error('Failed to update status (Unauthorized)');
  return response.json();
};

const editApprovedLineInFirebase = async (id: string, name: string, adminSession?: string) => {
  const response = await fetch(`${API_BASE_URL}/api/admin/edit-approved`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-admin-session': adminSession || ''
    },
    body: JSON.stringify({ id, name }),
  });
  if (!response.ok) throw new Error('Failed to edit approved line (Unauthorized)');
  return response.json();
};

const deleteApprovedLineInFirebase = async (id: string, adminSession?: string) => {
  const response = await fetch(`${API_BASE_URL}/api/admin/delete-approved`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-admin-session': adminSession || ''
    },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error('Failed to delete approved line (Unauthorized)');
  return response.json();
};

const getInitialAmapConfig = () => {
  const defaultKey = import.meta.env.VITE_AMAP_KEY || '20f5c6b65349e5d4cb5f58c7e0c4a4ba'; 
  const defaultSecurityCode = import.meta.env.VITE_AMAP_SECURITY_CODE || '312d8a4369a48971f1f9e2b19280d075';
  let storage: Storage | undefined;
  try { storage = typeof window === 'undefined' ? undefined : window.localStorage; } catch { storage = undefined; }
  return resolveAmapCredentials(storage, defaultKey, defaultSecurityCode);
};

const initialAmapConfig = getInitialAmapConfig();
const AMAP_KEY = initialAmapConfig.key;
const SECURITY_CODE = initialAmapConfig.securityCode;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const ADMIN_GATEWAY_URL = (import.meta.env.VITE_GAME_GATEWAY_URL || import.meta.env.VITE_CITY_UPDATE_GATEWAY_URL || API_BASE_URL || '').replace(/\/$/, '');
const APP_VERSION = '5.5';
const APP_LAST_VERSION_KEY = 'app_last_visited_version';

const compareVersions = (v1: string, v2: string): number => {
  const p1 = v1.split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = v2.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
};

if (typeof window !== 'undefined') {
  (window as any)._AMapSecurityConfig = {
    securityJsCode: SECURITY_CODE,
  };
}

const checkIsLineQuery = (str: string): boolean => {
  if (!str) return false;
  const s = str.normalize('NFKC').trim();
  // District names such as 下花园 are valid route prefixes despite containing 园.
  if (/^[\u4e00-\u9fffA-Za-z]{0,12}\d{1,4}(?:路|线)?(?:快|慢|支|区间|内环|外环)?$/.test(s)) return true;
  const excludeWords = ['站', '口', '校区', '公寓', '小区', '公园', '中心', '大厦', '大学', '中学', '小学', '医院', '市场', '公司', '广场', '胡同', '街', '路口', '桥', '枢纽', '住宅', '东门', '西门', '南门', '北门', '酒店', '餐', '超市', '商场', '银行', '居委会', '村', '寺', '庙', '庭', '园', '苑', '府', '湾'];
  if (excludeWords.some(w => s.includes(w))) {
    return false;
  }

  if (/\d+/.test(s)) {
    if (s.includes('号') || s.includes('楼') || s.includes('室') || s.includes('层')) {
      return false;
    }
    return true;
  }

  const linePrefixes = ['专', '特', '夜', '快', '临', '观', '游', '环', '双', '支', '通勤', '快速直达', '客运', '郊', '捷'];
  if (linePrefixes.some(p => s.startsWith(p))) {
    return true;
  }

  const lineSuffixes = ['路线', '环线', '班车', '大巴', '巴士', '专线', '快线', '公交'];
  if (lineSuffixes.some(suff => s.endsWith(suff))) {
    return true;
  }

  const regionalPrefixes = /^(兴|通|顺|房|门|昌|平|大|密|怀|延|社|航|高|微)/;
  if (regionalPrefixes.test(s)) {
    return true;
  }

  return false;
};

const isValidBusLineName = (s: string): boolean => {
  if (!s || s.length === 0 || s.length > 20) return false;
  const clean = s.trim();
  const badSubstrings = ['附近', '交叉口', '靠近', '沿线', '胡同', '街道', '路口', '政府', '医院', '学校', '公寓', '小区', '公园', '中心', '大厦', '大路', '公路', '国道', '省道', '高速'];
  if (badSubstrings.some(b => clean.includes(b))) {
    return false;
  }
  const hasDigit = /\d+/.test(clean);
  const hasLetter = /[A-Za-z]+/.test(clean);
  const busKeywords = /路|线|专线|临线|支线|区间|快线|快速|捷运|直达|通勤|班车|穿梭|高快|夜班|快车|慢车|大巴|巴士|常规|高峰|社区|地铁|轻轨|公交/;
  return hasDigit || hasLetter || busKeywords.test(clean);
};

const getLatLng = (loc: any): [number, number] => {
  if (!loc) return [0, 0];
  if (Array.isArray(loc)) return [Number(loc[0] || 0), Number(loc[1] || 0)];
  const lng = typeof loc.getLng === 'function' ? loc.getLng() : (typeof loc.lng === 'number' ? loc.lng : parseFloat(loc.lng || 0));
  const lat = typeof loc.getLat === 'function' ? loc.getLat() : (typeof loc.lat === 'number' ? loc.lat : parseFloat(loc.lat || 0));
  return [lng || 0, lat || 0];
};

const compressImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const parseDataSourceImages = (val: string | null | undefined): string[] => {
  if (!val) return [];
  const trimmed = val.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return [val];
    }
  }
  return [val];
};

export default function App() {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isBoxSelectMode, setIsBoxSelectMode] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxSelectStartPos, setBoxSelectStartPos] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEndPos, setBoxSelectEndPos] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectedStops, setBoxSelectedStops] = useState<any[]>([]);
  const [isBoxPanelCollapsed, setIsBoxPanelCollapsed] = useState(false);
  const allMapStopsRef = useRef<Map<string, any>>(new Map());
  const fetchedLinesCache = useRef<Map<string, BusLine>>(new Map());
  const markerGroupRef = useRef<any>(null);
  const lineGroupRef = useRef<any>(null);
  const selectionMarkerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  // Search results preservation refs
  const roadOverlaysRef = useRef<any[]>([]);
  const roadViewportCleanupRef = useRef<(() => void) | null>(null);
  const roadStopMarkersRef = useRef<any[]>([]);
  const activeRawMarkersRef = useRef<any[]>([]);
  const roadStopsDataRef = useRef<Map<string, any>>(new Map());
  const activeBusLinePolylineRef = useRef<any | null>(null);

  const searchVersionRef = useRef<number>(0);
  const aggregateVersionRef = useRef(0);
  const roadLookupVersionRef = useRef(0);
  const isClearedRef = useRef<boolean>(false);

  const getStopColor = useCallback((count: number, defaultColor: string) => {
    if (!stationLineStatsRef.current || count === 0) return defaultColor;
    if (count <= 2) return '#5E8271'; // Morandi Sage Green
    if (count <= 6) return '#C29B63'; // Morandi Warm Ochre
    return '#B56666'; // Morandi Dusty Terracotta
  }, []);

  const mapClickHandlerRef = useRef<any>(null);
  const defaultMapClickHandlerRef = useRef<any>(null);
  const mapPointVersionRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [nearbyPanel,setNearbyPanel]=useState<NearbyState|null>(null);
  const dailyLocationCheckedRef=useRef(false);
  const locationRequestRef=useRef(0);
  const nearbyRequestRef=useRef<AbortController | null>(null);
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('map_zoom');
    return saved ? parseFloat(saved) : 11;
  });
  const [selectedSegmentLines, setSelectedSegmentLines] = useState<string[] | null>(null);
  useEffect(() => {
    if (!selectedSegmentLines) {
      roadLookupVersionRef.current++;
      selectedViewportRoutesRef.current = [];
    }
  }, [selectedSegmentLines]);
  const [selectedStop, setSelectedStop] = useState<any | null>(null);
  const [stationConnectivityCard, setStationConnectivityCard] = useState<{
    stop: any;
    checkedLines: Set<string>;
    transferEnabled: boolean;
    atStation: number;
    aiSummary?: string;
    deepseekKey?: string;
  } | null>(null);

  // Minigame States & Logic
  const [showMinigameModal, setShowMinigameModal] = useState(false);
  const [gameMode, setGameMode] = useState<'line' | 'station' | 'city' | 'county' | null>(null);
  const [gameDifficulty, setGameDifficulty] = useState<'easy' | 'medium' | 'hard' | 'hell'>('easy');
  const [gameCity, setGameCity] = useState('北京市');
  const [gameProvince, setGameProvince] = useState('北京市');
  const [gameCountyProvince, setGameCountyProvince] = useState('浙江省');
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover' | 'review'>('menu');
  const [gameLoading, setGameLoading] = useState(false);
  const [gameLoadingText, setGameLoadingText] = useState('正在读取已有线路数据…');
  const [gameScore, setGameScore] = useState(0);
  const [gameAccount, setGameAccount] = useState<GameAccount | null>(null);
  // The literal marker means that the authenticated session is held only in
  // the HttpOnly gateway cookie, never in JavaScript-accessible storage.
  const [gameAccessToken, setGameAccessToken] = useState('');
  // Do not show a login prompt until the HttpOnly session restore has answered.
  // On slower gateways this prevents a signed-in player from briefly seeing
  // the unauthenticated state before their profile arrives.
  const [gameAuthLoading, setGameAuthLoading] = useState(gameAccountEnabled);
  const gameSessionRestoreRef = useRef<ReturnType<typeof getGameAccount> | null>(null);
  const [gameAuthMessage, setGameAuthMessage] = useState('');
  const [ladderBoards, setLadderBoards] = useState<{ standard: LeaderboardEntry[]; hell: LeaderboardEntry[] }>({ standard: [], hell: [] });
  const [gameLaunchAnimation, setGameLaunchAnimation] = useState(false);

  // Supabase's server-generated magic link returns the short-lived session in
  // the fragment. Remove it from the address bar and establish the cookie
  // before reading the profile.
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    // Supabase may normalize an allowed redirect URL to the Site URL and drop
    // its query string. The fragment is never sent to the server, so accepting
    // its access token here is safe and makes either redirect form work.
    const accessToken = fragment.get('access_token');
    if (!gameAccountEnabled) return;
    let cancelled = false;
    setGameAuthLoading(true);
    if (!gameSessionRestoreRef.current) {
      if (accessToken) window.history.replaceState({}, '', window.location.pathname + window.location.search);
      gameSessionRestoreRef.current = accessToken
        ? establishGameSession(accessToken)
        : getGameAccount();
    }
    const pendingProfile = gameSessionRestoreRef.current;
    const restore = async () => {
      try {
        const { account } = await pendingProfile;
        if (cancelled) return;
        setGameAccount(account);
        setGameAccessToken('cookie');
      } catch (error: any) {
        if (cancelled) return;
        if (error?.status !== 401) setGameDataError('暂时无法确认登录状态，请稍后重试。');
      } finally {
        if (!cancelled) {
          setGameAuthLoading(false);
        }
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [gameCatalog,setGameCatalog]=useState<PublishedCity[]>([]);
  const [gameDataError,setGameDataError]=useState('');
  const [gameCatalogLoading,setGameCatalogLoading]=useState(false);
  const gameProvinces=[...new Set(gameCatalog.map(item=>item.province).filter(Boolean))];
  const gameCities=gameCatalog.filter(item=>item.province===gameProvince);
  const countyProvinces=[...new Set(gameCatalog.filter(item=>item.countySeats.length).map(item=>item.province).filter(Boolean))];
  useEffect(()=>{
    if(!showMinigameModal)return;
    let cancelled=false;setGameCatalogLoading(true);setGameDataError('');
    loadPublishedCities(true).then(catalog=>{if(cancelled)return;setGameCatalog(catalog);
      const provinces=[...new Set(catalog.map(item=>item.province).filter(Boolean))];
      setGameProvince(previous=>provinces.includes(previous)?previous:provinces[0]||'');
      const counties=[...new Set(catalog.filter(item=>item.countySeats.length).map(item=>item.province).filter(Boolean))];
      setGameCountyProvince(previous=>counties.includes(previous)?previous:counties[0]||'');
    }).catch(error=>{if(!cancelled)setGameDataError(error.message);}).finally(()=>{if(!cancelled)setGameCatalogLoading(false);});
    return()=>{cancelled=true;};
  },[showMinigameModal]);
  useEffect(()=>{if(gameCities.length&&!gameCities.some(item=>item.city===gameCity))setGameCity(gameCities[0].city);},[gameCatalog,gameProvince,gameCity]);
  const countyMaskRef=useRef<any>(null);
  const setCountyGameMask=(center?:Point,radius=3000)=>{
    const map=mapRef.current,AMap=(window as any).AMap;
    if(countyMaskRef.current){map?.remove(countyMaskRef.current);countyMaskRef.current=null;}
    if(!center||!map||!AMap?.Polygon)return;
    const outer=[[60,-5],[150,-5],[150,65],[60,65],[60,-5]];
    const polygon=new AMap.Polygon({path:[outer,radiusRing(center,radius).reverse()],fillColor:'#f5f5f3',fillOpacity:1,strokeWeight:0,strokeOpacity:0,zIndex:950,bubble:true});
    map.add(polygon);countyMaskRef.current=polygon;
  };

  const [gameTimeLeft, setGameTimeLeft] = useState<number | null>(null);
  const [gameTimedOut, setGameTimedOut] = useState(false);
  const gameTimeRemainingMsRef = useRef<number | null>(null);
  const gameDeadlineRef = useRef<number | null>(null);
  const gameTimedOutRef = useRef(false);
  const [gameHints, setGameHints] = useState({ remaining: 7, usedOnQuestion: 0 });
  const handleGameHint = () => {
    if (gameState !== 'playing' || gameLoading || gameFeedback || !gameQuestionData || gameTimedOutRef.current) return;
    setGameHints(prev => {
      if (prev.remaining <= 0 || isGameHintComplete(gameQuestionData.correctAnswer, prev.usedOnQuestion)) return prev;
      return { remaining: prev.remaining - 1, usedOnQuestion: prev.usedOnQuestion + 1 };
    });
  };
  const [gameQuestionNum, setGameQuestionNum] = useState(1);
  const [gameQuestionData, setGameQuestionData] = useState<{
    correctAnswer: string;
    options?: string[];
    isFillIn: boolean;
    promptText: string;
  } | null>(null);
  const [gameUserInput, setGameUserInput] = useState('');
  const [gameFeedback, setGameFeedback] = useState<{ correct: boolean; msg: string } | null>(null);
  type GameHistoryItem = {
    questionNum: number;
    mode: 'line' | 'station' | 'city' | 'county';
    difficulty: 'easy' | 'medium' | 'hard' | 'hell';
    targetCity: string;
    province?: string;
    promptText: string;
    correctAnswer: string;
    userAnswer: string;
    isCorrect: boolean;
    lineInfos?: any[];
    networkPaths?: Array<[number, number][]>;
    networkStops?: Array<{ name?: string; lngLat: [number, number] }>;
    targetPoint?: { name: string; lngLat: [number, number] };
    fallbackCenter?: [number, number];
    countyWindow?: {center: Point; radius:number};
  };
  const [gameHistory, setGameHistory] = useState<GameHistoryItem[]>([]);
  const currentGameQuestionRef = useRef<Omit<GameHistoryItem, 'userAnswer' | 'isCorrect'> | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewShowBasemap, setReviewShowBasemap] = useState(true);
  const [reviewShowStops, setReviewShowStops] = useState(true);
  const [reviewAutoPlay, setReviewAutoPlay] = useState(false);
  const [reviewHoveredStop, setReviewHoveredStop] = useState<string | null>(null);
  const prevMapModeBeforeGameRef = useRef<'normal' | 'satellite' | 'blank' | null>(null);
  const gameSessionIdRef = useRef(0);
  const gameRunRef = useRef<GameRun | null>(null);
  const isMinigameActiveRef = useRef(false);
  const leaderboardScope = (mode: 'line' | 'station' | 'city' | 'county', city = gameCity, province = gameCountyProvince) => mode === 'city' ? '全国' : mode === 'county' ? province : city || '北京市';
  const leaderboardKey = (mode: 'line' | 'station' | 'city' | 'county', difficulty: 'easy' | 'medium' | 'hard' | 'hell', scope = leaderboardScope(mode)): GameLeaderboardKey =>
    ({ game: mode, difficulty: (mode === 'line' || mode === 'station' ? difficulty : 'hard') as GameLeaderboardKey['difficulty'], scope });
  const ladderCacheRef = useRef(new Map<string, { entries: LeaderboardEntry[]; at: number }>());
  const ladderRequestsRef = useRef(new Map<string, Promise<LeaderboardEntry[]>>());
  const ladderEntryCacheKey = (key: GameLeaderboardKey) => `${gameAccount?.id || 'anonymous'}\u0001${key.game}\u0001${key.difficulty}\u0001${key.scope || '北京市'}`;
  const loadLeaderboardEntries = useCallback((key: GameLeaderboardKey) => {
    const cacheKey = ladderEntryCacheKey(key);
    const ongoing = ladderRequestsRef.current.get(cacheKey);
    if (ongoing) return ongoing;
    const request = getGameLeaderboard(key, gameAccessToken || undefined)
      .then(result => {
        ladderCacheRef.current.set(cacheKey, { entries: result.entries, at: Date.now() });
        return result.entries;
      })
      .finally(() => ladderRequestsRef.current.delete(cacheKey));
    ladderRequestsRef.current.set(cacheKey, request);
    return request;
  }, [gameAccessToken, gameAccount?.id]);
  const warmLadderBoards = useCallback((mode: 'line' | 'station' | 'city' | 'county', scope: string) => {
    const standard = leaderboardKey(mode, mode === 'line' || mode === 'station' ? 'easy' : 'hard', scope);
    const hell = mode === 'line' || mode === 'station' ? leaderboardKey(mode, 'hell', scope) : null;
    return Promise.all([loadLeaderboardEntries(standard), hell ? loadLeaderboardEntries(hell) : Promise.resolve([] as LeaderboardEntry[])]);
  }, [loadLeaderboardEntries]);
  const refreshLadderBoards = useCallback(async (mode: 'line' | 'station' | 'city' | 'county', scope: string) => {
    if (!gameAccountEnabled) return;
    const standard = leaderboardKey(mode, mode === 'line' || mode === 'station' ? 'easy' : 'hard', scope);
    const hell = mode === 'line' || mode === 'station' ? leaderboardKey(mode, 'hell', scope) : null;
    const cachedStandard = ladderCacheRef.current.get(ladderEntryCacheKey(standard))?.entries;
    const cachedHell = hell ? ladderCacheRef.current.get(ladderEntryCacheKey(hell))?.entries : [];
    const hasCachedBoard = !!cachedStandard && (!hell || !!cachedHell);
    // Render a known board synchronously, then revalidate it quietly. The
    // first-ever visit still shows the loading state until a board exists.
    if (hasCachedBoard) setLadderBoards({ standard: cachedStandard, hell: cachedHell || [] });
    setLeaderboardLoading(!hasCachedBoard);
    try {
      const [normal, hard] = await warmLadderBoards(mode, scope);
      setLadderBoards({ standard: normal, hell: hard });
    } catch {
      if (!hasCachedBoard) setLadderBoards({ standard: [], hell: [] });
    } finally {
      setLeaderboardLoading(false);
    }
  }, [gameAccount?.id, warmLadderBoards]);
  useEffect(() => {
    if (!gameAccountEnabled || !gameAccessToken) return;
    // Warm each default scope after the map and account have settled. This
    // happens outside the modal, so selecting any mode is normally instant.
    const timer = window.setTimeout(() => {
      void warmLadderBoards('line', leaderboardScope('line'));
      void warmLadderBoards('station', leaderboardScope('station'));
      void warmLadderBoards('city', leaderboardScope('city'));
      void warmLadderBoards('county', leaderboardScope('county'));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [gameAccessToken, gameCity, gameCountyProvince, warmLadderBoards]);
  useEffect(() => {
    if (!showMinigameModal || !gameAccountEnabled) return;
    const mode = gameMode || 'line', scope = leaderboardScope(mode);
    void refreshLadderBoards(mode, scope);
  }, [showMinigameModal, gameAccessToken, gameMode, gameCity, gameCountyProvince, refreshLadderBoards]);
  const settleGameLeaderboard = useCallback((score: number) => {
    const run = gameRunRef.current;
    gameRunRef.current = null;
    if (!run || !gameAccessToken) return;
    void finishGameRun(run.id, score, gameAccessToken)
      .then(() => refreshLadderBoards(run.game, run.scope || '北京市'))
      .catch((error: any) => {
        const reason = error?.message || '服务暂时不可用';
        setGameAuthMessage(`本局未能写入排行榜：${reason}`);
        setGameDataError(`本局成绩未能写入排行榜：${reason}`);
      });
  }, [gameAccessToken, refreshLadderBoards]);
  const finishGameOnTimeout = useCallback(() => {
    if (gameTimedOutRef.current) return;
    gameTimedOutRef.current = true;
    gameTimeRemainingMsRef.current = 0;
    gameDeadlineRef.current = null;
    gameSessionIdRef.current++;
    setGameTimeLeft(0);
    setGameTimedOut(true);
    setGameLoading(false);
    setGameFeedback(null);
    setConfirmQuitGame(false);
    setGameState('gameover');
    settleGameLeaderboard(gameScore);
  }, [gameScore, settleGameLeaderboard]);

  // Use a deadline so background-tab throttling cannot extend the challenge.
  // Loading questions pauses the clock; each new question keeps the same budget.
  useEffect(() => {
    const budget = gameTimeRemainingMsRef.current;
    if (gameState !== 'playing' || gameLoading || !gameQuestionData || budget === null || gameTimedOutRef.current) return;
    const deadline = Date.now() + budget;
    gameDeadlineRef.current = deadline;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setGameTimeLeft(Math.ceil(remaining / 1000));
      if (remaining === 0) finishGameOnTimeout();
    };
    tick();
    const interval = window.setInterval(tick, 200);
    return () => {
      window.clearInterval(interval);
      if (!gameTimedOutRef.current) gameTimeRemainingMsRef.current = Math.max(0, deadline - Date.now());
      gameDeadlineRef.current = null;
    };
  }, [gameState, gameLoading, gameQuestionData, finishGameOnTimeout]);

  const [confirmQuitGame, setConfirmQuitGame] = useState(false);
  const [bestRecords, setBestRecords] = useState(() => {
    const defaultRecords = {
      line: { easy: 0, medium: 0, hard: 0, hell: 0 },
      station: { easy: 0, medium: 0, hard: 0, hell: 0 },
      city: { hard: 0 },
      county: { hard: 0 },
      migratedHell: true
    };
    try {
      const saved = localStorage.getItem('busline_minigame_records');
      if (!saved) return defaultRecords;
      const parsed = JSON.parse(saved);
      const migratedCounty = Math.max(parsed.county?.hard || 0, parsed.city?.county || 0);
      const alreadyMigratedHell = parsed.migratedHell === true;
      const migrateModeRecords = (rec: any) => {
        if (!rec) return { easy: 0, medium: 0, hard: 0, hell: 0 };
        if (!alreadyMigratedHell) {
          return {
            easy: rec.easy || 0,
            medium: rec.medium || 0,
            hard: 0,
            hell: Math.max(rec.hell || 0, rec.hard || 0)
          };
        }
        return {
          easy: rec.easy || 0,
          medium: rec.medium || 0,
          hard: rec.hard || 0,
          hell: rec.hell || 0
        };
      };
      const migrated = {
        line: migrateModeRecords(parsed.line),
        station: migrateModeRecords(parsed.station),
        city: { hard: parsed.city?.hard || 0 },
        county: { hard: migratedCounty },
        migratedHell: true
      };
      if (!alreadyMigratedHell) {
        localStorage.setItem('busline_minigame_records', JSON.stringify(migrated));
      }
      return migrated;
    } catch (e) {
      return defaultRecords;
    }
  });

  const getRating = (mode: string, score: number) => {
    if (mode === 'line' || mode === 'station' || mode === 'county') {
      if (score >= 30) return { title: '巴士之神', color: 'text-amber-500 bg-amber-50 border-amber-200' };
      if (score >= 20) return { title: '王者', color: 'text-purple-600 bg-purple-50 border-purple-200' };
      if (score >= 15) return { title: '钻石', color: 'text-blue-600 bg-blue-50 border-blue-200' };
      if (score >= 10) return { title: '黄金', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' };
      if (score >= 5) return { title: '白银', color: 'text-slate-600 bg-slate-100 border-slate-200' };
      return { title: '青铜', color: 'text-amber-700 bg-amber-100/50 border-amber-200/50' };
    } else {
      if (score >= 8) return { title: '巴士之神', color: 'text-amber-500 bg-amber-50 border-amber-200' };
      if (score >= 6) return { title: '王者', color: 'text-purple-600 bg-purple-50 border-purple-200' };
      if (score >= 4) return { title: '黄金', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' };
      if (score >= 2) return { title: '白银', color: 'text-slate-600 bg-slate-100 border-slate-200' };
      return { title: '青铜', color: 'text-amber-700 bg-amber-100/50 border-amber-200/50' };
    }
  };

  const restoreMapAfterMinigame = () => {
    setCountyGameMask();
    if (prevMapModeBeforeGameRef.current) {
      setMapMode(prevMapModeBeforeGameRef.current);
      prevMapModeBeforeGameRef.current = null;
    }
    if (lineGroupRef.current) lineGroupRef.current.clearOverlays();
    if (markerGroupRef.current) clearStopMarkerGroup(markerGroupRef.current);
  };

  const clearMapStateForMinigame = () => {
    setCountyGameMask();
    handleClear();
    if (drawingGroupRef.current) {
      try { drawingGroupRef.current.clearOverlays(); } catch {}
    }
    if (locationMarkerRef.current) {
      try {
        locationMarkerRef.current.setMap(null);
        if (mapRef.current) mapRef.current.remove(locationMarkerRef.current);
      } catch {}
      locationMarkerRef.current = null;
    }
    setIsDrawingMode(false);
    setStationConnectivityCard(null);
  };

  const exitMinigameToMap = () => {
    gameSessionIdRef.current++;
    gameRunRef.current = null;
    isMinigameActiveRef.current = false;
    setConfirmQuitGame(false);
    setShowMinigameModal(false);
    setGameState('menu');
    setGameLoading(false);
    setGameQuestionData(null);
    setGameFeedback(null);
    setGameUserInput('');
    setReviewAutoPlay(false);
    setReviewHoveredStop(null);
    restoreMapAfterMinigame();
  };

  const returnToMinigameMenu = () => {
    gameSessionIdRef.current++;
    gameRunRef.current = null;
    isMinigameActiveRef.current = false;
    setConfirmQuitGame(false);
    setGameState('menu');
    setGameLoading(false);
    setGameQuestionData(null);
    setGameFeedback(null);
    setGameUserInput('');
    setReviewAutoPlay(false);
    setReviewHoveredStop(null);
    restoreMapAfterMinigame();
  };

  const startMinigameReview = () => {
    if (gameHistory.length === 0) return;
    isMinigameActiveRef.current = true;
    clearMapStateForMinigame();
    if (!prevMapModeBeforeGameRef.current) {
      prevMapModeBeforeGameRef.current = mapMode;
    }
    setConfirmQuitGame(false);
    setReviewIndex(0);
    setReviewAutoPlay(false);
    setReviewHoveredStop(null);
    setGameState('review');
  };

  useEffect(() => {
    isMinigameActiveRef.current = showMinigameModal && (gameState === 'playing' || gameState === 'review');
  }, [showMinigameModal, gameState]);

  useEffect(() => {
    if (!showMinigameModal || gameState !== 'review' || !reviewAutoPlay) return;
    if (reviewIndex >= gameHistory.length - 1) {
      setReviewAutoPlay(false);
      return;
    }
    const timer = setTimeout(() => {
      setReviewIndex(idx => Math.min(gameHistory.length - 1, idx + 1));
    }, 3500);
    return () => clearTimeout(timer);
  }, [showMinigameModal, gameState, reviewAutoPlay, reviewIndex, gameHistory.length]);

  const startMinigame = (
    mode: 'line' | 'station' | 'city' | 'county',
    diff: 'easy' | 'medium' | 'hard' | 'hell',
    city: string,
    province?: string
  ) => {
    if (gameLoading || (gameState === 'playing' && isMinigameActiveRef.current)) return;
    if (!(window as any).AMap || !mapInstance) {
      setApiErrorNotification('地图尚未就绪，请稍后再开始游戏。');
      return;
    }
    const activeProv = province ?? (mode === 'county' ? gameCountyProvince : gameProvince);
    const launchId = ++gameSessionIdRef.current;
    gameRunRef.current = null;
    setGameDataError('');
    setGameAuthMessage('');

    const launch = (run: GameRun | null, message = '') => {
      if (gameSessionIdRef.current !== launchId) return;
      gameRunRef.current = run;
      setGameAuthMessage(message);
      setGameLaunchAnimation(true);
      window.setTimeout(() => setGameLaunchAnimation(false), 1150);
      isMinigameActiveRef.current = true;
      if (!prevMapModeBeforeGameRef.current) prevMapModeBeforeGameRef.current = mapMode;
      clearMapStateForMinigame();
      setGameMode(mode);
      setGameDifficulty(diff);
      setGameCity(city);
      const timeLimit = getGameTimeLimit(mode, diff);
      gameTimeRemainingMsRef.current = timeLimit === null ? null : timeLimit * 1000;
      gameDeadlineRef.current = null;
      gameTimedOutRef.current = false;
      setGameTimedOut(false);
      setGameTimeLeft(timeLimit);
      setGameState('playing');
      setGameScore(0);
      setGameHints({ remaining: 7, usedOnQuestion: 0 });
      setGameQuestionNum(1);
      setGameFeedback(null);
      setGameUserInput('');
      setGameQuestionData(null);
      setGameHistory([]);
      currentGameQuestionRef.current = null;
      setReviewIndex(0);
      setReviewAutoPlay(false);
      setReviewHoveredStop(null);
      setMapMode('normal');
      void generateQuestion(mode, diff, city, 1, undefined, activeProv);
    };

    if (!gameAccountEnabled || !gameAccount || !gameAccessToken) {
      launch(null, '本局成绩仅保存在本机。');
      return;
    }
    setGameLoading(true);
    setGameLoadingText('正在建立排行榜会话…');
    void startGameRun(leaderboardKey(mode, diff, leaderboardScope(mode, city, activeProv)), gameAccessToken)
      .then(({ run }) => launch(run), (error: any) => {
        if (gameSessionIdRef.current !== launchId) return;
        if (error?.status === 401) {
          setGameAccount(null);
          setGameAccessToken('');
        }
        launch(null, '本局成绩仅保存在本机，未计入排行榜。');
      });
  };

  const generateQuestion = async (
    mode: 'line' | 'station' | 'city' | 'county', diff: 'easy' | 'medium' | 'hard' | 'hell', city: string,
    qNum: number, prevAnswer?: string, provinceOverride?: string
  ) => {
    const AMap = (window as any).AMap;
    if (!AMap || !mapInstance) return;
    const sessionId = ++gameSessionIdRef.current;
    setGameHints(prev => ({ ...prev, usedOnQuestion: 0 }));
    setConfirmQuitGame(false);setGameLoading(true);setGameLoadingText('正在读取网站已有线路数据…');
    setActiveBusLine(null);setSelectedStop(null);setSelectedSegmentLines(null);setStationConnectivityCard(null);setSelectionPos(null);
    roadViewportCleanupRef.current?.();roadViewportCleanupRef.current=null;
    activeRawMarkersRef.current=[];roadStopMarkersRef.current=[];allMapStopsRef.current.clear();roadStopsDataRef.current.clear();
    lineGroupRef.current?.clearOverlays();if(markerGroupRef.current)clearStopMarkerGroup(markerGroupRef.current);
    setCountyGameMask();
    try {
      const catalog = await loadPublishedCities();
      if (gameSessionIdRef.current !== sessionId) return;
      if (!catalog.length) throw Error('网站暂时没有可供出题的城市线路数据。');
      const province = provinceOverride ?? (mode === 'county' ? gameCountyProvince : gameProvince);
      let question: ReturnType<typeof createOfflineQuestion>;
      if (mode === 'county') {
        const seats = catalog.filter(item=>item.province===province).flatMap(item=>item.countySeats);
        const pool=shuffle(seats.filter(item=>seats.length===1||item.name!==prevAnswer));
        let selected: ReturnType<typeof createOfflineQuestion> | undefined;
        for (const seat of pool) {
          const data=await loadGameCity(seat.city,(completed,total)=>{if(gameSessionIdRef.current===sessionId)setGameLoadingText(`正在读取线路数据（${completed}/${total}）…`);});
          if (gameSessionIdRef.current !== sessionId) return;
          try { selected=createOfflineQuestion(mode,diff,data,seats.map(item=>item.name),qNum,prevAnswer,seat);break; } catch { /* Try only other saved county anchors; never query a provider. */ }
        }
        if (!selected) throw Error('该省份暂无可出题的县政府站点周边线网，请选择其他省份。');
        question=selected;
      } else {
        const pool=mode==='city'?catalog.filter(item=>catalog.length===1||item.city!==prevAnswer):catalog.filter(item=>item.city===city);
        const chosen=shuffle(pool)[0];if(!chosen)throw Error('请选择网站已有线路图的城市。');
        const data=await loadGameCity(chosen.city,(completed,total)=>{if(gameSessionIdRef.current===sessionId)setGameLoadingText(`正在读取线路数据（${completed}/${total}）…`);});
        if (gameSessionIdRef.current !== sessionId) return;
        question=createOfflineQuestion(mode,diff,data,catalog.map(item=>item.city),qNum,prevAnswer);
      }
      if (gameSessionIdRef.current !== sessionId) return;
      setMapMode(question.showBasemap === false ? 'blank' : 'normal');
      const paths=question.networkPaths||question.lineInfos?.map(line=>line.path)||[];
      if (paths.length) {
        const network = new AMap.Polyline({path:paths,strokeColor:'#52796F',strokeWeight:lineThickness==='thin'?2:3.2,strokeOpacity:.85,lineJoin:'round',lineCap:'round',zIndex:45});
        lineGroupRef.current?.addOverlay(network);
        if (question.countyWindow) {
          const {center,radius}=question.countyWindow,ring=radiusRing(center,radius);
          mapInstance.setBounds(new AMap.Bounds([Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1]))],[Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]));
          setCountyGameMask(center,radius);
        } else if(mode==='station'&&question.targetPoint)mapInstance.setZoomAndCenter(14,question.targetPoint.lngLat);
        else mapInstance.setFitView([network],false,[48,150,36,36]);
      }
      if (question.showStops && (mode==='line'||mode==='station')) {
        const markers=(question.networkStops||[]).map(stop=>new AMap.CircleMarker({center:stop.lngLat,radius:3.5,fillColor:'#52796F',strokeColor:'#fff',strokeWeight:1,zIndex:60,bubble:true}));
        markerGroupRef.current?.addOverlays(markers);
      }
      if ((mode==='line'||mode==='station') && paths.length) {
        const terminalMarkers=paths.filter(path=>path.length).flatMap(path=>{
          const first=path[0],last=path[path.length-1];
          return [new AMap.CircleMarker({center:first,radius:7,fillColor:'#16a34a',strokeColor:'#fff',strokeWeight:2,zIndex:90}),new AMap.CircleMarker({center:last,radius:5,fillColor:'#ef4444',strokeColor:'#fff',strokeWeight:2,zIndex:92})];
        });
        markerGroupRef.current?.addOverlays(terminalMarkers);
      }
      if(question.targetPoint)markerGroupRef.current?.addOverlay(new AMap.CircleMarker({center:question.targetPoint.lngLat,radius:9,fillColor:'#ef4444',strokeColor:'#fff',strokeWeight:2,zIndex:95}));
      currentGameQuestionRef.current={...question,questionNum:qNum,mode,difficulty:diff,province};
      if (mode === 'line' || mode === 'station') {
        const timeLimit = getGameTimeLimit(mode, diff)!;
        gameTimeRemainingMsRef.current = timeLimit * 1000;
        gameDeadlineRef.current = null;
        setGameTimeLeft(timeLimit);
      }
      setGameQuestionData({correctAnswer:question.correctAnswer,options:question.options,isFillIn:question.isFillIn,promptText:question.promptText});
    } catch(error:any) {
      if(gameSessionIdRef.current===sessionId){setGameState('menu');isMinigameActiveRef.current=false;restoreMapAfterMinigame();setGameDataError(error.message||'读取题目失败，请稍后重试。');}
    } finally {if(gameSessionIdRef.current===sessionId)setGameLoading(false);}
  };

  const handleMinigameSubmit = (answer: string) => {
    if (!gameQuestionData || gameState !== 'playing' || gameLoading || gameFeedback !== null || gameTimedOutRef.current) return;
    if (gameDeadlineRef.current !== null && Date.now() >= gameDeadlineRef.current) {
      finishGameOnTimeout();
      return;
    }
    const submittedSessionId = gameSessionIdRef.current;

    const rawUser = answer.trim();
    const rawCorrect = gameQuestionData.correctAnswer.trim();
    let isCorrect = rawUser === rawCorrect;

    if (!isCorrect && gameQuestionData.isFillIn) {
      const toHalfWidth = (s: string) =>
        s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
      const norm = (s: string) =>
        toHalfWidth(s)
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/\(.*?\)|（.*?）/g, '')
          .replace(/[·\-—_.,，。、'"“”‘’]/g, '');

      const u = norm(rawUser);
      const c = norm(rawCorrect);

      if (!u) {
        isCorrect = false;
      } else if (gameMode === 'line') {
        const normLineName = (s: string) =>
          s
            .replace(/快速直达专线/g, '快直')
            .replace(/快速直达/g, '快直')
            .replace(/快速公交/g, '快')
            .replace(/([内外])环/g, '$1')
            .replace(/(?:公交|巴士|专线|路线|快车|班车|区间车|车|路|线)/g, (m) => {
              if (m === '快车') return '快';
              if (m === '专线') return '专';
              if (m === '区间车') return '区间';
              return '';
            });
        const nu = normLineName(u);
        const nc = normLineName(c);
        isCorrect = u === c || (nu.length > 0 && nu === nc);
      } else if (gameMode === 'station') {
        const stripStationEnd = (s: string) => {
          const stripped = s.replace(
            /(?:公交枢纽站|公交场站|公交总站|公交车站|公交站|枢纽站|首末站|总站|车站|站)$/,
            ''
          );
          return stripped || s;
        };
        const stripStationAll = (s: string) => {
          let res = stripStationEnd(s).replace(/^(?:地铁|公交)/, '');
          res = res.replace(/(?:火车站|高铁站|汽车站|地铁站)$/, '') || res;
          return res || s;
        };
        const u1 = stripStationEnd(u);
        const c1 = stripStationEnd(c);
        const u2 = stripStationAll(u);
        const c2 = stripStationAll(c);
        isCorrect = u === c || u1 === c1 || (u2.length >= 2 && u2 === c2);
      } else if (gameMode === 'county') {
        const stripCountySuffix = (s: string) => {
          const stripped = s
            .replace(/(?:[一-龥]{1,8}?(?:族|各族))*自治(?:县|州|旗)$/, '')
            .replace(/(?:特别行政区|行政委员会|林区|矿区|新区|特区|[县市区旗盟])$/, '');
          return stripped || s;
        };
        isCorrect = u === c || stripCountySuffix(u) === stripCountySuffix(c);
      } else if (gameMode === 'city') {
        const stripCitySuffix = (s: string) => {
          const stripped = s
            .replace(/(?:[一-龥]{1,8}?(?:族|各族))*自治州$/, '')
            .replace(/(?:特别行政区|地区|[市盟])$/, '');
          return stripped || s;
        };
        isCorrect = u === c || stripCitySuffix(u) === stripCitySuffix(c);
      }
    }

    const snapshot = currentGameQuestionRef.current;
    if (snapshot) {
      setGameHistory(prev => [
        ...prev,
        {
          ...snapshot,
          userAnswer: rawUser,
          isCorrect
        }
      ]);
    }

    if (isCorrect) {
      const newScore = gameScore + 1;
      setGameScore(newScore);

      if (gameMode) {
        const modeKey = gameMode;
        const diffKey = gameDifficulty;
        setBestRecords((prev: any) => {
          const currentBest = (modeKey === 'city' || modeKey === 'county')
            ? (prev[modeKey]?.hard || 0)
            : (prev[modeKey]?.[diffKey] || 0);
          if (newScore > currentBest) {
            const updated = {
              ...prev,
              [modeKey]: { ...(prev[modeKey] || {}) }
            };
            if (modeKey === 'city' || modeKey === 'county') {
              updated[modeKey].hard = newScore;
            } else {
              updated[modeKey][diffKey] = newScore;
            }
            localStorage.setItem('busline_minigame_records', JSON.stringify(updated));
            return updated;
          }
          return prev;
        });
      }

      setGameFeedback({ correct: true, msg: '回答正确！即将进入下一题...' });
      setTimeout(() => {
        if (gameSessionIdRef.current !== submittedSessionId || gameTimedOutRef.current) return;
        setGameFeedback(null);
        setGameUserInput('');
        const nextNum = gameQuestionNum + 1;
        if (gameMode === 'city' && nextNum > 10) {
          settleGameLeaderboard(newScore);
          setGameState('gameover');
          return;
        }
        setGameQuestionNum(nextNum);
        generateQuestion(gameMode!, gameDifficulty, gameCity, nextNum, rawCorrect);
      }, 900);
    } else {
      setGameFeedback({ correct: false, msg: `回答错误！正确答案是：${gameQuestionData.correctAnswer}` });
      setTimeout(() => {
        if (gameSessionIdRef.current !== submittedSessionId || gameTimedOutRef.current) return;
        settleGameLeaderboard(gameScore);
        setGameState('gameover');
      }, 1500);
    }
  };

  const [isSearching, setIsSearching] = useState(false);
  const [searchActivity,setSearchActivity]=useState<'auto'|'manual'|null>(null);
  const [searchProgress,setSearchProgress]=useState<{value:number;label:string}|null>(null);
  const [showEmptySearchNotice, setShowEmptySearchNotice] = useState(false);
  const customApiSectionRef = useRef<HTMLDivElement>(null);
  const focusCustomApiRef = useRef(false);
  const [pendingCityUpload, setPendingCityUploadState] = useState<CityDataset | null>(null);
  const pendingCityUploadRef = useRef<CityDataset | null>(null);
  const setPendingCityUpload = (data: CityDataset | null) => {
    pendingCityUploadRef.current = data;
    setPendingCityUploadState(data);
  };
  const [cityUploadBusy, setCityUploadBusy] = useState(false);
  const [cityUploadProgress, setCityUploadProgress] = useState(0);
  const [cityUploadError, setCityUploadError] = useState('');
  const [lastCityDataset, setLastCityDataset] = useState<CityDataset | null>(null);
  const [sharedCityStatus, setSharedCityStatus] = useState('');
  const [cityUpdateJob, setCityUpdateJob] = useState<CityUpdateJob | null>(null);
  const cityJobWatchRef = useRef<AbortController | null>(null);
  useEffect(() => () => cityJobWatchRef.current?.abort(), []);
  const [publishedCitySummary, setPublishedCitySummary] = useState<PublishedCity | null>(null);
  const [cityDataNotice, setCityDataNotice] = useState<{city: string; kind: 'missing' | 'expired' | 'busy' | 'unavailable'} | null>(null);
  const pickViewportRef = useRef<(point: [number, number]) => boolean>(() => false);
  const selectedViewportRoutesRef = useRef<ViewportRoute[]>([]);
  const viewportSelectionRef = useRef<ViewportTransitSelection | null>(null);
  const [viewportDetailReady, setViewportDetailReady] = useState(false);
  const [viewportStats, setViewportStats] = useState({ lines: 0, stops: 0 });
  const priorityCoverageRef = useRef<any>(null);
  const coverageVersionRef = useRef(0);
  const [coverageActive, setCoverageActive] = useState(false);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const clearPriorityCoverage = () => {
    coverageVersionRef.current++;
    priorityCoverageRef.current?.clearOverlays();
    setCoverageActive(false);
    setCoverageBusy(false);
  };
  const manualResultCityRef = useRef('');
  const sharedMapDataRef = useRef(false);
  const [stats, setStats] = useState({ stops: 0, lines: 0 });
  const [cacheUpdateTick, setCacheUpdateTick] = useState(0);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  type MapMode = 'normal' | 'satellite' | 'blank';
  type StationDisplayMode = 'all' | 'terminal' | 'none';

  const [mapMode, setMapMode] = useState<MapMode>(() => {
    const saved = localStorage.getItem('app_map_mode');
    if (saved === 'normal' || saved === 'satellite' || saved === 'blank') return saved;
    if (localStorage.getItem('app_use_satellite_map') === 'true') return 'satellite';
    if (localStorage.getItem('app_show_basemap') === 'false') return 'blank';
    return 'normal';
  });

  const [stationMode, setStationMode] = useState<StationDisplayMode>(() => {
    const saved = localStorage.getItem('app_station_mode');
    if (saved === 'all' || saved === 'terminal' || saved === 'none') return saved;
    if (localStorage.getItem('app_show_stations') === 'false') return 'none';
    return 'all';
  });

  const showBaseMap = mapMode !== 'blank';
  const setShowBaseMap = (val: boolean | ((p: boolean) => boolean)) => {
    setMapMode(prev => {
      const nextBool = typeof val === 'function' ? val(prev !== 'blank') : val;
      return nextBool ? (prev === 'satellite' ? 'satellite' : 'normal') : 'blank';
    });
  };

  const useSatelliteMap = mapMode === 'satellite';
  const setUseSatelliteMap = (val: boolean | ((p: boolean) => boolean)) => {
    setMapMode(prev => {
      const nextBool = typeof val === 'function' ? val(prev === 'satellite') : val;
      return nextBool ? 'satellite' : 'normal';
    });
  };

  const showStations = stationMode !== 'none';
  const setShowStations = (val: boolean | ((p: boolean) => boolean)) => {
    setStationMode(prev => {
      const nextBool = typeof val === 'function' ? val(prev !== 'none') : val;
      return nextBool ? 'all' : 'none';
    });
  };

  const satelliteLayerRef = useRef<any>(null);
  const roadNetLayerRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem('app_map_mode', mapMode);
    localStorage.setItem('app_show_basemap', String(mapMode !== 'blank'));
    localStorage.setItem('app_use_satellite_map', String(mapMode === 'satellite'));
  }, [mapMode]);

  useEffect(() => {
    localStorage.setItem('app_station_mode', stationMode);
    localStorage.setItem('app_show_stations', String(stationMode !== 'none'));
    const isTerm = stationMode === 'terminal';
    setFilterTerminalOnly(isTerm);
    filterTerminalOnlyRef.current = isTerm;
    if (!isMinigameActiveRef.current && mapRef.current && (window as any).AMap) {
      syncStopMarkersToMap(mapRef.current, (window as any).AMap);
    }
  }, [stationMode]);
  const showMoreInfo = false;
  const [stationLineStats, setStationLineStats] = useState(() => {
    const saved = localStorage.getItem('app_station_line_stats');
    return saved === null ? true : saved === 'true';
  });
  const stationLineStatsRef = useRef(stationLineStats);
  useEffect(() => { stationLineStatsRef.current = stationLineStats; }, [stationLineStats]);

  const stopCountCacheRef = useRef<Map<string, number>>(new Map());

  const [showSettings, setShowSettings] = useState(() => Boolean(getWechatRegistrationToken()));
  const [showBuslineAI, setShowBuslineAI] = useState(false);
  const [showBusPlanner, setShowBusPlanner] = useState(false);
  const plannerOverlaysRef = useRef<any[]>([]);
  const plannerSearchVersionRef = useRef(0);
  const plannerStopPickerRef = useRef<((station: PlannerPoint) => void) | null>(null);
  const setPlannerStopPicker = useCallback((handler: ((station: PlannerPoint) => void) | null) => {
    plannerStopPickerRef.current = handler;
    if (handler) mapPointVersionRef.current++;
  }, []);
  const selectPlannerStop = (station: PlannerPoint, lines: readonly string[]): boolean => {
    const pick = plannerStopPickerRef.current;
    if (!pick) return false;
    if (station.city && station.name && lines.some(isLocalBusLine)) pick(station);
    return true;
  };
  const pickPlannerMapStop = (point: Point, map: any): boolean => {
    if (!plannerStopPickerRef.current) return false;
    const pixel = map.lngLatToContainer(point);
    let nearest = 11;
    let selected: ViewportStop | undefined;
    for (const stop of viewportSelectionRef.current?.stops() ?? []) {
      if (!stop.city || !stop.lines.some(isLocalBusLine)) continue;
      const target = map.lngLatToContainer(getLatLng(stop.location));
      const distance = Math.hypot(pixel.x - target.x, pixel.y - target.y);
      if (distance < nearest) { nearest = distance; selected = stop; }
    }
    if (selected) selectPlannerStop({ city: selected.city, name: selected.name, location: getLatLng(selected.location) }, selected.lines);
    return true;
  };
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineAvailable, setTimelineAvailable] = useState(false);
  const [timelineMinute, setTimelineMinute] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineLines, setTimelineLines] = useState<BusLine[]>([]);
  const timelineOverlaysRef = useRef<TimelineOverlayEntry[]>([]);
  const timelineMinuteRef = useRef(timelineMinute);
  timelineMinuteRef.current = timelineMinute;
  const displayedLineNamesRef = useRef<string[]>([]);
  const timelineActiveCount = useMemo(() => timelineLines.filter(line => isLineOperating(line, timelineMinute) === true).length, [timelineLines, timelineMinute]);

  const [aiSearchProgress, setAISearchProgress] = useState('');
  const [aiRegionContext, setAIRegionContext] = useState<AIRegionContext | null>(null);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'general' | 'about'>('profile');
  const appSettingsVisible = showSettings && settingsTab === 'general';

  // WeChat Group QR Code management
  const [showWeChatQR, setShowWeChatQR] = useState(false);
  const [adminSessionToken, setAdminSessionToken] = useState('');
  const [wechatQRImg, setWechatQRImg] = useState(() => {
    return localStorage.getItem('app_wechat_qr_img') || '';
  });
  const [wechatUploadTime, setWechatUploadTime] = useState(() => {
    const saved = localStorage.getItem('app_wechat_qr_upload_time');
    return saved ? parseInt(saved, 10) : Date.now();
  });
  const wechatFileInputRef = useRef<HTMLInputElement>(null);

  // Load WeChat QR from server database on component mount
  useEffect(() => {
    // The legacy group-QR admin endpoint is not part of the static site.
    // Avoid a noisy same-origin 404 when no separate API server is configured.
    if (!API_BASE_URL) return;
    const loadWeChatQR = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/settings/wechat_qr`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.value) {
            if (data.value === 'DEFAULT_PLACEHOLDER') {
              setWechatQRImg('');
            } else {
              setWechatQRImg(data.value);
              if (data.updatedAt) {
                setWechatUploadTime(data.updatedAt);
                localStorage.setItem('app_wechat_qr_upload_time', data.updatedAt.toString());
                localStorage.setItem('app_wechat_qr_img', data.value);
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to load WeChat QR from database:', err);
      }
    };
    loadWeChatQR();
  }, []);

  const handleWeChatQRUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/settings/wechat_qr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-session': adminSessionToken },
            body: JSON.stringify({
              value: base64,
            }),
          });

          if (response.ok) {
            localStorage.setItem('app_wechat_qr_img', base64);
            const now = Date.now();
            localStorage.setItem('app_wechat_qr_upload_time', now.toString());
            setWechatQRImg(base64);
            setWechatUploadTime(now);
            alert('微信群二维码图已成功保存至服务器云端数据库！');
          } else {
            const errData = await response.json();
            alert(`上传失败：${errData.error || '服务器拒绝请求'}`);
          }
        } catch (err) {
          console.error('Upload wechat QR error:', err);
          alert('上传失败，无法连接到服务器数据库。');
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const getWeChatExpiryDate = () => {
    let baseTime = wechatUploadTime;
    if (!localStorage.getItem('app_wechat_qr_upload_time')) {
      baseTime = Date.now();
    }
    const expiry = new Date(baseTime + 7 * 24 * 60 * 60 * 1000);
    const m = expiry.getMonth() + 1;
    const d = expiry.getDate();
    return `${m}月${d}日`;
  };

  const [filterAirportBus, setFilterAirportBus] = useState(() => {
    const saved = localStorage.getItem('app_filter_airport_bus');
    return saved === null ? false : saved === 'true';
  });
  const filterAirportBusRef = useRef(filterAirportBus);
  useEffect(() => {
    filterAirportBusRef.current = filterAirportBus;
  }, [filterAirportBus]);

  const [filterIntervalBus, setFilterIntervalBus] = useState(() => {
    const saved = localStorage.getItem('app_filter_interval_bus');
    return saved === 'true';
  });
  const filterIntervalBusRef = useRef(filterIntervalBus);
  useEffect(() => {
    filterIntervalBusRef.current = filterIntervalBus;
  }, [filterIntervalBus]);

  // Terminal station only filter
  const [filterTerminalOnly, setFilterTerminalOnly] = useState(false);
  const filterTerminalOnlyRef = useRef(filterTerminalOnly);
  useEffect(() => {
    filterTerminalOnlyRef.current = filterTerminalOnly;
  }, [filterTerminalOnly]);

  const enableCityWideSearch = true;
  const [enableLineCache, setEnableLineCache] = useState(() => {
    return localStorage.getItem(APP_LINE_CACHE_ENABLED_KEY) === 'true';
  });
  const enableLineCacheRef = useRef(enableLineCache);
  useEffect(() => {
    enableLineCacheRef.current = enableLineCache;
  }, [enableLineCache]);
  const [lineCacheStats, setLineCacheStats] = useState<LineCacheStats>({ linesCount: 0, stopsCount: 0, regionsCount: 0 });
  const [cacheClearedFeedback, setCacheClearedFeedback] = useState(false);
  const queriedLineNamesRef = useRef<Set<string>>(new Set());
  const lastSearchCityRef = useRef<string>('');

  const refreshLineCacheStats = useCallback(async () => {
    const statsData = await getLineCacheStats();
    setLineCacheStats(statsData);
  }, []);

  useEffect(() => {
    const initLineCache = async () => {
      await checkAndPurgeIfMonthChanged();
      await refreshLineCacheStats();
    };
    initLineCache();
  }, [refreshLineCacheStats]);

  useEffect(() => {
    if (appSettingsVisible) {
      checkAndPurgeIfMonthChanged().then(() => refreshLineCacheStats());
    }
  }, [appSettingsVisible, refreshLineCacheStats]);
  const [lineThickness] = useState<'thick' | 'thin'>('thick');








  const [showToolbox, setShowToolbox] = useState(false);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [activeBusLine, setActiveBusLine] = useState<any | null>(null);
  const [topCard, setTopCard] = useState<'stop' | 'line'>('stop');

  useEffect(() => {
    if (!showMinigameModal || gameState !== 'review') return;
    const item = gameHistory[reviewIndex];
    const AMap = (window as any).AMap;
    if (!item || !AMap || !mapInstance) return;

    setCountyGameMask(item.countyWindow?.center,item.countyWindow?.radius);
    setMapMode(reviewShowBasemap ? 'normal' : 'blank');
    setActiveBusLine(null);
    setSelectedStop(null);
    setSelectedSegmentLines(null);
    setStationConnectivityCard(null);
    setReviewHoveredStop(null);
    activeBusLinePolylineRef.current = null;
    roadViewportCleanupRef.current?.();
    roadViewportCleanupRef.current = null;
    roadOverlaysRef.current = [];
    if (lineGroupRef.current) lineGroupRef.current.clearOverlays();
    if (markerGroupRef.current) clearStopMarkerGroup(markerGroupRef.current);

    if (item.mode === 'line' && item.lineInfos && item.lineInfos.length > 0) {
      const chosenLine = item.lineInfos[0];
      renderBusLine(chosenLine, AMap, mapInstance, false, false, false);
      const validStops = (chosenLine.via_stops || []).filter((st: any) => st?.location);
      if (reviewShowStops && validStops.length > 2 && markerGroupRef.current) {
        const midStops = validStops.slice(1, validStops.length - 1);
        const stopMarkers = midStops.map((st: any) => {
          const m = new AMap.CircleMarker({
            center: [st.location.lng, st.location.lat],
            radius: 5,
            fillColor: '#3b82f6',
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
            bubble: true,
            zIndex: 65
          });
          if (st.name) {
            m.on('mouseover', () => setReviewHoveredStop(st.name));
            m.on('click', () => setReviewHoveredStop(st.name));
          }
          return m;
        });
        if (stopMarkers.length > 0) {
          markerGroupRef.current.addOverlays(stopMarkers);
        }
      }

      if (markerGroupRef.current) {
        const linePath = (chosenLine.path || []).map((p: any) => Array.isArray(p) ? p : [p.lng, p.lat] as [number, number]);
        const startPos: [number, number] | null = validStops.length > 0
          ? [validStops[0].location.lng, validStops[0].location.lat]
          : (linePath.length > 0 ? linePath[0] : null);
        const endPos: [number, number] | null = validStops.length > 1
          ? [validStops[validStops.length - 1].location.lng, validStops[validStops.length - 1].location.lat]
          : (linePath.length > 1 ? linePath[linePath.length - 1] : null);
        const isLoopOverlap = !!(
          startPos &&
          endPos &&
          Math.abs(startPos[0] - endPos[0]) < 1e-4 &&
          Math.abs(startPos[1] - endPos[1]) < 1e-4
        );
        const terminalMarkers: any[] = [];
        if (startPos) {
          const sm = new AMap.CircleMarker({
            center: startPos,
            radius: isLoopOverlap ? 9.5 : 7.5,
            fillColor: '#16a34a',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2.2,
            bubble: true,
            zIndex: 90
          });
          if (validStops[0]?.name) {
            sm.on('mouseover', () => setReviewHoveredStop(`始发站：${validStops[0].name}`));
            sm.on('click', () => setReviewHoveredStop(`始发站：${validStops[0].name}`));
          }
          terminalMarkers.push(sm);
        }
        if (endPos) {
          const em = new AMap.CircleMarker({
            center: endPos,
            radius: isLoopOverlap ? 5.5 : 7.5,
            fillColor: '#ef4444',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            bubble: true,
            zIndex: 92
          });
          const lastName = validStops[validStops.length - 1]?.name;
          if (lastName) {
            em.on('mouseover', () => setReviewHoveredStop(`终点站：${lastName}`));
            em.on('click', () => setReviewHoveredStop(`终点站：${lastName}`));
          }
          terminalMarkers.push(em);
        }
        if (terminalMarkers.length > 0) {
          markerGroupRef.current.addOverlays(terminalMarkers);
        }
      }
      const overlays = lineGroupRef.current?.getOverlays?.() || [];
      if (overlays.length > 0) {
        mapInstance.setFitView(overlays, false, [48, 170, 36, 36]);
      }
    } else if (item.mode === 'station') {
      (item.lineInfos || []).forEach((info: any) => {
        renderBusLine(info, AMap, mapInstance, false, false, false);
      });
      if (reviewShowStops && item.networkStops && item.networkStops.length > 0 && markerGroupRef.current) {
        const otherMarkers = item.networkStops.map((st) => {
          const m = new AMap.CircleMarker({
            center: st.lngLat,
            radius: 4.5,
            fillColor: '#52796F',
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
            bubble: true,
            zIndex: 60
          });
          if (st.name) {
            m.on('mouseover', () => setReviewHoveredStop(st.name!));
            m.on('click', () => setReviewHoveredStop(st.name!));
          }
          return m;
        });
        markerGroupRef.current.addOverlays(otherMarkers);
      }
      if (item.targetPoint && markerGroupRef.current) {
        const tm = new AMap.CircleMarker({
          center: item.targetPoint.lngLat,
          radius: 10,
          fillColor: '#ef4444',
          strokeColor: '#ffffff',
          strokeWeight: 3,
          zIndex: 95
        });
        tm.on('mouseover', () => setReviewHoveredStop(`目标站：${item.targetPoint!.name}`));
        tm.on('click', () => setReviewHoveredStop(`目标站：${item.targetPoint!.name}`));
        markerGroupRef.current.addOverlay(tm);
      }
      const overlays = lineGroupRef.current?.getOverlays?.() || [];
      if (overlays.length > 0) {
        mapInstance.setFitView(overlays, false, [48, 170, 36, 36]);
      } else if (item.fallbackCenter) {
        mapInstance.setCenter(item.fallbackCenter);
        mapInstance.setZoom(14);
      }
    } else {
      if (item.networkPaths && item.networkPaths.length > 0 && lineGroupRef.current) {
        const netOverlay = new AMap.Polyline({
          path: item.networkPaths,
          strokeColor: '#52796F',
          strokeWeight: lineThickness === 'thin' ? (item.mode === 'city' ? 2 : 2.5) : (item.mode === 'city' ? 3.2 : 3.8),
          strokeOpacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round',
          isOutline: true,
          outlineColor: '#ffffff',
          borderWeight: 0.5,
          zIndex: 45
        });
        lineGroupRef.current.addOverlay(netOverlay);
        if (reviewShowStops && item.networkStops && item.networkStops.length > 0 && markerGroupRef.current) {
          const netStopMarkers = item.networkStops.map((st) => {
            const m = new AMap.CircleMarker({
              center: st.lngLat,
              radius: 3.5,
              fillColor: '#3b82f6',
              fillOpacity: 0.85,
              strokeColor: '#ffffff',
              strokeWeight: 1,
              bubble: true,
              zIndex: 60
            });
            if (st.name) {
              m.on('mouseover', () => setReviewHoveredStop(st.name!));
              m.on('click', () => setReviewHoveredStop(st.name!));
            }
            return m;
          });
          markerGroupRef.current.addOverlays(netStopMarkers);
        }
        mapInstance.setFitView([netOverlay], false, [48, 170, 36, 36]);
      } else if (item.fallbackCenter) {
        mapInstance.setZoomAndCenter(13, item.fallbackCenter);
      } else if (item.targetCity) {
        try {
          const city=gameCatalog.find(city=>city.city===item.targetCity);if(city)mapInstance.setZoomAndCenter(11,city.center);
        } catch (e) {}
      }
    }
  }, [showMinigameModal, gameState, reviewIndex, reviewShowBasemap, reviewShowStops, gameHistory, mapInstance, lineThickness]);

  // --- USER DEFINED DRAWING AND ADMIN STATES ---
  // Switch to show user submitted data (defaults to false / disabled)
  const [showUserSubmittedData, setShowUserSubmittedData] = useState<boolean>(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const isDrawingModeRef = useRef(isDrawingMode);
  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode;
  }, [isDrawingMode]);

  const [drawnPoints, setDrawnPoints] = useState<any[]>([]);
  const drawnPointsRef = useRef(drawnPoints);
  useEffect(() => {
    drawnPointsRef.current = drawnPoints;
  }, [drawnPoints]);

  const [undoStack, setUndoStack] = useState<any[][]>([]);
  const [redoStack, setRedoStack] = useState<any[][]>([]);
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null);

  const [namingStopIdx, setNamingStopIdx] = useState<number | null>(null);
  const [namingValue, setNamingValue] = useState('');

  const [drawingSubMode, setDrawingSubMode] = useState<'snap' | 'straight'>('snap');
  const drawingSubModeRef = useRef(drawingSubMode);
  useEffect(() => {
    drawingSubModeRef.current = drawingSubMode;
  }, [drawingSubMode]);

  const [showDrawNotice, setShowDrawNotice] = useState(false);
  const [noticeCountdown, setNoticeCountdown] = useState(0);

  useEffect(() => {
    if (isDrawingMode) {
      const hasSeen = localStorage.getItem('has_seen_draw_notice');
      if (!hasSeen) {
        setShowDrawNotice(true);
        setNoticeCountdown(5);
      }
    }
  }, [isDrawingMode]);

  useEffect(() => {
    let timer: any;
    if (showDrawNotice && noticeCountdown > 0) {
      timer = setInterval(() => {
        setNoticeCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [showDrawNotice, noticeCountdown]);

  const openNoticeManually = () => {
    setShowDrawNotice(true);
    setNoticeCountdown(0);
  };

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitCity, setSubmitCity] = useState('');
  const [submitDistrict, setSubmitDistrict] = useState('');
  const [submitLineName, setSubmitLineName] = useState('');
  const [submitUserNickname, setSubmitUserNickname] = useState('');
  const [submitDataSourceText, setSubmitDataSourceText] = useState('');
  const [submitDataSourceImages, setSubmitDataSourceImages] = useState<string[]>([]);
  const [rejectingSubId, setRejectingSubId] = useState<string | null>(null);
  const [rejectReasonValue, setRejectReasonValue] = useState('');
  const [notification, setNotification] = useState<{ show: boolean, approved: number, rejected: number, timeStr: string } | null>(null);
  const [collapsedCities, setCollapsedCities] = useState<Record<string, boolean>>({});

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historicalSubmissions, setHistoricalSubmissions] = useState<any[]>(() => {
    const saved = localStorage.getItem('user_drawn_lines_history');
    return saved ? JSON.parse(saved) : [];
  });

  const [approvedUserLines, setApprovedUserLines] = useState<any[]>([]);
  const [submissionStatuses, setSubmissionStatuses] = useState<Record<string, string>>({});

  const [filterUserSubmissions, setFilterUserSubmissions] = useState(() => {
    const saved = localStorage.getItem('app_filter_user_submissions');
    return saved === 'true';
  });

  const filterUserSubmissionsRef = useRef(filterUserSubmissions);
  useEffect(() => {
    filterUserSubmissionsRef.current = filterUserSubmissions;
  }, [filterUserSubmissions]);

  // Blocked keywords/routes custom tags state
  const [blockedKeywords, setBlockedKeywords] = useState<string[]>(() => {
    const saved = localStorage.getItem('app_blocked_keywords');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing blocked keywords:', e);
      }
    }
    // Auto migrate from previous settings
    const list: string[] = [];
    if (localStorage.getItem('app_filter_airport_bus') === 'true') {
      list.push('机场');
    }
    if (localStorage.getItem('app_filter_interval_bus') === 'true') {
      list.push('区间');
    }
    return list;
  });

  const blockedKeywordsRef = useRef<string[]>(blockedKeywords);
  const searchFilterVersionRef = useRef(0);
  useEffect(() => { searchFilterVersionRef.current++; }, [filterIntervalBus, filterAirportBus, blockedKeywords]);
  useEffect(() => {
    blockedKeywordsRef.current = blockedKeywords;
    localStorage.setItem('app_blocked_keywords', JSON.stringify(blockedKeywords));
  }, [blockedKeywords]);

  const [newKeyword, setNewKeyword] = useState('');

  const isLineNameBlockedRef = useCallback((name: string) => {
    if (!name) return false;
    return blockedKeywordsRef.current.some(keyword => keyword && name.includes(keyword));
  }, []);

  const viewportLineBlocked = useCallback((name: string) => blockedKeywords.some(keyword => keyword && name.includes(keyword))
    || (filterIntervalBus && name.includes('区间')) || (filterAirportBus && /机场(巴士|大巴)|空港/.test(name)),
  [blockedKeywords, filterIntervalBus, filterAirportBus]);

  const addBlockedKeyword = (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    if (blockedKeywords.includes(trimmed)) return;
    const next = [...blockedKeywords, trimmed];
    setBlockedKeywords(next);
    setCacheUpdateTick(v => v + 1);

    // Auto-refresh lines on map
    if (mapInstance) {
      if (activeBusLine) {
        renderBusLine(activeBusLine, (window as any).AMap, mapInstance, true, true, false);
      } else if (selectedSegmentLines?.length && roadOverlaysRef.current.length) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      } else if (roadOverlaysRef.current.length) {
        handleSearch();
      }
    }
  };

  const removeBlockedKeyword = (keyword: string) => {
    const next = blockedKeywords.filter(k => k !== keyword);
    setBlockedKeywords(next);
    setCacheUpdateTick(v => v + 1);

    // Auto-refresh lines on map
    if (mapInstance) {
      if (activeBusLine) {
        renderBusLine(activeBusLine, (window as any).AMap, mapInstance, true, true, false);
      } else if (selectedSegmentLines?.length && roadOverlaysRef.current.length) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      } else if (roadOverlaysRef.current.length) {
        handleSearch();
      }
    }
  };

  // Custom AMap API configuration state
  const [useCustomApiKey, setUseCustomApiKey] = useState(() => {
    return localStorage.getItem('app_use_custom_api_key') === 'true';
  });
  useEffect(() => {
    if (!showSettings || settingsTab !== 'general' || !focusCustomApiRef.current) return;
    const frame = requestAnimationFrame(() => {
      customApiSectionRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      customApiSectionRef.current?.querySelector('input')?.focus({ preventScroll: true });
      focusCustomApiRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [showSettings, settingsTab, useCustomApiKey]);

  const [customApiKey, setCustomApiKey] = useState(() => {
    return localStorage.getItem('app_custom_api_key') || '';
  });
  const [customApiSecurityCode, setCustomApiSecurityCode] = useState(() => {
    return localStorage.getItem('app_custom_api_security_code') || '';
  });
  useEffect(() => {
    localStorage.setItem('app_use_custom_api_key', String(useCustomApiKey));
  }, [useCustomApiKey]);
  useEffect(() => {
    localStorage.setItem('app_custom_api_key', customApiKey);
  }, [customApiKey]);
  useEffect(() => {
    localStorage.setItem('app_custom_api_security_code', customApiSecurityCode);
  }, [customApiSecurityCode, useCustomApiKey]);

  // Onboarding cards are no longer shown; keep this stable flag for the map
  // loading guards that previously waited for the guide to finish.
  const onboardingStep = 0;
  const [showVersionUpdate, setShowVersionUpdate] = useState(() => {
    const savedVersion = localStorage.getItem(APP_LAST_VERSION_KEY);
    return !!savedVersion && compareVersions(APP_VERSION, savedVersion) > 0;
  });

  const handleResetApp = async () => {
    try {
      // Limit reset to this origin's disposable browsing/cache data. In
      // particular, do not clear user-created route records or API settings.
      localStorage.removeItem(APP_LINE_CACHE_ENABLED_KEY);
      localStorage.removeItem('app_line_cache_month');
      localStorage.removeItem(DAILY_LOCATION_KEY);
      sessionStorage.clear();
      await clearAllLineCache();
      if ('caches' in window) {
        const names = await window.caches.keys();
        await Promise.all(names.map(name => window.caches.delete(name)));
      }
    } catch {}
    window.location.reload();
  };

  // Admin and stats
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminMode, setAdminMode] = useState(false); // keep for compatibility or reference if needed
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const [editingLineName, setEditingLineName] = useState('');
  const [pendingSubmissions, setPendingSubmissions] = useState<any[]>([]);
  const [connectivityToast, setConnectivityToast] = useState<string | null>(null);
  const [apiErrorNotification, setApiErrorNotification] = useState<string | null>(null);

  // Check on mount if an API fallback notification was queued
  useEffect(() => {
    const fallbackMsg = localStorage.getItem('app_api_fallback_message');
    if (fallbackMsg) {
      localStorage.removeItem('app_api_fallback_message');
      setApiErrorNotification(fallbackMsg);
    }
  }, []);

  // Automatic recovery handler when custom API is broken or invalid


  const checkAmapQuotaError = useCallback((status: string, result: any) => {
    if (status === 'error' || (result && result.info && result.info !== 'OK' && result.info !== 'NO_DATA')) {
      const info = String(typeof result === 'string' ? result : result?.info || '').toUpperCase();
      const infocode = String(result?.infocode || '');

      if (
        info.includes('INVALID_USER_KEY') ||
        info.includes('PLAT_NOMATCH') ||
        info.includes('INVALID_USER_SCODE') ||
        info.includes('KEY_NOT_EXIST') ||
        infocode === '10001' ||
        infocode === '10002'
      ) {

        setApiErrorNotification(
          '高德 API Key 无效或平台类型不匹配。请确认在设置中配置的是高德「Web端 (JS API)」类型的 Key 与安全密钥。'
        );
        return true;
      }
      if (
        info.includes('OVER_LIMIT') ||
        info.includes('DAILY') ||
        infocode === '10003' ||
        infocode === '10044'
      ) {
        setApiErrorNotification(
          '高德公共查询配额已达上限。可在设置中填写您自己的 Web端 (JS API) Key 与安全密钥，或稍后再试。'
        );
        return true;
      }
      if (info.includes('FREQUENT') || info.includes('QPS') || infocode === '10004') {
        setApiErrorNotification('高德 API 请求过于频繁（并发 QPS 超限），请稍候重试。');
        return true;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    if (apiErrorNotification) {
      const timer = setTimeout(() => setApiErrorNotification(null), 9000);
      return () => clearTimeout(timer);
    }
  }, [apiErrorNotification]);

  useEffect(() => {
    const handleWindowError = (e: ErrorEvent) => {
      const msg = String(e.message || '').toUpperCase();
      if (
        msg.includes('INVALID_USER_KEY') || 
        msg.includes('USERKEY_PLAT_NOMATCH') || 
        msg.includes('INVALID_USER_SCODE') ||
        msg.includes('KEY_NOT_EXIST')
      ) {

        setApiErrorNotification('高德 API Key 无效或平台类型不匹配，请前往设置检查。');
      } else if (msg.includes('DAILY_QUERY_OVER_LIMIT') || msg.includes('OVER_LIMIT')) {
        setApiErrorNotification('公共高德 API 配额不足，请稍后再试；已有共享线路仍可查看。');
      }
    };

    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = String(e.reason?.message || e.reason || '').toUpperCase();
      if (
        reason.includes('INVALID_USER_KEY') || 
        reason.includes('USERKEY_PLAT_NOMATCH') || 
        reason.includes('INVALID_USER_SCODE') ||
        reason.includes('KEY_NOT_EXIST') ||
        (reason.includes('AMAP') && (reason.includes('FAIL') || reason.includes('ERROR')))
      ) {
        setApiErrorNotification('公共高德服务暂时不可用，请稍后重试。');
      }
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const [footerClickCount, setFooterClickCount] = useState(0);
  const [lastFooterClickTime, setLastFooterClickTime] = useState(0);

  const drawingGroupRef = useRef<any>(null);
  const locationMarkerRef = useRef<any>(null);
  const isRoutingRef = useRef(false);


  const boxSelectedLines = useMemo(() => {
    const linesSet = new Set<string>();
    boxSelectedStops.forEach((stop: any) => {
      if (stop.lines) {
        stop.lines.forEach((l: string) => {
          if (isValidBusLineName(l)) {
            if (!showUserSubmittedData) {
              const isUserLine = approvedUserLines.some((ul: any) => ul.name === l) || fetchedLinesCache.current?.get(l)?.isUserSubmitted;
              if (isUserLine) return;
            }
            linesSet.add(l);
          }
        });
      }
    });
    return Array.from(linesSet).sort();
  }, [boxSelectedStops, showUserSubmittedData, approvedUserLines]);

  const mergedSelectedStops = useMemo(() => {
    const mapByName = new Map<string, {
      name: string;
      keys: string[];
      lines: Set<string>;
      locations: any[];
    }>();

    boxSelectedStops.forEach((stop: any) => {
      const name = stop.name;
      let existing = mapByName.get(name);
      if (!existing) {
        existing = {
          name,
          keys: [],
          lines: new Set<string>(),
          locations: []
        };
        mapByName.set(name, existing);
      }
      existing.keys.push(stop.key);
      if (stop.location) {
        existing.locations.push(stop.location);
      }
      if (stop.lines) {
        stop.lines.forEach((l: string) => {
          if (isValidBusLineName(l)) {
            existing!.lines.add(l);
          }
        });
      }
    });

    return Array.from(mapByName.values()).map(g => ({
      name: g.name,
      key: g.keys[0],
      keys: g.keys,
      lines: Array.from(g.lines),
      location: g.locations[0]
    }));
  }, [boxSelectedStops]);

  const removeBoxStops = (keys: string[]) => {
    const removal = new Set(keys);
    setBoxSelectedStops(previous => previous.filter(stop => !removal.has(stop.key)));
  };

  const handleBoxSelectMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setBoxSelectStartPos({ x, y });
    setBoxSelectEndPos({ x, y });
    setIsBoxSelecting(true);
  };

  const handleBoxSelectMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isBoxSelecting || !boxSelectStartPos) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setBoxSelectEndPos({ x, y });
  };

  const handleBoxSelectMouseUp = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isBoxSelecting || !boxSelectStartPos || !boxSelectEndPos) {
      setIsBoxSelecting(false);
      return;
    }

    setIsBoxSelecting(false);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const x1 = boxSelectStartPos.x;
    const y1 = boxSelectStartPos.y;
    const x2 = x;
    const y2 = y;

    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    const map = mapRef.current;
    if (!map) return;

    const isClick = width < 5 && height < 5;
    const extend = e.ctrlKey || e.metaKey;
    const selected: any[] = [];
    let nearest = 25;
    const consider = (stop: any, center: any) => {
      if (!stop || !center) return;
      const { x, y } = map.lngLatToContainer(center);
      if (isClick) {
        const distance = Math.hypot(x - x1, y - y1);
        if (distance < nearest) {
          nearest = distance;
          selected[0] = stop;
        }
      } else if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) {
        selected.push(stop);
      }
    };
    for (const overlay of markerGroupRef.current?.getOverlays() || []) {
      const key = overlay.getExtData?.()?.key;
      const stop = allMapStopsRef.current.get(key);
      if (stop) consider({ ...stop, key }, overlay.getCenter?.());
    }
    for (const stop of viewportSelectionRef.current?.stops() || []) consider(stop, getLatLng(stop.location));
    setBoxSelectedStops(previous => {
      if (!extend) return selected;
      const next = new Map(previous.map(stop => [stop.key, stop]));
      for (const stop of selected) {
        if (isClick && next.has(stop.key)) next.delete(stop.key);
        else next.set(stop.key, stop);
      }
      return [...next.values()];
    });

    setBoxSelectStartPos(null);
    setBoxSelectEndPos(null);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isBoxSelectMode) {
      map.setStatus({ dragEnable: false, doubleClickZoom: false });
    } else {
      map.setStatus({ dragEnable: true, doubleClickZoom: true });
    }
  }, [isBoxSelectMode]);

  useEffect(() => {
    if (!markerGroupRef.current) return;
    const overlays = markerGroupRef.current.getOverlays();
    const selectedKeys = new Set(boxSelectedStops.map(s => s.key));

    overlays.forEach((o: any) => {
      const ext = o.getExtData ? o.getExtData() : null;
      if (ext && ext.key) {
        const isSelected = selectedKeys.has(ext.key);
        if (isSelected) {
          o.setOptions({
            strokeColor: '#B56666',
            strokeWeight: 4,
            radius: 10,
            fillColor: '#F5DDDD'
          });
          if (o.setZIndex) o.setZIndex(100);
        } else {
          const count = stopCountCacheRef.current.get(ext.key) || 0;
          const originalColor = stationLineStatsRef.current ? getStopColor(count, '#52796F') : '#52796F';
          o.setOptions({
            strokeColor: '#fff',
            strokeWeight: 2,
            radius: 8,
            fillColor: originalColor
          });
          if (o.setZIndex) o.setZIndex(30);
        }
      }
    });
  }, [boxSelectedStops, cacheUpdateTick, stationLineStats]);

  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!mapInstance || !AMap || showMinigameModal || showTimeline) return;
    const markers = boxSelectedStops.filter(stop => stop.key.startsWith('tile:')).map(stop => new AMap.CircleMarker({
      center: getLatLng(stop.location), radius: 6, fillColor: '#f5dddd', strokeColor: '#b56666',
      strokeWeight: 2, zIndex: 101, bubble: true,
    }));
    if (markers.length) mapInstance.add(markers);
    return () => { if (markers.length) mapInstance.remove(markers); };
  }, [boxSelectedStops, mapInstance, showMinigameModal, showTimeline]);

  // Helper SHA-256 for browser hashing
  const sha256 = async (message: string) => {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn("Subtle crypto failed, falling back to JS-based SHA-256", e);
      }
    }

    // Pure JavaScript SHA-256 implementation fallback
    function rotr(n: number, x: number) {
      return (x >>> n) | (x << (32 - n));
    }
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const bytes = new TextEncoder().encode(message);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const wIdx = i >> 2;
      if (words[wIdx] === undefined) words[wIdx] = 0;
      words[wIdx] |= bytes[i] << (24 - (i % 4) * 8);
    }
    const len = bytes.length;
    const padIdx = len >> 2;
    if (words[padIdx] === undefined) words[padIdx] = 0;
    words[padIdx] |= 0x80 << (24 - (len % 4) * 8);

    while (((words.length + 2) % 16) !== 0) {
      words.push(0);
    }
    words.push(0, len * 8);

    for (let chunk = 0; chunk < words.length; chunk += 16) {
      const w = words.slice(chunk, chunk + 16);
      while (w.length < 64) {
        const s0 = rotr(7, w[w.length - 15]) ^ rotr(18, w[w.length - 15]) ^ (w[w.length - 15] >>> 3);
        const s1 = rotr(17, w[w.length - 2]) ^ rotr(19, w[w.length - 2]) ^ (w[w.length - 2] >>> 10);
        w.push((w[w.length - 16] + s0 + w[w.length - 7] + s1) | 0);
      }

      let [a, b, c, d, e, f, g, h] = hash;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }

    const result: string[] = [];
    for (let i = 0; i < 8; i++) {
      let wordStr = (hash[i] >>> 0).toString(16);
      while (wordStr.length < 8) wordStr = '0' + wordStr;
      result.push(wordStr);
    }
    return result.join('');
  };

  // Status check & approved lines fetch
  const fetchApprovedLines = async () => {
    if (!showUserSubmittedData) {
      setApprovedUserLines([]);
      return;
    }
    try {
      let list: any[] = [];
      if (isFirebaseEnabled()) {
        console.log("Server is active, fetching approved lines from backend API...");
        list = await fetchApprovedLinesFromFirebase();
      } else {
        const url = `${API_BASE_URL}/api/submissions/approved`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        list = data || [];
      }

      setApprovedUserLines(list);

      // Load user submitted lines into fetchedLinesCache
      list.forEach((ul: any) => {
        fetchedLinesCache.current.set(ul.name, {
          id: ul.id,
          name: ul.name,
          path: ul.path.map((p: any) => Array.isArray(p) ? p : [p.lng, p.lat]),
          stops: [],
          start_stop: ul.via_stops[0]?.name || '始发站',
          end_stop: ul.via_stops[ul.via_stops.length - 1]?.name || '终点站',
          via_stops: ul.via_stops || [],
          isUserSubmitted: true,
          creatorNickname: ul.creatorNickname
        } as any);
      });
    } catch (err) {
      console.error('Failed to fetch approved user lines:', err);
      // Clean fallback from localStorage if backend is purely offline or unreachable
      const localSaved = localStorage.getItem('client_approved_user_lines');
      let list: any[] = [];
      if (localSaved) {
        try {
          list = JSON.parse(localSaved);
        } catch (e) {
          console.error(e);
        }
      }
      setApprovedUserLines(list);
      list.forEach((ul: any) => {
        fetchedLinesCache.current.set(ul.name, {
          id: ul.id,
          name: ul.name,
          path: ul.path.map((p: any) => Array.isArray(p) ? p : [p.lng, p.lat]),
          stops: [],
          start_stop: ul.via_stops[0]?.name || '始发站',
          end_stop: ul.via_stops[ul.via_stops.length - 1]?.name || '终点站',
          via_stops: ul.via_stops || [],
          isUserSubmitted: true,
          creatorNickname: ul.creatorNickname
        } as any);
      });
    }
  };

  const checkSubmissionStatuses = async (historicalList: any[]) => {
    if (!historicalList || !Array.isArray(historicalList) || historicalList.length === 0) return;
    try {
      const validIds = historicalList
        .map((h: any) => h && h.id)
        .filter((id): id is string => typeof id === 'string' && id.trim() !== '');

      if (validIds.length === 0) return;

      let data: Record<string, string> = {};
      if (isFirebaseEnabled()) {
        data = await checkSubmissionStatusFromFirebase(validIds);
      } else {
        const ids = validIds.join(',');
        const url = `${API_BASE_URL}/api/submissions/status?ids=${encodeURIComponent(ids)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        data = await res.json();
      }

      // Compare with existing local statuses to find newly processed items
      let newlyApproved = 0;
      let newlyRejected = 0;
      let transitionTime: number | null = null;

      historicalList.forEach((h: any) => {
        if (h && h.id && data[h.id]) {
          const prevStatus = h.status || 'pending';
          const newStatus = data[h.id];
          if (prevStatus === 'pending' && (newStatus === 'approved' || newStatus === 'rejected')) {
            if (newStatus === 'approved') newlyApproved++;
            if (newStatus === 'rejected') newlyRejected++;
            if (!transitionTime || h.timestamp > transitionTime) {
              transitionTime = h.timestamp;
            }
          }
        }
      });

      if (newlyApproved > 0 || newlyRejected > 0) {
        const d = transitionTime ? new Date(transitionTime) : new Date();
        const timeStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
        setNotification({
          show: true,
          approved: newlyApproved,
          rejected: newlyRejected,
          timeStr
        });
      }

      // Merge with custom statuses of lines locally saved/approved
      const mergedStatuses = { ...data };
      historicalList.forEach((h: any) => {
        if (h && h.id && !mergedStatuses[h.id]) {
          mergedStatuses[h.id] = h.status || 'approved';
        }
      });
      setSubmissionStatuses(mergedStatuses);

      // Save transitions to local storage immediately so notification only triggers once on this page session
      const updatedHistory = historicalList.map((h: any) => {
        if (h && h.id && data[h.id]) {
          const reasonKey = h.id + '_reason';
          const rejectReason = data[reasonKey];
          return {
            ...h,
            status: data[h.id],
            rejectReason: rejectReason || h.rejectReason || undefined
          };
        }
        return h;
      });
      setHistoricalSubmissions(updatedHistory);
      localStorage.setItem('user_drawn_lines_history', JSON.stringify(updatedHistory));
    } catch (err) {
      console.error('Failed to check statuses, using local fallback:', err);
      // Fallback: assume all local history items are 'approved' or keep original status
      const localStatuses: Record<string, string> = {};
      historicalList.forEach((h: any) => {
        if (h && h.id) {
          localStatuses[h.id] = h.status || 'approved';
        }
      });
      setSubmissionStatuses(localStatuses);
    }
  };

  // Periodic triggers or initial trigger
  useEffect(() => {
    if (showUserSubmittedData) {
      fetchApprovedLines();
    }
  }, [showUserSubmittedData]);

  useEffect(() => {
    if (showUserSubmittedData && historicalSubmissions.length > 0) {
      checkSubmissionStatuses(historicalSubmissions);
    }
  }, [historicalSubmissions, showUserSubmittedData]);

  // Translation dictionary (Simplified for Chinese)
  const translations: Record<string, string> = {
    settings: '设置',
    general: '通用',
    filterAirportBus: '过滤机场巴士',
    filterIntervalBus: '过滤区间车',
    filterUserSubmissions: '过滤用户添加',
    stationLineStats: '站点线路统计',
    about: '关于',
    version: '当前版本',
    startSearch: '检索',
    searching: '检索中...',
    showStations: '显示站点',
    showBaseMap: '显示底图',
    satelliteMap: '卫星底图',
    showUserSubmittedData: '显示用户添加数据',
    customDrawingDisabledHint: '自定义绘图功能已停用',
    cityWideSearch: '全市搜索',
    cancel: '取消',
    confirmEnable: '确认开启',
    stats: '统计',
    stops: '站点',
    lines: '线路',
    searchHint: '请放大以检索',
    locate: '定位',
    level: '缩放',
    title: '巴士线路图',
    searchPlaceholder: '搜索公交站、线路...',
    loadingDetails: '正在加载详情...',
    connectivity: '查看通达度',
    noDirection: '暂无方向信息',
    warning: '线路加载较多，请等待...',
    initializing: '系统初始化中',
    lineLabel: '线路',
  };

  const t = (key: string) => translations[key] || key;

  const [baseMapVisible, setBaseMapVisible] = useState(true);
  const [selectionPos, setSelectionPos] = useState<[number, number] | null>(null);
  const [selectedSegmentName, setSelectedSegmentName] = useState<string | null>(null);
  const [selectedSegmentAddress, setSelectedSegmentAddress] = useState<string | null>(null);
  const [currentCity, setCurrentCity] = useState<string>('全国');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autoCompleteRef = useRef<any>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchActiveRef = useRef(false);
  const searchComposingRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchIdRef = useRef(0);
  const dismissSearchSuggestions = () => {
    searchActiveRef.current = false;
    searchIdRef.current++;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSuggestionsLoading(false);
    setShowSuggestions(false);
    setIsMobileSearchOpen(false);
  };
  useEffect(() => {
    const onOutsidePointer = (event: PointerEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) dismissSearchSuggestions();
    };
    document.addEventListener('pointerdown', onOutsidePointer, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      searchIdRef.current++;
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);


  const getRandomPastelColor = () => {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 60%)`;
  };

  const locateAndReadNearby = async (allowLegacy = false) => {
    if(!mapRef.current||!(window as any).AMap)return;
    const request=++locationRequestRef.current;
    nearbyRequestRef.current?.abort();
    const controller = new AbortController();
    nearbyRequestRef.current = controller;
    setNearbyPanel({status:'locating',lines:[]});
    if(!navigator.geolocation){setNearbyPanel({status:'error',lines:[],message:'此浏览器不支持定位。'});return;}
    try {
      const location=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:60000}));
      if(request!==locationRequestRef.current)return;
      const position=gpsToMap([location.coords.longitude,location.coords.latitude]);
      // The game lobby follows the city/province containing the user's
      // accepted location; if it cannot resolve one, its defaults stay Beijing.
      void loadPublishedCities().then(catalog => {
        const matched = catalog.find(city => cityTouchesRadius(city, position, 0));
        if (!matched) return;
        setGameCity(matched.city);
        setGameProvince(matched.province);
        setGameCountyProvince(matched.province);
      }).catch(() => {});
      const map=mapRef.current,AMap=(window as any).AMap;
      if(!map||!AMap)return;
      if(!isMinigameActiveRef.current){
        map.setZoomAndCenter(16,position);
        if(locationMarkerRef.current)locationMarkerRef.current.setPosition(position);
        else {locationMarkerRef.current=new AMap.Marker({position,content:'<div style="width:14px;height:14px;border:2px solid white;border-radius:50%;background:#3b82f6;box-shadow:0 0 5px #0004"></div>',offset:new AMap.Pixel(-7,-7),zIndex:1000});locationMarkerRef.current.setMap(map);}
      }
      setNearbyPanel({status:'loading',lines:[],accuracy:location.coords.accuracy});
      let lines: NearbyState['lines'] = [], failed = 0;
      try {
        ({ lines, failed } = await loadNearbyTransitTiles(position, controller.signal));
      } catch (error) {
        if (!allowLegacy || controller.signal.aborted) throw error;
        // Explicit retries still work on older publications without the tile index.
        const catalog = await loadPublishedCities();
        const displayed = sharedMapDataRef.current ? lastCityDataset : null;
        const candidates = catalog.filter(city => cityTouchesRadius(city,position,500));
        for (const { city } of candidates) {
          if (request !== locationRequestRef.current) return;
          try {
            const data = displayed?.city === city ? displayed : await loadGameCity(city);
            lines.push(...nearbyLines(data, position, 500));
          } catch { failed++; }
        }
        lines.sort((a,b) => a.distance - b.distance);
      }
      if (request !== locationRequestRef.current) return;
      setNearbyPanel({status:lines.length?'ready':failed?'error':'missing',lines,accuracy:location.coords.accuracy,
        message:failed?'部分附近线路暂时未能读取，可稍后重新定位。':lines.length?undefined:'附近500米暂无网站已保存的线路数据。'});
    } catch(error:any) {
      if(request!==locationRequestRef.current)return;
      setNearbyPanel({status:error?.code===1?'denied':'error',lines:[],message:error?.code===1?'未获得定位权限。您可在浏览器设置中允许定位后重试。':'定位或附近线路读取失败，您仍可正常浏览地图。'});
    }
  };
  const handleLocate = () => {void locateAndReadNearby(true);};
  useEffect(()=>{
    if(dailyLocationCheckedRef.current||!mapInstance||loading||onboardingStep!==0||showMinigameModal)return;
    dailyLocationCheckedRef.current=true;
    const locate=async()=>{if(claimDailyLocation(localStorage))await locateAndReadNearby();};
    if(navigator.locks)void navigator.locks.request('busline-daily-location',{ifAvailable:true},async lock=>{if(lock)await locate();}).catch(()=>locate());
    else void locate();
  },[mapInstance,loading,onboardingStep,showMinigameModal]);
  useEffect(()=>()=>{locationRequestRef.current++;nearbyRequestRef.current?.abort();},[]);

  const clipSegmentToBox = (
    p1: [number, number],
    p2: [number, number],
    minLng: number,
    maxLng: number,
    minLat: number,
    maxLat: number
  ): [[number, number], [number, number]] | null => {
    let [x1, y1] = p1;
    let [x2, y2] = p2;

    let t0 = 0.0;
    let t1 = 1.0;
    const dx = x2 - x1;
    const dy = y2 - y1;

    const boundaries = [
      { p: -dx, q: x1 - minLng }, // minLng (left)
      { p: dx, q: maxLng - x1 },  // maxLng (right)
      { p: -dy, q: y1 - minLat }, // minLat (bottom)
      { p: dy, q: maxLat - y1 }   // maxLat (top)
    ];

    for (let i = 0; i < 4; i++) {
      const { p, q } = boundaries[i];
      if (p === 0) {
        if (q < 0) return null; // Parallel and outside
      } else {
        const t = q / p;
        if (p < 0) {
          if (t > t1) return null;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return null;
          if (t < t1) t1 = t;
        }
      }
    }

    if (t0 > t1) return null;

    return [
      [x1 + t0 * dx, y1 + t0 * dy],
      [x1 + t1 * dx, y1 + t1 * dy]
    ];
  };

  const clipPathToBox = (
    path: [number, number][],
    minLng: number,
    maxLng: number,
    minLat: number,
    maxLat: number
  ): [number, number][][] => {
    const clippedPaths: [number, number][][] = [];
    let currentSegment: [number, number][] = [];

    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const clipped = clipSegmentToBox(p1, p2, minLng, maxLng, minLat, maxLat);
      if (clipped) {
        const [cp1, cp2] = clipped;
        if (currentSegment.length === 0) {
          currentSegment.push(cp1);
        } else {
          const last = currentSegment[currentSegment.length - 1];
          const distSq = Math.pow(last[0] - cp1[0], 2) + Math.pow(last[1] - cp1[1], 2);
          if (distSq > 1e-10) {
            clippedPaths.push(currentSegment);
            currentSegment = [cp1];
          }
        }
        currentSegment.push(cp2);
      } else {
        if (currentSegment.length > 0) {
          clippedPaths.push(currentSegment);
          currentSegment = [];
        }
      }
    }
    if (currentSegment.length > 0) {
      clippedPaths.push(currentSegment);
    }
    return clippedPaths;
  };

  const getBoxForStops = (stops: any[]) => {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    stops.forEach((stop: any) => {
      if (stop && stop.location) {
        const lng = stop.location.lng;
        const lat = stop.location.lat;
        if (typeof lng === 'number' && typeof lat === 'number') {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    });

    if (minLng === Infinity) return null;

    const lngDiff = maxLng - minLng;
    const latDiff = maxLat - minLat;
    // Increased padding margin slightly to ensure comfortable gap between box borders and the outermost bus stops
    const lngPadding = Math.max(lngDiff * 0.12, 0.003);
    const latPadding = Math.max(latDiff * 0.12, 0.003);

    return {
      minLng: minLng - lngPadding,
      maxLng: maxLng + lngPadding,
      minLat: minLat - latPadding,
      maxLat: maxLat + latPadding
    };
  };

  const stopNameNormalizeCache = useMemo(() => new Map<string, string>(), []);
  const normalizeStopName = useCallback((name: string): string => {
    if (!name) return '';
    const cached = stopNameNormalizeCache.get(name);
    if (cached !== undefined) return cached;
    const res = name
      .replace(/\(.*?\)|（.*?）/g, '') // remove parenthesized annotations
      .replace(/\[.*?\]|【.*?】/g, '')
      .replace(/(公交站|汽车站|车站)$/g, '') // only strip generic station suffix at end
      .trim();
    stopNameNormalizeCache.set(name, res);
    return res;
  }, [stopNameNormalizeCache]);

  const cachedLinesVersionRef = useRef(0);
  const lastTerminalLinesVersionRef = useRef(-1);
  const terminalNamesCacheRef = useRef<Set<string>>(new Set());
  const terminalCacheSizeRef = useRef(-1);

  const updateTerminalNamesCache = useCallback(() => {
    const cache = fetchedLinesCache.current;
    const terminalSet = new Set<string>();
    if (cache && cache.size > 0) {
      for (const [, line] of cache.entries()) {
        if (!line) continue;
        if (line.end_stop) {
          const c = normalizeStopName(line.end_stop);
          if (c) terminalSet.add(c);
        }
        if (line.start_stop) {
          const c = normalizeStopName(line.start_stop);
          if (c) terminalSet.add(c);
        }
        if (line.via_stops && line.via_stops.length > 0) {
          const first = line.via_stops[0];
          const last = line.via_stops[line.via_stops.length - 1];
          if (first?.name) {
            const c = normalizeStopName(first.name);
            if (c) terminalSet.add(c);
          }
          if (last?.name) {
            const c = normalizeStopName(last.name);
            if (c) terminalSet.add(c);
          }
        }
      }
    }
    terminalNamesCacheRef.current = terminalSet;
    terminalCacheSizeRef.current = cache.size;
    lastTerminalLinesVersionRef.current = cachedLinesVersionRef.current;
  }, [normalizeStopName]);

  const isTerminalStation = useCallback((stop: any): boolean => {
    if (!stop || !stop.name) return false;
    const sClean = normalizeStopName(stop.name);
    if (!sClean) return false;

    // Direct terminal title in stop name
    if (sClean.endsWith('终点站') || sClean.endsWith('总站')) {
      return true;
    }

    if (lastTerminalLinesVersionRef.current !== cachedLinesVersionRef.current || terminalCacheSizeRef.current !== fetchedLinesCache.current.size) {
      updateTerminalNamesCache();
      lastTerminalLinesVersionRef.current = cachedLinesVersionRef.current;
    }

    // 1. Check direct cache set
    if (terminalNamesCacheRef.current.has(sClean)) {
      return true;
    }

    return false;
  }, [normalizeStopName, updateTerminalNamesCache]);

  const syncVisibleStopsRef = useRef<() => void>(() => {});
  syncVisibleStopsRef.current = () => { if (mapRef.current && (window as any).AMap) syncStopMarkersToMap(mapRef.current, (window as any).AMap); };

  function syncStopMarkersToMap(map: any, AMap: any) {
    if (!markerGroupRef.current || isMinigameActiveRef.current) return;

    if (!showStations || (map.getZoom() < CITY_DETAIL_ZOOM && !activeBusLine)) {
      syncLazyMarkers(markerGroupRef.current, []);
      setStats((prev: any) => ({ ...prev, stops: 0 }));
      return;
    }

    const rawMarkers = activeRawMarkersRef.current || [];
    let visibleMarkers = rawMarkers;

    // Filter using active keys in allMapStopsRef if allMapStopsRef has active stops
    if (allMapStopsRef.current && allMapStopsRef.current.size > 0) {
      visibleMarkers = visibleMarkers.filter((marker: any) => {
        const ext = marker.getExtData ? marker.getExtData() : null;
        if (ext && ext.key) {
          return allMapStopsRef.current.has(ext.key);
        }
        return true;
      });
    }

    // Filter terminal stations only
    const isTerminalMode = filterTerminalOnlyRef.current && !activeBusLine;
    if (isTerminalMode) {
      visibleMarkers = visibleMarkers.filter((marker: any) => {
        const ext = marker.getExtData ? marker.getExtData() : null;
        if (ext && ext.key) {
          const stopData = allMapStopsRef.current?.get(ext.key) || roadStopsDataRef.current?.get(ext.key);
          if (stopData) {
            return isTerminalStation(stopData);
          }
        }
        return false;
      });

    }




    const eligibleCount = visibleMarkers.length;
    if (!activeBusLine) visibleMarkers = viewportStopMarkers(visibleMarkers, map);
    if (isTerminalMode) {
      // Style every terminal station marker with an obvious gray circle
      visibleMarkers.forEach((marker: any) => {
        try {
          marker.setOptions({
            fillColor: '#52525B', // Deep neutral charcoal/zinc gray
            strokeColor: '#FFFFFF', // High-contrast crisp white border
            strokeWeight: 3,
            radius: 9, // Obvious larger circle
            fillOpacity: 0.95,
            zIndex: 85
          });
        } catch (e) {}
      });
    } else {
      // Normal mode: restore original marker colors and radius
      visibleMarkers.forEach((marker: any) => {
        try {
          const ext = marker.getExtData ? marker.getExtData() : null;
          marker.setOptions({
            fillColor: ext?.originalColor || '#3b82f6',
            strokeColor: '#FFFFFF',
            strokeWeight: 1.5,
            radius: ext?.originalRadius || 6,
            fillOpacity: 0.9,
            zIndex: 60
          });
        } catch (e) {}
      });
    }

    syncLazyMarkers(markerGroupRef.current, visibleMarkers);
    setStats((prev: any) => ({ ...prev, stops: eligibleCount }));

  }

  const toggleTerminalFilter = useCallback(() => {
    setFilterTerminalOnly(prev => {
      const next = !prev;
      filterTerminalOnlyRef.current = next;
      if (next && !showStations) {
        setShowStations(true);
        localStorage.setItem('app_show_stations', 'true');
      }
      if (mapInstance && (window as any).AMap) {
        syncStopMarkersToMap(mapInstance, (window as any).AMap);
      }
      return next;
    });
  }, [mapInstance, showStations]);

  const terminalStopsCount = useMemo(() => {
    const stopsMap = roadStopsDataRef.current.size > 0 ? roadStopsDataRef.current : allMapStopsRef.current;
    if (!stopsMap || stopsMap.size === 0) return 0;
    let count = 0;
    stopsMap.forEach((s) => {
      if (isTerminalStation(s)) count++;
    });
    return count;
  }, [cacheUpdateTick, stats.lines, stats.stops, isTerminalStation]);



  const renderBusLine = (line: any, AMap: any, map: any, clear = true, showMarkers = true, shouldFitView = true) => {
    roadLookupVersionRef.current++;
    const lineCity = line.city || currentCity;
    const path = line.path.map((p: any) => Array.isArray(p) ? p : [p.lng, p.lat]);
    if (!line.isUserSubmitted) {
      line = { ...line, city: (typeof line.city === 'string' && line.city.trim()) || currentCity, ...getOperatingHours(line) };
      const cachedLine = { ...line, path, stops: [], scheduleFetched: true,
        sourceQueries: [...new Set([...(fetchedLinesCache.current.get(line.name)?.sourceQueries || []), ...(line.sourceQueries || [])])] };
      fetchedLinesCache.current.set(line.name, cachedLine);
      if (enableLineCacheRef.current && line.city) {
        void saveLinesToCache(line.city, [cachedLine], []).then(() => refreshLineCacheStats());
      }
      cachedLinesVersionRef.current++;
      setCacheUpdateTick(value => value + 1);
    }
    displayedLineNamesRef.current = clear ? [line.name] : Array.from(new Set([...displayedLineNamesRef.current, line.name]));
    setTimelineAvailable(true);
    let polylineObj: any = null;

    let displayPaths = [path];

    if (lineGroupRef.current) {
      if (clear) {
        // If there was an active single line polyline, remove it first
        if (activeBusLinePolylineRef.current) {
          lineGroupRef.current.removeOverlay(activeBusLinePolylineRef.current);
          activeBusLinePolylineRef.current = null;
        }
        // Faint out all existing road search polylines asynchronously without blocking UI thread
        requestAnimationFrame(() => {
          roadOverlaysRef.current.forEach((polyline: any) => {
            try {
              polyline.setOptions({
                strokeOpacity: 0.09,
                outlineColor: 'transparent',
                borderWeight: 0
              });
            } catch (e) {}
          });
        });
      }

      let polyline: any = null;
      if (displayPaths.length > 0) {
        polyline = new AMap.Polyline({
          path: displayPaths,
          strokeColor: line.isUserSubmitted ? '#BA55D3' : (clear ? '#3b82f6' : getRandomPastelColor()),
          strokeWeight: lineThickness === 'thin' ? 2.5 : 5,
          strokeOpacity: 0.8,
          lineJoin: 'round',
          lineCap: 'round',
          isOutline: true,
          outlineColor: '#ffffff',
          borderWeight: lineThickness === 'thin' ? 0.5 : 1.5,
          zIndex: 55
        });
        polylineObj = polyline;
        if (clear) {
          setActiveBusLine(line);
          setTopCard('line');
          activeBusLinePolylineRef.current = polyline;
          polyline.on('click', (e: any) => {
            const clickLngLat = [e.lnglat.getLng(), e.lnglat.getLat()];
            if (pickPlannerMapStop(clickLngLat as Point, map)) return;


            if (!(window as any).AMap.GeometryUtil) return;
            const GeometryUtil = (window as any).AMap.GeometryUtil;

            // Map stops to path indices
            const stopIndices = (line.via_stops || []).map((stop: any) => {
              let minDist = Infinity;
              let minIdx = 0;
              for (let i = 0; i < path.length; i++) {
                const d = GeometryUtil.distance(
                  [stop.location.lng, stop.location.lat],
                  path[i]
                );
                if (d < minDist) {
                  minDist = d;
                  minIdx = i;
                }
              }
              return minIdx;
            });

            // Ensure stopIndices are strictly monotonically increasing to avoid overlapping
            for (let i = 1; i < stopIndices.length; i++) {
              if (stopIndices[i] <= stopIndices[i - 1]) {
                stopIndices[i] = stopIndices[i - 1] + 1;
              }
            }

            // Find the exact snapped projection on the polyline segments
            let bestProjected = clickLngLat as [number, number];
            let bestDistSq = Infinity;
            let bestSegIdx = 0;

            const localGetDistSq = (p1: [number, number], p2: [number, number]) => {
              const dx = p1[0] - p2[0];
              const dy = p1[1] - p2[1];
              return dx * dx + dy * dy;
            };

            const localGetProjection = (p: [number, number], v: [number, number], w: [number, number]): [number, number] => {
              const l2 = localGetDistSq(v, w);
              if (l2 === 0) return v;
              let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
              t = Math.max(0, Math.min(1, t));
              return [
                v[0] + t * (w[0] - v[0]),
                v[1] + t * (w[1] - v[1])
              ];
            };

            for (let i = 0; i < path.length - 1; i++) {
              const segStart = path[i];
              const segEnd = path[i+1];
              const proj = localGetProjection(clickLngLat as [number, number], segStart as [number, number], segEnd as [number, number]);
              const dSq = localGetDistSq(clickLngLat as [number, number], proj);
              if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestProjected = proj;
                bestSegIdx = i;
              }
            }

            const clickMinIdx = bestSegIdx;

            // Find surrounding stops
            let prevStopIdx = 0;
            for (let i = 0; i < stopIndices.length - 1; i++) {
              if (clickMinIdx >= stopIndices[i] && clickMinIdx <= stopIndices[i+1]) {
                prevStopIdx = i;
                break;
              }
            }
            if (clickMinIdx > stopIndices[stopIndices.length - 1]) prevStopIdx = stopIndices.length - 2;

            let nextStopIdx = prevStopIdx + 1;
            if (nextStopIdx >= line.via_stops.length) nextStopIdx = line.via_stops.length - 1;

            setSelectionPos(bestProjected);
            setSelectedSegmentName(null);
            setSelectedSegmentLines(null);

            let queryLngLat = bestProjected;
            const snapSegStart = path[bestSegIdx];
            const snapSegEnd = path[bestSegIdx + 1];
            if (snapSegStart && snapSegEnd) {
               const dx = snapSegEnd[0] - snapSegStart[0];
               const dy = snapSegEnd[1] - snapSegStart[1];
               const len = Math.sqrt(dx*dx + dy*dy);
               if (len > 0.0001) {
                 const shiftAmt = 0.0003; // ~30 meters
                 const distToEnd = Math.sqrt(Math.pow(snapSegEnd[0] - queryLngLat[0], 2) + Math.pow(snapSegEnd[1] - queryLngLat[1], 2));
                 if (distToEnd > shiftAmt) {
                   queryLngLat = [queryLngLat[0] + (dx/len)*shiftAmt, queryLngLat[1] + (dy/len)*shiftAmt];
                 } else {
                   queryLngLat = [queryLngLat[0] - (dx/len)*shiftAmt, queryLngLat[1] - (dy/len)*shiftAmt];
                 }
               }
            }

            const geocoder = new AMap.Geocoder({ radius: 30, extensions: 'all' });
            geocoder.getAddress(queryLngLat as [number, number], (status: string, result: any) => {
              if (status === 'complete' && result.info === 'OK') {
                const comp = result.regeocode.addressComponent;
                const preciseLocation = [
                  comp.province,
                  comp.city !== comp.province ? comp.city : '',
                  comp.district,
                  comp.township
                ].filter(Boolean).join('');

                const nearestRoad = result.regeocode.roads && result.regeocode.roads.length > 0 ? result.regeocode.roads[0].name : '';
                const genericPoi = result.regeocode.pois && result.regeocode.pois.length > 0 ? result.regeocode.pois[0].name : '当前位置';
                const fallbackName = nearestRoad || genericPoi;

                setSelectedStop({
                  name: fallbackName,
                  address: preciseLocation || result.regeocode.formattedAddress,
                  lines: [],
                  city: lineCity,
                  isBusStop: false,
                  segmentName: `${line.via_stops[prevStopIdx].name} - ${line.via_stops[nextStopIdx].name}`
                });
              }
            });
          });
        }
        lineGroupRef.current.addOverlay(polyline);
      } else {
        if (clear) {
          setActiveBusLine(line);
          setTopCard('line');
          activeBusLinePolylineRef.current = null;
        }
      }
    }

    if (markerGroupRef.current && showMarkers) {
      if (clear) {
        allMapStopsRef.current.clear();
      }
      const markers = (line.via_stops || []).map((stop: any) => {
        const count = stopCountCacheRef.current.get(`${stop.location.lng},${stop.location.lat}`) || 0;
        const stopKey = `${stop.location.lng},${stop.location.lat}`;
        allMapStopsRef.current.set(stopKey, {
          name: stop.name,
          location: stop.location,
          lines: [line.name],
          city: lineCity
        });

        const marker = lazyStopMarker(AMap, {
          center: [stop.location.lng, stop.location.lat],
          radius: 6,
          fillColor: getStopColor(count, '#3b82f6'),
          strokeColor: '#fff',
          strokeWeight: 1.5,
          bubble: false,
          zIndex: 60,
          cursor: 'pointer',
          extData: { key: `${stop.location.lng},${stop.location.lat}`, type: 'busLineStop' }
        });
        marker.on('click', async () => {
          if (isMinigameActiveRef.current) return;
          const stopLatLng = getLatLng(stop.location);
          if (selectPlannerStop({ city: lineCity, name: stop.name, location: stopLatLng }, [line.name])) return;

          setSelectionPos(stopLatLng);
          setTopCard('stop');
          setSelectedStop({
            name: stop.name,
            address: t('loadingDetails'),
            lines: [],
            city: lineCity
          });

          // Fetch full details to show all lines
          const details = await fetchStopDetails(stop.name, stopLatLng, AMap, lineCity);
          if (details) {
            setSelectedStop({ ...details, city: lineCity });
          } else {
             setSelectedStop({
               name: stop.name,
               address: '无详细线路数据',
               lines: [line.name.split('(')[0]], // Fallback to current line if data missing
               city: lineCity
             });
          }
        });
        return marker;
      });
      activeRawMarkersRef.current = markers;
      syncStopMarkersToMap(map, AMap);
    }
    if (shouldFitView && polylineObj) map.setFitView(polylineObj);

  };

  const drawPriorityRoute = (line: BusLine, AMap: any, transfer = false) => {
    if (line.path.length < 2) return;
    priorityCoverageRef.current?.addOverlay(new AMap.Polyline({
      path: line.path.map(getLatLng), strokeColor: transfer ? '#7c3aed' : '#1768aa',
      strokeWeight: lineThickness === 'thin' ? 3 : 5, strokeOpacity: .95,
      lineJoin: 'round', lineCap: 'round', isOutline: true, outlineColor: '#fff',
      borderWeight: 1, zIndex: 75, bubble: true,
    }));
  };

  const coverageLines = async (city: string, names: string[], cancelled: () => boolean, supplied?: CityDataset | null) => {
    const published = supplied === undefined ? await cityDataCache.get(city).catch(() => null) : supplied;
    if (cancelled()) return [];
    const found = new Map<string, BusLine>();
    const unresolved = new Set<string>();
    const matches = (line: BusLine, name: string) => line.name === name
      || matchesReturnedLine(name, line);
    for (const name of names) {
      const saved = published?.lines.filter(line => matches(line, name)) || [];
      if (!saved.length) unresolved.add(name);
      for (const line of saved) if (!viewportLineBlocked(line.name)) found.set(line.id || line.name, line);
    }
    const AMap = (window as any).AMap;
    for (const name of unresolved) {
      if (cancelled()) return [];
      const result = await searchCityLine(AMap, city || '全国', lineBaseIdentity(name), cancelled, checkAmapQuotaError);
      const candidates = result.lines.filter(line => matches(line, name));
      for (const line of candidates) {
        if (!viewportLineBlocked(line.name)) found.set(line.id || line.name, { ...line, city, path: line.path.map(getLatLng) });
      }
    }
    return [...found.values()];
  };

  const showStopConnectivity = async (stopLines: string[]) => {
    const AMap = (window as any).AMap;
    if (!priorityCoverageRef.current || !AMap || !stopLines.length) return;
    clearPriorityCoverage();
    const version = coverageVersionRef.current, search = searchVersionRef.current;
    const cancelled = () => version !== coverageVersionRef.current || search !== searchVersionRef.current || isMinigameActiveRef.current;
    const cities = new Map<string, Set<string>>();
    const names = new Set(stopLines);
    for (const stop of boxSelectedStops) {
      const city = stop.city || currentCity;
      const lines = cities.get(city) ?? new Set<string>();
      for (const name of stop.lines || []) if (names.has(name)) lines.add(name);
      cities.set(city, lines);
    }
    if (!cities.size) cities.set(currentCity, names);
    setCoverageActive(true);
    setCoverageBusy(true);
    try {
      const entries = [...cities].filter(([, lines]) => lines.size);
      for (let i = 0; i < entries.length && !cancelled(); i += 3) {
        await Promise.all(entries.slice(i, i + 3).map(async ([city, lines]) => {
          const routes = await coverageLines(city, [...lines], cancelled);
          if (!cancelled()) routes.forEach(route => drawPriorityRoute(route, AMap));
        }));
      }
    } catch {
      if (!cancelled()) setApiErrorNotification('部分通达线路暂时无法读取，可稍后重试。');
    } finally {
      if (!cancelled()) setCoverageBusy(false);
    }
  };

  const executeStationConnectivity = async (
    stop: any,
    _checkedLines: Set<string>,
    transferEnabled: boolean,
    atStation: number
  ) => {
    if (!priorityCoverageRef.current || !(window as any).AMap) return;

    const linesToQuery = stop.lines || [];
    if (linesToQuery.length === 0) {
      setConnectivityToast('该站点暂无线路信息');
      setTimeout(() => setConnectivityToast(null), 3500);
      return;
    }

    clearPriorityCoverage();
    const version = coverageVersionRef.current, search = searchVersionRef.current;
    const cancelled = () => version !== coverageVersionRef.current || search !== searchVersionRef.current || isMinigameActiveRef.current;
    setCoverageActive(true);
    setCoverageBusy(true);
    setConnectivityToast('正在初始化检索...');

    try {
      const AMap = (window as any).AMap;
      const city = stop.city || currentCity;
      const published = await cityDataCache.get(city).catch(() => null);
      if (cancelled()) return;
      const renderedLines = new Set<string>();
      const transferStations = new Map<string, [number, number]>();
      const directLinesInfo: { name: string; stops: string[] }[] = [];
      const transferLinesInfo: { name: string; lastThree: string[] }[] = [];

      const targetSourceClean = normalizeStopName(stop.name);
      const searchAndProcessLine = async (lineName: string, isTransfer = false) => {
        const infos = await coverageLines(city, [lineName], cancelled, published);
        if (cancelled()) return;
        for (const info of infos) {
          const stops = info.via_stops || [];
          const stopNames = stops.map(s => s.name);
          if (!isTransfer) {
            const normalized = stopNames.map(normalizeStopName);
            let index = normalized.indexOf(targetSourceClean);
            if (index === -1) index = normalized.findIndex(name => name && (name.includes(targetSourceClean) || targetSourceClean.includes(name)));
            if (index === -1) continue;
            const target = transferEnabled && stops[index + atStation];
            if (target) transferStations.set(target.name, getLatLng(target.location));
          }

          const key = info.id || info.name;
          if (renderedLines.has(key)) continue;
          renderedLines.add(key);
          drawPriorityRoute(info, AMap, isTransfer);
          if (isTransfer) transferLinesInfo.push({ name: info.name, lastThree: stopNames.slice(-3).reverse() });
          else directLinesInfo.push({ name: info.name, stops: stopNames });
        }
      };

      // 1. Process source lines
      setConnectivityToast(`正在检索本站线路 (${linesToQuery.length}条)...`);
      for (const lName of linesToQuery) {
        await searchAndProcessLine(lName, false);
        if (cancelled()) return;
      }

      if (transferEnabled && transferStations.size > 0) {
        setConnectivityToast(`发现 ${transferStations.size} 个换乘站点，正在检索增益线路...`);
        for (const [name, location] of transferStations) {
          const saved = published?.lines.filter(line => line.via_stops?.some(stop =>
            normalizeStopName(stop.name) === normalizeStopName(name)
            && Math.hypot(stop.location.lng - location[0], stop.location.lat - location[1]) < .0006)).map(line => line.name);
          const details = saved?.length ? { lines: saved } : await fetchStopDetails(name, location, AMap, city);
          if (cancelled()) return;
          for (const line of details?.lines || []) {
            await searchAndProcessLine(line, true);
            if (cancelled()) return;
          }
        }
      }

      setConnectivityToast('正在生成 AI 总结...');
      const prompt = `站点名称：${stop.name}
本站公交线路及路径：
${directLinesInfo.map(l => `- ${l.name}: ${l.stops.join(' -> ')}`).join('\n')}
${transferEnabled ? `\n换乘（第${atStation}站）后的增益线路及方向：\n${transferLinesInfo.map(l => `- ${l.name} (最远三站: ${l.lastThree.join(', ')})`).join('\n')}` : ''}

请简要总结该站点的通达情况。`;
      try {
        const response = await fetch('/api/ai/summary', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
        });
        const data = await response.json();
        if (cancelled()) return;
        if (data.summary) setStationConnectivityCard(prev => prev ? { ...prev, aiSummary: data.summary } : null);
        else if (data.error) { setConnectivityToast(`AI 错误: ${data.details || data.error}`); return; }
      } catch {
        if (!cancelled()) setConnectivityToast('AI 总结请求失败');
        return;
      }
      setConnectivityToast(null);
    } catch {
      if (!cancelled()) setConnectivityToast('暂时无法读取通达线路，可稍后重试。');
    } finally {
      if (!cancelled()) setCoverageBusy(false);
    }
  };


  const fetchStopDetails = async (name: string, location: [number, number], AMap: any, city: string, publishedOnly = false): Promise<any> => {
    const getDistSq = (p1: [number, number], p2: [number, number]) => {
      return Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);
    };
    const normalized = (value: string) => value.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, '').trim();
    const cleanStopName = normalized(name);
    const matchesStop = (stop: any) => normalized(stop?.name || '') === cleanStopName
      && getDistSq(getLatLng(stop.location), location) < 0.0000005;

    // A viewport tile can contain only the routes available in its currently
    // loaded area. Always consult the complete saved city snapshot as well,
    // otherwise clicking a stop may show merely a subset of its routes.
    const savedCity = await cityDataCache.get(city || currentCity).catch(() => null);
    const localLines = new Set<string>();
    for (const line of fetchedLinesCache.current.values()) {
      if (!isLineNameBlockedRef(line.name) && line.via_stops?.some(matchesStop)) localLines.add(line.name);
    }
    for (const line of savedCity?.lines || []) {
      if (!isLineNameBlockedRef(line.name) && line.via_stops?.some(matchesStop)) localLines.add(line.name);
    }
    if (showUserSubmittedData) {
      for (const line of approvedUserLines) {
        if (!isLineNameBlockedRef(line.name) && line.via_stops?.some(matchesStop)) localLines.add(line.name);
      }
    }
    // A retrieval-complete city snapshot is the authoritative local source;
    // it already includes every collected direction and returns immediately.
    if (publishedOnly || (savedCity?.retrievalComplete && localLines.size)) {
      return localLines.size ? { name, address: '', lines: [...localLines], isBusStop: true } : null;
    }
    const stationSupplement = discoverStationLines(AMap, city || currentCity,
      [{ name, location: { lng: location[0], lat: location[1] } }], () => false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 15000);
      const safeResolve = async (val: any) => {
        clearTimeout(timer);
        const stationLines = await stationSupplement;
        if (stationLines.length) {
          val = { name, address: '', isBusStop: true, ...val,
            lines: [...new Set([...(val?.lines || []), ...stationLines])] };
        }
        if (val || localLines.size) {
          val = { name, address: '', isBusStop: true, ...val,
            lines: [...new Set([...localLines, ...(val?.lines || [])])] };
        }
        if (val?.lines) {
          const matchUserLines = showUserSubmittedData
            ? approvedUserLines
              .filter(ul => {
                if (isLineNameBlockedRef(ul.name)) {
                  return false;
                }
                return ul.via_stops.some((vs: any) => {
                  const cleanVs = vs.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').trim();
                  return cleanVs === cleanStopName;
                });
              })
              .map(ul => ul.name)
            : [];
          val.lines = Array.from(new Set([...val.lines, ...matchUserLines])).filter((l: string) => !isLineNameBlockedRef(l));
        }
        resolve(val);
      };

      const doStationSearchFallback = () => {
        const stationSearch = new AMap.StationSearch({
          pageIndex: 1,
          pageSize: 50,
          city: city || '全国'
        });
        stationSearch.search(name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, ''), (status: string, result: any) => {
          if (status === 'complete' && result.stationInfo && result.stationInfo.length > 0) {
            let bestStation = result.stationInfo[0];
            let minDist = getDistSq([bestStation.location.lng, bestStation.location.lat], location);
            for(let i = 1; i < result.stationInfo.length; i++) {
              const d = getDistSq([result.stationInfo[i].location.lng, result.stationInfo[i].location.lat], location);
              if (d < minDist) {
                minDist = d;
                bestStation = result.stationInfo[i];
              }
            }
            if (minDist < 0.005 && bestStation.buslines && bestStation.buslines.length > 0) {
              safeResolve({
                name: bestStation.name.replace(/\(.*?\)|（.*?）/g, ''),
                address: bestStation.adcode ? `区域代码: ${bestStation.adcode}` : '',
                lines: bestStation.buslines.map((l: any) => l.name),
                isBusStop: true
              });
              return;
            }
          }
          safeResolve(null);
        });
      };

      // 1. PlaceSearch to find the precise platform and its short lines
      const ps = new AMap.PlaceSearch({
        pageSize: 50,
        extensions: 'all',
        type: '公交车站',
        city: city || '全国'
      });

      ps.searchNearBy(name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, ''), location, 200, (pStatus: string, pResult: any) => {
        let matchedPois: any[] = [];
        const cleanSearchName = name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, '').trim();
        if (pStatus === 'complete' && pResult.poiList && pResult.poiList.pois.length > 0) {
          const stationPois = pResult.poiList.pois.filter((p: any) => p.type && (p.type.includes('公交') || p.type.includes('车站') || p.type.includes('设施') || p.type.includes('地铁')));
          matchedPois = stationPois.filter((p: any) => p.name.includes(cleanSearchName));
          if (matchedPois.length === 0 && stationPois.length > 0) {
            // fallback: closest one if none match by name
            let bestPoi = stationPois[0];
            let minDist = getDistSq([bestPoi.location.lng, bestPoi.location.lat], location);
            for(let i = 1; i < stationPois.length; i++) {
              const d = getDistSq([stationPois[i].location.lng, stationPois[i].location.lat], location);
              if (d < minDist) {
                minDist = d;
                bestPoi = stationPois[i];
              }
            }
            matchedPois = [bestPoi];
          }
        }

        if (matchedPois.length === 0) {
          doStationSearchFallback();
          return;
        }

        const aggregatedShortLines = new Set<string>();
        const aggregatedAddresses = new Set<string>();

        matchedPois.forEach(poi => {
          const addressStr = poi.address || '';
          if (addressStr) aggregatedAddresses.add(addressStr);
          const shortLines = addressStr.split(/[;；]/).map((s: string) => s.trim()).filter((s: string) =>
            s.length > 0 && !isLineNameBlockedRef(s)
          );
          shortLines.forEach((l: string) => aggregatedShortLines.add(l));
        });

        const shortLinesArray = Array.from(aggregatedShortLines);

        if (shortLinesArray.length === 0) {
           doStationSearchFallback();
           return;
        }

        // Trace exact directions via LineSearch concurrently
        const exactDirectedLines: string[] = [];
        const lineSearch = new AMap.LineSearch({
          pageIndex: 1,
          city: city || '全国',
          pageSize: 10,
          extensions: 'all'
        });

        Promise.all(shortLinesArray.map((shortName: string) => {
           return new Promise<void>((res) => {
             lineSearch.search(shortName, (sStatus: string, sResult: any) => {
               if (sStatus === 'complete' && sResult.lineInfo && sResult.lineInfo.length > 0) {
                 // For each direction returned, check if it visits ANY of the matched platforms
                 sResult.lineInfo.forEach((info: any) => {
                   if (info.via_stops) {
                     const hitsPlatform = info.via_stops.some((vStop: any) => {
                       return matchedPois.some((poi: any) => {
                         const d = getDistSq([vStop.location.lng, vStop.location.lat], [poi.location.lng, poi.location.lat]);
                         const vStopClean = vStop.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').trim();
                         const nameMatch = vStopClean.includes(cleanSearchName) || cleanSearchName.includes(vStopClean);
                         return nameMatch || d < 0.0000005; // Strict match (~10m sq-dist)
                       });
                     });
                     if (hitsPlatform) {
                       exactDirectedLines.push(info.name);
                     }
                   }
                 });
               }
               res();
             });
           });
        })).then(() => {
           if (exactDirectedLines.length > 0) {
             safeResolve({
               name: cleanSearchName || matchedPois[0].name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, '').trim(),
               address: Array.from(aggregatedAddresses).join(' | ') || matchedPois[0].district,
               lines: Array.from(new Set(exactDirectedLines)),
               isBusStop: true
             });
           } else {
             safeResolve({
               name: cleanSearchName || matchedPois[0].name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, '').trim(),
               address: Array.from(aggregatedAddresses).join(' | ') || matchedPois[0].district,
               lines: shortLinesArray,
               isBusStop: true
             });
           }
        });
      });
    });
  };

  pickViewportRef.current = point => {
    const layer = viewportSelectionRef.current;
    const map = mapRef.current;
    if (!layer || !map || timelineAvailable) return false;
    const pixel = map.lngLatToContainer(point);
    let nearest = 11;
    let selected;
    for (const stop of layer.stops()) {
      const where = map.lngLatToContainer(getLatLng(stop.location));
      const distance = Math.hypot(pixel.x - where.x, pixel.y - where.y);
      if (distance < nearest) { nearest = distance; selected = stop; }
    }
    if (selected) {
      selectedViewportRoutesRef.current = [];
      setSelectedSegmentLines(null);
      setSelectedSegmentName(null);
      setSelectedSegmentAddress(null);
      setSelectionPos(getLatLng(selected.location));
      setTopCard('stop');
      setSelectedStop(selected);
      // Keep tile routes visible while merging the full published snapshot.
      // A map click on published data must not fan out into live SDK searches.
      const selectedKey = selected.key;
      void fetchStopDetails(selected.name, getLatLng(selected.location), (window as any).AMap, selected.city || currentCity, true)
        .then(details => {
          if (!details) return;
          setSelectedStop((previous: any) => {
            if (!previous || previous.key !== selectedKey) return previous;
            return {
              ...previous,
              lines: Array.from(new Set([...(previous.lines || []), ...(details.lines || [])]))
            };
          });
        });
      return true;
    }
    const routes = layer.routesAt(point);
    if (!routes.length) return false;
    selectedViewportRoutesRef.current = routes;
    setSelectedStop(null);
    setSelectionPos(point);
    setTopCard('stop');
    setSelectedSegmentName('当前路段');
    setSelectedSegmentAddress(null);
    setSelectedSegmentLines([...new Set(routes.map(route => route.name))]);
    return true;
  };

  const openTimeline = async () => {
    if (showTimeline) { setShowTimeline(false); return; }
    clearPriorityCoverage();
    const version = ++searchVersionRef.current;
    const map = mapRef.current;
    let lines = displayedLineNamesRef.current.map(name => fetchedLinesCache.current.get(name)).filter((line): line is BusLine => !!line);
    if (!timelineAvailable || !lines.length) {
      setIsSearching(true);
      try {
        const published = await cityDataCache.get(currentCity).catch(() => null);
        lines = published?.lines.filter(line => !viewportLineBlocked(line.name)) || [];
      } finally {
        if (version === searchVersionRef.current) setIsSearching(false);
      }
    }
    // The timeline is an estimate based on a concrete first/last departure.
    // Date-specific schedules cannot be placed on one daily axis.
    lines = lines.filter(line => isLineOperating(line, 0) !== null);
    if (version !== searchVersionRef.current || map !== mapRef.current || isMinigameActiveRef.current || !lines.length) return;
    setTimelineLines(lines);
    setSelectedStop(null); setSelectedSegmentLines(null); setActiveBusLine(null); setStationConnectivityCard(null);
    setShowTimeline(true);
  };

  const onStopClick = async (item: any) => {
    roadLookupVersionRef.current++;
    const map = mapRef.current;
    if (!map) return;
    const AMap = (window as any).AMap;
    if (!AMap) return;

    if (item.location) {
      const itemLatLng = getLatLng(item.location);
      map.setCenter(itemLatLng);
      if (map.getZoom() < 16) map.setZoom(16);
      setSelectionPos(itemLatLng);
    }

    setSelectedStop({
      name: item.name,
      address: t('loadingDetails'),
      lines: [],
      city: currentCity
    });

    const pos = item.location ? getLatLng(item.location) : (selectionPos || [0, 0]);
    const details = await fetchStopDetails(item.name, pos as [number, number], AMap, currentCity);
    if (details) {
      setSelectedStop({ ...details, city: currentCity });
    } else {
      setSelectedStop({
        name: item.name,
        address: item.address,
        lines: (item.address || '').split(/[;；]/).map((s: string) => s.trim()).filter((s: string) =>
          s.length > 0 && !isLineNameBlockedRef(s)
        ).filter(isValidBusLineName),
        city: currentCity
      });
    }
  };

  const cycleMapMode = () => {
    setMapMode(prev => {
      let next: MapMode;
      if (prev === 'normal') next = 'satellite';
      else if (prev === 'satellite') next = 'blank';
      else next = 'normal';
      return next;
    });
  };

  const cycleStationMode = () => {
    setStationMode(prev => {
      let next: StationDisplayMode;
      if (prev === 'all') next = 'terminal';
      else if (prev === 'terminal') next = 'none';
      else next = 'all';
      return next;
    });
  };

  const toggleStations = () => {
    cycleStationMode();
  };

  const toggleBaseMap = () => {
    cycleMapMode();
  };

  const toggleSatelliteMap = () => {
    cycleMapMode();
  };

  const toggleFilterAirportBus = () => {
    const next = !filterAirportBus;
    setFilterAirportBus(next);
    localStorage.setItem('app_filter_airport_bus', next.toString());
    setCacheUpdateTick(v => v + 1);

    if (mapInstance) {
      if (activeBusLine) {
        renderBusLine(activeBusLine, (window as any).AMap, mapInstance, true, true, false);
      } else if (selectedSegmentLines?.length && roadOverlaysRef.current.length) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      } else if (roadOverlaysRef.current.length) {
        handleSearch();
      }
    }
  };

  const toggleFilterIntervalBus = () => {
    const next = !filterIntervalBus;
    setFilterIntervalBus(next);
    localStorage.setItem('app_filter_interval_bus', next.toString());
    setCacheUpdateTick(v => v + 1);

    if (mapInstance) {
      if (activeBusLine) {
        renderBusLine(activeBusLine, (window as any).AMap, mapInstance, true, true, false);
      } else if (selectedSegmentLines?.length && roadOverlaysRef.current.length) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      } else if (roadOverlaysRef.current.length) {
        handleSearch();
      }
    }
  };

  const toggleFilterUserSubmissions = () => {
    const next = !filterUserSubmissions;
    setFilterUserSubmissions(next);
    localStorage.setItem('app_filter_user_submissions', next.toString());
    setCacheUpdateTick(v => v + 1);

    // Auto re-aggregate lines if needed
    if (mapInstance) {
      if (activeBusLine) {
        renderBusLine(activeBusLine, (window as any).AMap, mapInstance, true, true, false);
      } else if (selectedSegmentLines?.length && roadOverlaysRef.current.length) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      } else if (roadOverlaysRef.current.length) {
        handleSearch();
      }
    }
  };

  const toggleStationLineStats = () => {
    const next = !stationLineStats;
    setStationLineStats(next);
    stationLineStatsRef.current = next; // Synchronously update ref
    localStorage.setItem('app_station_line_stats', next.toString());

    // Refresh colors across active maps
    setCacheUpdateTick(v => v + 1);
    if (markerGroupRef.current) {
        const overlays = markerGroupRef.current.getOverlays();
        overlays.forEach((o: any) => {
           const ext = o.getExtData ? o.getExtData() : null;
           if (ext && ext.key) {
             const count = stopCountCacheRef.current.get(ext.key) || 0;
             const expectedColor = next ? getStopColor(count, '#3b82f6') : '#3b82f6';
             if (o._opts && o._opts.fillColor !== expectedColor) {
                o.setOptions({ fillColor: expectedColor });
             }
           }
        });
    }
  };

  // --- USER DRAWING OPERATIONS AND ROUTING HANDLERS ---
  const handleCloseLoop = useCallback(() => {
    if (drawnPoints.length < 2) return;
    const AMap = (window as any).AMap;
    if (!AMap) return;

    if (isRoutingRef.current) {
      console.log("路由搜索中，忽略重复点击");
      return;
    }

    const firstPt = drawnPoints[0];
    const lastPt = drawnPoints[drawnPoints.length - 1];

    const p1 = new AMap.LngLat(lastPt.lng, lastPt.lat);
    const p2 = new AMap.LngLat(firstPt.lng, firstPt.lat);
    const dist = AMap.GeometryUtil.distance(p1, p2);
    if (dist < 10) {
      alert('线路已经是闭合的！');
      return;
    }

    if (drawingSubModeRef.current === 'straight') {
      const newPt = {
        id: 'pt_' + Date.now(),
        lng: firstPt.lng,
        lat: firstPt.lat,
        name: firstPt.name || '站点1',
        isStop: true,
        pathFromPrev: [
          { lng: lastPt.lng, lat: lastPt.lat },
          { lng: firstPt.lng, lat: firstPt.lat }
        ]
      };

      const currentSnapshot = drawnPointsRef.current;
      setUndoStack(u => [...u, currentSnapshot]);
      setRedoStack([]);
      setDrawnPoints(curr => [...curr, newPt]);
      setSelectedPointIdx(currentSnapshot.length);
      return;
    }

    isRoutingRef.current = true;
    setLoading(true);
    const driving = new AMap.Driving({
      policy: AMap.DrivingPolicy.LEAST_TIME,
      map: null
    });

    driving.search(p1, p2, (status: string, result: any) => {
      isRoutingRef.current = false;
      setLoading(false);
      if (status === 'complete' && result.routes && result.routes[0]) {
        const pathStepCoordinates: { lng: number, lat: number }[] = [];

        result.routes[0].steps.forEach((step: any) => {
          step.path.forEach((p: any) => {
            const lastPathPt = pathStepCoordinates[pathStepCoordinates.length - 1];
            if (!lastPathPt || lastPathPt.lng !== p.lng || lastPathPt.lat !== p.lat) {
              pathStepCoordinates.push({ lng: p.lng, lat: p.lat });
            }
          });
        });

        if (pathStepCoordinates.length > 0) {
          const snappedStart = pathStepCoordinates[0];
          const snappedEnd = pathStepCoordinates[pathStepCoordinates.length - 1];

          const newPt = {
            id: 'pt_' + Date.now(),
            lng: firstPt.lng,
            lat: firstPt.lat,
            name: firstPt.name || '站点1',
            isStop: true,
            pathFromPrev: pathStepCoordinates
          };

          const currentSnapshot = drawnPointsRef.current;
          setUndoStack(u => [...u, currentSnapshot]);
          setRedoStack([]);

          setDrawnPoints(curr => {
            const updated = [...curr];
            if (updated.length > 0) {
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                lng: snappedStart.lng,
                lat: snappedStart.lat
              };
            }
            return [...updated, newPt];
          });
          setSelectedPointIdx(currentSnapshot.length);
        } else {
          alert('无法在此处闭合，未找到可行路线！');
        }
      } else {
        alert('无法在此处闭合，未找到可行路线！');
      }
    });
  }, [drawnPoints, mapInstance]);

  const handleDrawingMapClick = useCallback((e: any) => {
    const AMap = (window as any).AMap;
    if (!AMap) return;

    if (isRoutingRef.current) {
      console.log("路由搜索中，忽略重复点击");
      return;
    }

    const clickedLngLat = { lng: e.lnglat.lng, lat: e.lnglat.lat };
    const currentPoints = drawnPointsRef.current;

    // 1. First point
    if (currentPoints.length === 0) {
      const firstPt = {
        id: 'pt_' + Date.now(),
        lng: clickedLngLat.lng,
        lat: clickedLngLat.lat,
        name: '站点1',
        isStop: true,
        pathFromPrev: []
      };
      setUndoStack(u => [...u, currentPoints]);
      setRedoStack([]);
      setDrawnPoints([firstPt]);
      setSelectedPointIdx(0);
      return;
    }

    // 2. Subsequent points (no distance limits)
    const lastPt = currentPoints[currentPoints.length - 1];

    if (drawingSubModeRef.current === 'straight') {
      const newPt = {
        id: 'pt_' + Date.now(),
        lng: clickedLngLat.lng,
        lat: clickedLngLat.lat,
        name: '',
        isStop: false,
        pathFromPrev: [
          { lng: lastPt.lng, lat: lastPt.lat },
          { lng: clickedLngLat.lng, lat: clickedLngLat.lat }
        ]
      };
      setUndoStack(u => [...u, currentPoints]);
      setRedoStack([]);
      setDrawnPoints(curr => [...curr, newPt]);
      setSelectedPointIdx(currentPoints.length);
      return;
    }

    const p1 = new AMap.LngLat(lastPt.lng, lastPt.lat);
    const p2 = new AMap.LngLat(clickedLngLat.lng, clickedLngLat.lat);

    isRoutingRef.current = true;
    setLoading(true);
    const driving = new AMap.Driving({
      policy: AMap.DrivingPolicy.LEAST_TIME,
      map: null
    });

    driving.search(p1, p2, (status: string, result: any) => {
      isRoutingRef.current = false;
      setLoading(false);
      if (status === 'complete' && result.routes && result.routes[0]) {
        const pathStepCoordinates: { lng: number, lat: number }[] = [];

        result.routes[0].steps.forEach((step: any) => {
          step.path.forEach((p: any) => {
            const lastPathPt = pathStepCoordinates[pathStepCoordinates.length - 1];
            if (!lastPathPt || lastPathPt.lng !== p.lng || lastPathPt.lat !== p.lat) {
              pathStepCoordinates.push({ lng: p.lng, lat: p.lat });
            }
          });
        });

        if (pathStepCoordinates.length > 0) {
          const snappedStart = pathStepCoordinates[0];
          const snappedEnd = pathStepCoordinates[pathStepCoordinates.length - 1];

          const currentSnapshot = drawnPointsRef.current;

          const newPt = {
            id: 'pt_' + Date.now(),
            lng: snappedEnd.lng,
            lat: snappedEnd.lat,
            name: '',
            isStop: false,
            pathFromPrev: pathStepCoordinates
          };

          setUndoStack(u => [...u, currentSnapshot]);
          setRedoStack([]);

          // Align previous point coordinate to snappedStart and Append newPt at snappedEnd
          setDrawnPoints(curr => {
            const updated = [...curr];
            if (updated.length > 0) {
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                lng: snappedStart.lng,
                lat: snappedStart.lat
              };
            }
            return [...updated, newPt];
          });
          setSelectedPointIdx(currentSnapshot.length);
        } else {
          alert('该路段无法通行或未找到可行路线，无法在此绘制线路！');
        }
      } else {
        alert('该路段无法通行或未找到可行路线，无法在此绘制线路！');
      }
    });
  }, []);

  const handleAddStopAtSelected = () => {
    if (selectedPointIdx === null) return;
    const pt = drawnPoints[selectedPointIdx];
    setNamingStopIdx(selectedPointIdx);

    if (pt.isStop && pt.name) {
      setNamingValue(pt.name);
    } else {
      const currentStopCount = drawnPointsRef.current.filter(p => p.isStop).length;
      setNamingValue(`站点${currentStopCount + 1}`);
    }
  };

  const handleSaveStopName = () => {
    if (namingStopIdx === null) return;
    const value = namingValue.trim();
    if (!value) {
      alert('站点名称不能为空！');
      return;
    }

    setUndoStack(u => [...u, drawnPoints]);
    setRedoStack([]);

    setDrawnPoints(prev => prev.map((pt, idx) => {
      if (idx === namingStopIdx) {
        return {
          ...pt,
          isStop: true,
          name: value
        };
      }
      return pt;
    }));

    setNamingStopIdx(null);
    setNamingValue('');
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(u => u.slice(0, -1));
    setRedoStack(r => [...r, drawnPoints]);
    setDrawnPoints(prev);
    setSelectedPointIdx(prev.length > 0 ? prev.length - 1 : null);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(r => r.slice(0, -1));
    setUndoStack(u => [...u, drawnPoints]);
    setDrawnPoints(next);
    setSelectedPointIdx(next.length > 0 ? next.length - 1 : null);
  };

  const handleOpenSubmitDialog = () => {
    if (drawnPoints.length < 2) return;

    const AMap = (window as any).AMap;
    if (AMap && AMap.Geocoder) {
      const geocoder = new AMap.Geocoder();
      setLoading(true);
      geocoder.getAddress([drawnPoints[0].lng, drawnPoints[0].lat], (status: string, result: any) => {
        setLoading(false);
        if (status === 'complete' && result.regeocode) {
          const ac = result.regeocode.addressComponent;
          setSubmitCity(ac.city || ac.province || currentCity || '未知城市');
          setSubmitDistrict(ac.district || '未知区域');
        } else {
          setSubmitCity(currentCity || '未知城市');
          setSubmitDistrict('');
        }
        setShowSubmitModal(true);
      });
    } else {
      setSubmitCity(currentCity || '未知城市');
      setSubmitDistrict('');
      setShowSubmitModal(true);
    }
  };

  const handleSubmitSubmission = async () => {
    const lineName = submitLineName.trim();
    const nickname = submitUserNickname.trim();

    if (!lineName || !nickname) {
      alert('全部文本字段（线路名称、绘图者昵称）均为必填项！');
      return;
    }

    // Connect sequential nodes to form the full path
    const fullPolyline: { lng: number, lat: number }[] = [];
    drawnPoints.forEach((pt, idx) => {
      if (idx === 0) {
        fullPolyline.push({ lng: pt.lng, lat: pt.lat });
      } else {
        if (pt.pathFromPrev && pt.pathFromPrev.length > 0) {
          pt.pathFromPrev.forEach((p: any) => {
            const last = fullPolyline[fullPolyline.length - 1];
            if (!last || last.lng !== p.lng || last.lat !== p.lat) {
              fullPolyline.push({ lng: p.lng, lat: p.lat });
            }
          });
        }
        fullPolyline.push({ lng: pt.lng, lat: pt.lat });
      }
    });

    const stops = drawnPoints
      .filter(pt => pt.isStop)
      .map(pt => ({
        name: pt.name,
        location: { lng: pt.lng, lat: pt.lat }
      }));

    const submissionId = 'line_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    const submissionData = {
      id: submissionId,
      name: lineName,
      creatorNickname: nickname,
      city: submitCity,
      district: submitDistrict,
      path: fullPolyline,
      via_stops: stops,
      status: 'pending',
      dataSourceText: submitDataSourceText || '',
      dataSourceImage: submitDataSourceImages.length > 0 ? JSON.stringify(submitDataSourceImages) : null,
      timestamp: Date.now()
    };

    // Save locally
    const updatedHistory = [submissionData, ...historicalSubmissions];
    setHistoricalSubmissions(updatedHistory);
    localStorage.setItem('user_drawn_lines_history', JSON.stringify(updatedHistory));

    // Submit to Firebase or Express backend folder
    try {
      setLoading(true);
      if (isFirebaseEnabled()) {
        const result = await submitLineToFirebase(submissionData);
        setLoading(false);
        if (result.success) {
          alert('您的自绘线路已成功通过服务器提交至审核列表中！后续可在“查看历史提交”中跟踪动态审核结果。');
          setDrawnPoints([]);
          setUndoStack([]);
          setRedoStack([]);
          setSelectedPointIdx(null);
          setIsDrawingMode(false);
          setShowSubmitModal(false);
          setSubmitLineName('');
          setSubmitDataSourceText('');
          setSubmitDataSourceImages([]);
          checkSubmissionStatuses(updatedHistory);
        } else {
          alert(`提交失败：${result.error || '无法保存该路线到服务器，请检查网络后重试。'}`);
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/submissions/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submissionData)
        });
        const resData = await res.json();
        setLoading(false);

        if (resData.success) {
          alert('您的自绘线路已成功提交至“审核”文件夹！后续可在“查看历史提交”中查看审核结果状态。');
          setDrawnPoints([]);
          setUndoStack([]);
          setRedoStack([]);
          setSelectedPointIdx(null);
          setIsDrawingMode(false);
          setShowSubmitModal(false);
          setSubmitLineName('');
          setSubmitDataSourceText('');
          setSubmitDataSourceImages([]);
        } else {
          alert('提交失败: ' + (resData.error || '未知错误'));
        }
      }
    } catch (err: any) {
      setLoading(false);
      console.error('Submission error:', err);
      alert('提交失败，无法连接到服务器进行审核提交，请稍后再试。');
    }
  };

  const handleFooterClick = () => {
    const now = Date.now();
    // Use a tighter interval (600ms instead of 800ms) to ensure accidental clicks don't chain easily
    if (now - lastFooterClickTime < 600) {
      const nextCount = footerClickCount + 1;
      if (nextCount >= 3) {
        if (isAdminVerified) {
          setIsAdminVerified(false);
          setAdminSessionToken('');
          setShowAuditModal(false);
          setShowManageModal(false);
          alert('管理员模式已退出！');
        } else {
          setShowAdminLogin(true);
          setAdminPassword('');
        }
        setFooterClickCount(0);
      } else {
        setFooterClickCount(nextCount);
      }
    } else {
      setFooterClickCount(1);
    }
    setLastFooterClickTime(now);
  };

  const handleAdminLoginVerify = async () => {
    try {
      if (!ADMIN_GATEWAY_URL) {
        alert('管理员服务尚未配置，无法验证密钥。');
        return;
      }
      setLoading(true);
      const trimmed = adminPassword.trim();
      const res = await fetch(`${ADMIN_GATEWAY_URL}/admin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmed }),
      });
      setLoading(false);

      if (res.ok) {
        const payload = await res.json();
        if (!payload?.sessionToken) {
          throw new Error('管理员会话创建失败');
        }
        setIsAdminVerified(true);
        setAdminSessionToken(payload.sessionToken);
        setShowAdminLogin(false);
        setAdminPassword('');
        fetchPendingSubmissions(payload.sessionToken);
        alert('安全密码验证成功！管理员模式已激活。');
      } else {
        alert('安全凭据校验失败！请确定输入正确的管理员私钥。');
      }
    } catch (err) {
      setLoading(false);
      console.error(err);
      alert('密码校验异常，无法连接到后台服务器进行验证。');
    }
  };

  const fetchPendingSubmissions = async (customSession?: string) => {
    try {
      const session = customSession || adminSessionToken;
      if (!session) return;

      if (isFirebaseEnabled()) {
        const data = await getPendingSubmissionsFromFirebase(session);
        setPendingSubmissions(data || []);
      } else {
        const res = await fetch(`${API_BASE_URL}/api/admin/pending`, {
          headers: { 'x-admin-session': session }
        });
        const data = await res.json();
        setPendingSubmissions(data || []);
      }
    } catch (err) {
      console.error('Failed to query pending registrations:', err);
    }
  };

  const handleAdminAction = async (id: string, action: 'approve' | 'reject', rejectReason?: string) => {
    try {
      setLoading(true);
      if (isFirebaseEnabled()) {
        const success = await updateSubmissionStatusInFirebase(id, action === 'approve' ? 'approved' : 'rejected', rejectReason, adminSessionToken);
        setLoading(false);
        if (success) {
          alert(action === 'approve' ? '审核通过，已将该线路设置为正式发布状态！所有人现在都可以实时看到了！' : '线路已被拒绝，其退回原因已记录。');
          fetchPendingSubmissions();
          fetchApprovedLines();
          checkSubmissionStatuses(historicalSubmissions);
        } else {
          alert('管理员执行操作发生服务器数据库错误，请检查服务器日志后重试。');
        }
      } else {
        const pathUrl = action === 'approve' ? `${API_BASE_URL}/api/admin/approve` : `${API_BASE_URL}/api/admin/reject`;
        const res = await fetch(pathUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-session': adminSessionToken
          },
          body: JSON.stringify({ id, rejectReason })
        });
        const data = await res.json();
        setLoading(false);

        if (data.success) {
          alert(action === 'approve' ? '审核通过，已将该线路从“审核”文件夹移至正式发布的“用户提交”文件夹！' : '线路已被拒绝，其退回原因已记录。');
          fetchPendingSubmissions();
          fetchApprovedLines();
          checkSubmissionStatuses(historicalSubmissions);
        } else {
          alert('管理员执行操作发生错误: ' + (data.error || '未知错误'));
        }
      }
    } catch (err: any) {
      setLoading(false);
      alert('请求网络发生网络错误: ' + err.message);
    }
  };

  const handleEditApprovedLine = async (id: string, newName: string) => {
    if (!newName.trim()) {
      alert('线路名称不能为空！');
      return;
    }
    try {
      setLoading(true);
      if (isFirebaseEnabled()) {
        const success = await editApprovedLineInFirebase(id, newName.trim(), adminSessionToken);
        setLoading(false);
        if (success) {
          alert('线路名称在云数据库中更新成功！');
          setEditingLineId(null);
          fetchApprovedLines();
        } else {
          alert('修改名称失败：云数据库写入异常。');
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/admin/edit-approved`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-session': adminSessionToken
          },
          body: JSON.stringify({ id, name: newName.trim() })
        });
        const data = await res.json();
        setLoading(false);
        if (data.success) {
          alert('线路名称已更新成功！');
          setEditingLineId(null);
          fetchApprovedLines();
        } else {
          alert('修改名称失败: ' + (data.error || '未知错误'));
        }
      }
    } catch (err: any) {
      setLoading(false);
      console.warn('Backend unavailable, falling back to local edit:', err);
      const localSaved = localStorage.getItem('client_approved_user_lines');
      if (localSaved) {
        try {
          let list = JSON.parse(localSaved);
          list = list.map((item: any) => item.id === id ? { ...item, name: newName.trim() } : item);
          localStorage.setItem('client_approved_user_lines', JSON.stringify(list));

          // Also edit history if it exists
          const histSaved = localStorage.getItem('user_drawn_lines_history');
          if (histSaved) {
            let hist = JSON.parse(histSaved);
            hist = hist.map((item: any) => item.id === id ? { ...item, name: newName.trim() } : item);
            localStorage.setItem('user_drawn_lines_history', JSON.stringify(hist));
            setHistoricalSubmissions(hist);
          }

          alert('【本地修改成功】线路名已在本地缓存中更新！');
          setEditingLineId(null);
          fetchApprovedLines();
        } catch (e) {
          console.error(e);
        }
      } else {
        alert('网络连接错误: ' + err.message);
      }
    }
  };

  const handleDeleteApprovedLine = async (id: string) => {
    try {
      setLoading(true);
      if (isFirebaseEnabled()) {
        const success = await deleteApprovedLineInFirebase(id, adminSessionToken);
        setLoading(false);
        if (success) {
          alert('线路从云数据库中删除成功！');
          setDeletingLineId(null);
          fetchApprovedLines();
          checkSubmissionStatuses(historicalSubmissions);
        } else {
          alert('删除线路失败：云数据库删除操作异常。');
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/admin/delete-approved`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-admin-session': adminSessionToken
          },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        setLoading(false);
        if (data.success) {
          setDeletingLineId(null);
          fetchApprovedLines();
          checkSubmissionStatuses(historicalSubmissions);
        } else {
          alert('删除线路失败: ' + (data.error || '未知错误'));
        }
      }
    } catch (err: any) {
      setLoading(false);
      console.warn('Backend unavailable, falling back to local delete:', err);
      const localSaved = localStorage.getItem('client_approved_user_lines');
      const histSaved = localStorage.getItem('user_drawn_lines_history');

      let deletedFromLocal = false;
      if (localSaved) {
        try {
          let list = JSON.parse(localSaved);
          const initialLength = list.length;
          list = list.filter((item: any) => item.id !== id);
          if (list.length !== initialLength) {
            localStorage.setItem('client_approved_user_lines', JSON.stringify(list));
            deletedFromLocal = true;
          }
        } catch (e) {
          console.error(e);
        }
      }

      if (histSaved) {
        try {
          let hist = JSON.parse(histSaved);
          hist = hist.filter((item: any) => item.id !== id);
          localStorage.setItem('user_drawn_lines_history', JSON.stringify(hist));
          setHistoricalSubmissions(hist);
          deletedFromLocal = true;
        } catch (e) {
          console.error(e);
        }
      }

      if (deletedFromLocal) {
        setDeletingLineId(null);
        fetchApprovedLines();
        checkSubmissionStatuses(historicalSubmissions);
      } else {
        alert('网络连接错误: ' + err.message);
      }
    }
  };

  const handlePreviewLineOnMap = (line: any) => {
    const AMap = (window as any).AMap;
    if (AMap && mapInstance) {
      const lineToRender = {
        ...line,
        isUserSubmitted: true
      };
      renderBusLine(lineToRender, AMap, mapInstance, true, true, true);
    }
  };

  // Synchronize drawn points on active map instance
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;
    const AMap = (window as any).AMap;
    if (!AMap) return;

    if (!drawingGroupRef.current) {
      drawingGroupRef.current = new AMap.OverlayGroup();
      map.add(drawingGroupRef.current);
    }

    drawingGroupRef.current.clearOverlays();

    if (!isDrawingMode) {
      return;
    }

    const polylines: any[] = [];
    drawnPoints.forEach((pt, idx) => {
      if (idx > 0 && pt.pathFromPrev && pt.pathFromPrev.length > 0) {
        const poly = new AMap.Polyline({
          path: pt.pathFromPrev.map((p: any) => [p.lng, p.lat]),
          strokeColor: '#3b82f6',
          strokeWeight: 4,
          strokeOpacity: 0.82,
          lineJoin: 'round',
          lineCap: 'round',
          isOutline: true,
          outlineColor: '#ffffff',
          borderWeight: 1,
          zIndex: 80
        });
        polylines.push(poly);
      }
    });

    const markers: any[] = [];
    drawnPoints.forEach((pt, idx) => {
      const isSelected = selectedPointIdx === idx;

      if (pt.isStop) {
        const nameLabel = pt.name || `未命名站点`;
        const marker = new AMap.Marker({
          position: [pt.lng, pt.lat],
          anchor: 'center',
          offset: new AMap.Pixel(0, 0),
          content: `
            <div class="relative flex items-center justify-center" style="width: 18px; height: 18px;">
              <!-- Absolute centered text label positioned above the station node -->
              <div class="absolute bottom-full mb-1.5 left-1/2 transform -translate-x-1/2 px-2 py-0.5 bg-emerald-600 text-white font-bold text-[9px] rounded-lg shadow-xl whitespace-nowrap border border-emerald-500 z-10">
                ${nameLabel}
              </div>
              <!-- Station Node Circle -->
              <div class="w-4.5 h-4.5 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center justify-center ${isSelected ? 'ring-4 ring-blue-500' : ''}">
                <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
              </div>
            </div>
          `,
          zIndex: 95
        });

        marker.on('click', () => {
          setSelectedPointIdx(idx);
        });

        markers.push(marker);
      } else {
        const marker = new AMap.Marker({
          position: [pt.lng, pt.lat],
          anchor: 'center',
          offset: new AMap.Pixel(0, 0),
          content: `
            <div class="w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white shadow-md flex items-center justify-center cursor-pointer ${isSelected ? 'ring-4 ring-blue-400' : ''}">
              <div class="w-1 h-1 rounded-full bg-white"></div>
            </div>
          `,
          zIndex: 90
        });

        marker.on('click', () => {
          setSelectedPointIdx(idx);
        });

        markers.push(marker);
      }
    });

    drawingGroupRef.current.addOverlays([...polylines, ...markers]);

  }, [drawnPoints, isDrawingMode, selectedPointIdx, mapInstance]);

  const handleClearLineCache = async () => {
    await clearAllLineCache();
    queriedLineNamesRef.current.clear();
    await refreshLineCacheStats();
    setCacheClearedFeedback(true);
    setTimeout(() => setCacheClearedFeedback(false), 2000);
  };

  const toggleLineCache = async () => {
    if (!enableLineCache) {
      setEnableLineCache(true);
      enableLineCacheRef.current = true;
      localStorage.setItem(APP_LINE_CACHE_ENABLED_KEY, 'true');
      await checkAndPurgeIfMonthChanged();
      await refreshLineCacheStats();
    } else {
      setEnableLineCache(false);
      enableLineCacheRef.current = false;
      localStorage.setItem(APP_LINE_CACHE_ENABLED_KEY, 'false');
      await clearAllLineCache();
      queriedLineNamesRef.current.clear();
      await refreshLineCacheStats();
    }
  };

  const handleManualSearch = async (item: any) => {
    dismissSearchSuggestions();
    setShowTimeline(false);
    setTimelineAvailable(false);
    const map = mapRef.current;
    if (!map) return;
    isClearedRef.current = false;
    const version = ++searchVersionRef.current;
    const AMap = (window as any).AMap;
    clearPriorityCoverage();
    mapPointVersionRef.current++;
    setShowSuggestions(false);
    setSearchQuery(item.name);
    if (item.type === 'busline' || checkIsLineQuery(item.name)) {
      setTopCard('line');
    }

    // Intercept search for approved user custom lines
    const isFilteredOut = localStorage.getItem('app_filter_user_submissions') === 'true';
    const userLine = (showUserSubmittedData && !isFilteredOut && !item.sourceCity) ? approvedUserLines.find(ul => ul.name === item.name || ul.id === item.id) : null;
    if (userLine) {
      setTopCard('line');
      const formattedLine = {
         ...userLine,
         isUserSubmitted: true
      };
      setActiveBusLine(formattedLine);
      renderBusLine(formattedLine, AMap, map);
      if (userLine.path && userLine.path[0]) {
        map.setCenter([userLine.path[0].lng, userLine.path[0].lat]);
        map.setZoom(14);
      }
      return;
    }

    const isActuallyLine = item.type === 'busline' || checkIsLineQuery(item.name);

    if (isActuallyLine) {
      if (item.sourceCity) {
        const dataset = await cityDataCache.get(item.sourceCity).catch(() => null);
        if (version !== searchVersionRef.current || map !== mapRef.current || isMinigameActiveRef.current) return;
        const saved = dataset?.lines.find(line => item.routeId && line.id === item.routeId)
          || dataset?.lines.find(line => line.name === item.name)
          || dataset?.lines.find(line => matchesReturnedLine(item.name, line));
        if (saved) { renderBusLine(saved, AMap, map); return; }
      }
      const cached = !item.adcode ? fetchedLinesCache.current.get(item.name) : undefined;
      const line = item.lineData || (cached?.city?.replace(/市$/, '') === currentCity.replace(/市$/, '') ? cached : undefined);
      if (line) {
        renderBusLine(line, AMap, map);
        return;
      }

      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: item.adcode || item.sourceCity || currentCity || '全国',
        pageSize: 1,
        extensions: 'all'
      });

      setLoading(true);
      const { name: shortName } = parseLineInfo(item.name);

      const timeout = setTimeout(() => setLoading(false), 10000);

      lineSearch.search(shortName, (status: string, result: any) => {
        clearTimeout(timeout);
        setLoading(false);
        if (version !== searchVersionRef.current || map !== mapRef.current || isMinigameActiveRef.current) return;
        if (checkAmapQuotaError(status, result)) return;
        if (result && result.lineInfo) {
          result.lineInfo = result.lineInfo.filter((l: any) => !isLineNameBlockedRef(l.name));
        }
        if (status === 'complete' && result.lineInfo && result.lineInfo.length > 0) {
          let targetLine = result.lineInfo[0];
          const exactMatch = result.lineInfo.find((l: any) => l.name === item.name);
          if (exactMatch) {
            targetLine = exactMatch;
          } else if (item.name.includes('(')) {
            const match = item.name.match(/\((.+?)[-]+(.+?)\)/);
            if (match) {
              const start = match[1];
              const end = match[2];
              const found = result.lineInfo.find((l: any) => l.name.includes(start) && l.name.includes(end));
              if (found) targetLine = found;
            }
          }
          renderBusLine({ ...targetLine, city: item.sourceCity || currentCity }, AMap, map);
        }
      });
    } else if (item.location) {
      const itemLatLng = getLatLng(item.location);
      map.setCenter(itemLatLng);
      map.setZoom(17);
      setSelectionPos(itemLatLng);

      const cleanItemName = item.name.replace(/\(.*?\)|（.*?）/g, '').replace(/\s*-\s*\d+$/, '').trim();

      setSelectedStop({
        name: cleanItemName,
        address: t('loadingDetails'),
        lines: [],
        city: currentCity
      });

      // Try to fetch more details (lines)
      const details = await fetchStopDetails(cleanItemName, itemLatLng, AMap, currentCity);
      if (details) {
        setSelectedStop({ ...details, city: currentCity });
      } else {
        const isTransitPOI = item.type && (item.type.includes('公交') || item.type.includes('车站') || item.type.includes('交通设施') || item.type.includes('地铁'));
        let lines: string[] = [];

        if (isTransitPOI) {
           lines = (item.address || '').split(/[;；]/).map((s: string) => s.trim()).filter((s: string) =>
             s.length > 0 && !isLineNameBlockedRef(s)
           ).filter(isValidBusLineName);
        }

        setSelectedStop({
          name: cleanItemName,
          address: item.address,
          lines: lines,
          city: currentCity,
          isBusStop: !!isTransitPOI
        });
      }
    } else {
      // Fallback for tips without exact location: search by name
      const ps = new AMap.PlaceSearch({
        city: item.adcode || item.sourceCity || currentCity || '全国',
        pageSize: 1
      });
      ps.search(item.name, (status: string, result: any) => {
        if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
          handleManualSearch(result.poiList.pois[0]);
        }
      });
    }
  };


  const findLoadedLines = (query: string) => [...fetchedLinesCache.current.values()].filter(line =>
    line.city?.replace(/市$/, '') === currentCity.replace(/市$/, '')
    && matchesLineQuery(query, line.name) && !isLineNameBlockedRef(line.name));

  const onSearchInputChange = (val: string) => {
    const currentSearchId = ++searchIdRef.current;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchQuery(val);
    if (searchComposingRef.current) return;
    searchActiveRef.current = true;
    setSuggestionsLoading(!!val.trim());
    setShowSuggestions(!!val.trim());
    setSuggestions([]);
    if (!val.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const AMap = (window as any).AMap;
    if (!AMap || !AMap.AutoComplete) { setSuggestionsLoading(false); return; }

    searchDebounceRef.current = setTimeout(() => {
    if (currentSearchId !== searchIdRef.current || !searchActiveRef.current) return;
    if (!autoCompleteRef.current) {
      autoCompleteRef.current = new AMap.AutoComplete({
        city: currentCity || '全国',
        citylimit: false
      });
    }

    // Parallel search for better results
    const fetchTips = new Promise<any[]>((resolve) => {
      const timeout = setTimeout(() => resolve([]), 8000);
      autoCompleteRef.current.search(val, (status: string, result: any) => {
        clearTimeout(timeout);
        checkAmapQuotaError(status, result);
        if (status === 'complete' && result.tips) {
          resolve(result.tips);
        } else {
          resolve([]);
        }
      });
    });

    const isLineQuery = checkIsLineQuery(val);
    const loadedLines = isLineQuery ? findLoadedLines(val) : [];
    const fetchLines = loadedLines.length ? Promise.resolve(loadedLines.map(line => ({
      name: line.name, district: line.city, location: line.path[0], type: 'busline', lineData: line,
    }))) : isLineQuery ? new Promise<any[]>((resolve) => {
      if (!AMap.LineSearch) { resolve([]); return; }
      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: currentCity || '全国',
        pageSize: 10,
        extensions: 'all'
      });
      const timeout = setTimeout(() => resolve([]), 8000);
      lineSearch.search(val, (status: string, result: any) => {
        clearTimeout(timeout);
        checkAmapQuotaError(status, result);
        if (result?.lineInfo) {
          result.lineInfo = result.lineInfo.filter((l: any) => !isLineNameBlockedRef(l.name));
        }
        if (status === 'complete' && result?.lineInfo) {
          resolve(result.lineInfo.map((l: any) => ({
            name: l.name,
            district: l.city || currentCity,
            location: l.path[0],
            type: 'busline',
            lineData: l
          })));
        } else {
          resolve([]);
        }
      });
    }) : Promise.resolve([]);

    Promise.all([fetchTips, fetchLines]).then(([tips, lines]) => {
      if (currentSearchId !== searchIdRef.current || !searchActiveRef.current) return;

      // Prioritize exact line matches, then other lines, then POIs with locations
      const combined = [...lines];

      const stationGroups = new Map<string, any[]>();
      const otherTips: any[] = [];

      tips.forEach((tip: any) => {
        // High fidelity station detection
        const isStation = getSuggestionKind(tip) === 'station';

        const isLine = !isStation && checkIsLineQuery(tip.name);

        if (isLine) {
           if (!combined.some(c => c.name.startsWith(tip.name))) {
             combined.push({ ...tip, type: 'busline' });
           }
        } else if (tip.location && isStation) {
           const cleanName = tip.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').trim();
           if (!stationGroups.has(cleanName)) {
             stationGroups.set(cleanName, []);
           }
           stationGroups.get(cleanName)!.push({ ...tip, type: 'busstop' });
        } else if (tip.location) {
           otherTips.push(tip);
        }
      });

      Array.from(stationGroups.entries()).forEach(([cleanName, groupTips]) => {
         if (groupTips.length > 1) {
             // 1. Calculate centroid for the aggregated "All platforms" tip
             let sumLng = 0, sumLat = 0;
             groupTips.forEach(t => { sumLng += parseFloat(t.location.lng); sumLat += parseFloat(t.location.lat); });
             const centroid = { lng: sumLng / groupTips.length, lat: sumLat / groupTips.length };

             // The aggregated button
             combined.push({
                 ...groupTips[0],
                 name: `${cleanName} (所有站台)`,
                 location: centroid,
                 isAggregated: true
             });

             // Number the different platforms
             groupTips.forEach((t, idx) => {
                 combined.push({
                     ...t,
                     name: `${t.name} - ${idx + 1}`
                 });
             });
         } else {
             combined.push(groupTips[0]);
         }
      });

      otherTips.forEach(t => combined.push(t));

      // Include approved user custom lines matching description
      const q = val.toLowerCase().trim();
      const isFilteredOut = localStorage.getItem('app_filter_user_submissions') === 'true';
      if (showUserSubmittedData && q.length > 0 && !isFilteredOut) {
        approvedUserLines.forEach(ul => {
          if (ul.name.toLowerCase().includes(q)) {
            // Avoid duplicate additions
            if (!combined.some(c => c.name === ul.name)) {
              combined.unshift({
                name: ul.name,
                type: 'userLine',
                isUserSubmitted: true,
                 id: ul.id,
                 creatorNickname: ul.creatorNickname,
                location: ul.path[0] ? { lng: ul.path[0].lng, lat: ul.path[0].lat } : null
              });
            }
          }
        });
      }

      setSuggestions(rankSearchSuggestions(combined, val).slice(0, 12));
      setSuggestionsLoading(false);
      setShowSuggestions(true);
    }).catch(() => {
      if (currentSearchId === searchIdRef.current && searchActiveRef.current) setSuggestionsLoading(false);
    });
    }, 220);
  };

  const performFullSearch = async (query: string) => {
    dismissSearchSuggestions();
    if (!query) return;
    isClearedRef.current = false;
    searchVersionRef.current++;
    setShowSuggestions(false);
    setLoading(true);

    const AMap = (window as any).AMap;
    if (!AMap) {
      setLoading(false);
      return;
    }
    const isLineQuery = checkIsLineQuery(query);

    // 1. Try Line Search first if it looks like a line
    if (isLineQuery) {
      const loaded = findLoadedLines(query)[0];
      if (loaded) {
        renderBusLine(loaded, AMap, mapRef.current);
        setLoading(false);
        return;
      }
      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: currentCity || '全国',
        pageSize: 1,
        extensions: 'all'
      });

      const status = await new Promise<string>((resolve) => {
        const timeout = setTimeout(() => resolve('fail'), 10000);
        lineSearch.search(query, (s: string, result: any) => {
          clearTimeout(timeout);
          checkAmapQuotaError(s, result);
          if (result && result.lineInfo) {
            result.lineInfo = result.lineInfo.filter((l: any) => !isLineNameBlockedRef(l.name));
          }
          if (s === 'complete' && result.lineInfo && result.lineInfo.length > 0) {
            renderBusLine(result.lineInfo[0], AMap, mapRef.current);
            resolve('done');
          } else {
            resolve('fail');
          }
        });
      });
      if (status === 'done' || status === 'fail') {
        if (status === 'done') {
          setLoading(false);
          return;
        }
      }
    }

    // 2. Fallback to Place Search
    const ps = new AMap.PlaceSearch({
      city: currentCity || '全国',
      pageSize: 1,
      extensions: 'all'
    });

    ps.search(query, (status: string, result: any) => {
      setLoading(false);
      if (checkAmapQuotaError(status, result)) return;
      if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
        handleManualSearch(result.poiList.pois[0]);
      }
    });
  };

  const [containerPos, setContainerPos] = useState<{ x: number, y: number } | null>(null);

  const updatePopupPos = useCallback(() => {
    const map = mapRef.current;
    if (map && selectionPos) {
      const pixel = map.lngLatToContainer(selectionPos);
      setContainerPos({ x: pixel.getX(), y: pixel.getY() });
    }
  }, [selectionPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && selectionPos) {
      updatePopupPos();
      map.on('mapmove', updatePopupPos);
      map.on('zoomchange', updatePopupPos);
      return () => {
        map.off('mapmove', updatePopupPos);
        map.off('zoomchange', updatePopupPos);
      };
    }
  }, [selectionPos, updatePopupPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !(window as any).AMap) return;

    if (!geocoderRef.current) {
      geocoderRef.current = new (window as any).AMap.Geocoder({
        radius: 200,
        extensions: 'all'
      });
    }

    if (selectionPos) {
      let count = 0;
      if (selectedStop && selectedStop.lines) {
        count = selectedStop.lines.length;
      }
      const pinColor = getStopColor(count, '#ef4444');
      const content = `
        <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: flex-end; justify-content: center;">
          <div style="position: absolute; width: 24px; height: 24px; background: ${pinColor}; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${pinColor}66; border: 2.5px solid white; margin-bottom: 12px;">
            <div style="width: 8px; height: 8px; background: white; border-radius: 50%; transform: rotate(45deg);"></div>
          </div>
          <div style="width: 14px; height: 6px; background: rgba(0,0,0,0.15); border-radius: 50%; filter: blur(2px);"></div>
        </div>
      `;

      if (!selectionMarkerRef.current) {
        selectionMarkerRef.current = new (window as any).AMap.Marker({
          position: selectionPos,
          content: content,
          offset: new (window as any).AMap.Pixel(-20, -40),
          zIndex: 100
        });

        selectionMarkerRef.current.setMap(map);
      } else {
        selectionMarkerRef.current.setContent(content);
        selectionMarkerRef.current.setPosition(selectionPos);
      }
    } else {
      if (selectionMarkerRef.current) {
        map.remove(selectionMarkerRef.current);
        selectionMarkerRef.current = null;
      }
    }
  }, [selectionPos, selectedStop, stationLineStats, getStopColor]);

  useEffect(() => {
    let map: any;
    let watchdogTimer: any = null;

    AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.PlaceSearch', 'AMap.LineSearch', 'AMap.StationSearch', 'AMap.DistrictSearch', 'AMap.Scale', 'AMap.ToolBar', 'AMap.Geocoder', 'AMap.AutoComplete', 'AMap.Geolocation', 'AMap.Driving', 'AMap.Walking', 'AMap.Transfer'],
    }).then((AMap) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      const savedCenter = localStorage.getItem('map_center');
      let initialCenter = [116.331398, 39.717646];
      if (savedCenter) {
        try {
          initialCenter = JSON.parse(savedCenter);
          if (!Array.isArray(initialCenter) || initialCenter.length < 2) {
            initialCenter = [116.331398, 39.717646];
          }
        } catch (e) {
          console.error('Invalid saved map center', e);
        }
      }
      const savedZoom = localStorage.getItem('map_zoom');
      const initialZoom = savedZoom ? parseFloat(savedZoom) : zoomLevel;

      map = new AMap.Map(containerRef.current, {
        center: initialCenter, 
        zoom: initialZoom,
        viewMode: '2D',
        mapStyle: 'amap://styles/light', 
        features: ['bg', 'point', 'road', 'building'],
        lang: 'zh_cn'
      });

      mapRef.current = map;
      setMapInstance(map);

      let cityLookupVersion = 0;
      const updateMapCity = () => {
        const version = ++cityLookupVersion;
        map.getCity((result: any) => {
          if (mapRef.current !== map || version !== cityLookupVersion) return;
          const city = resolveSearchCity(result);
          if (city) setCurrentCity(city);
        });
      };
      updateMapCity();
      // Initialize groups for high performance clearing/adding
      markerGroupRef.current = new AMap.OverlayGroup();
      lineGroupRef.current = new AMap.OverlayGroup();
      priorityCoverageRef.current = new AMap.OverlayGroup();
      map.add([markerGroupRef.current, lineGroupRef.current, priorityCoverageRef.current]);

      setLoading(false);

      const saveMapState = () => {
        if (!map) return;
        const center = map.getCenter();
        const zoom = map.getZoom();
        localStorage.setItem('map_center', JSON.stringify([center.lng, center.lat]));
        localStorage.setItem('map_zoom', zoom.toString());
      };

      map.on('moveend', () => {
        syncVisibleStopsRef.current();
        updateMapCity();
        saveMapState();
      });

      map.on('zoomend', () => {
        syncVisibleStopsRef.current();
        const newZoom = map.getZoom();
        setZoomLevel((prevZoom) => {
          return newZoom;
        });
        saveMapState();
      });

      const defaultClickHandler = (e: any) => {
        if (isMinigameActiveRef.current) return;
        if (isDrawingModeRef.current) {
          handleDrawingMapClick(e);
          return;
        }
        const version = ++mapPointVersionRef.current;
        const [lng, lat] = [e.lnglat.getLng(), e.lnglat.getLat()];
        if (pickPlannerMapStop([lng, lat], map)) return;
        if (map.getZoom() >= CITY_DETAIL_ZOOM && pickViewportRef.current([lng, lat])) return;
        if (map.getZoom() < 14) return;

        const geocoder = new AMap.Geocoder();
        geocoder.getAddress([lng, lat], (status: string, result: any) => {
          if (version !== mapPointVersionRef.current || map !== mapRef.current) return;
          if (status === 'complete' && result.info === 'OK') {
            const regeocode = result.regeocode;
            const pois = regeocode.pois || [];

            // Build the precise locality string
            const comp = regeocode.addressComponent;
            const preciseLocation = [
              comp.province,
              comp.city !== comp.province ? comp.city : '',
              comp.district,
              comp.township
            ].filter(Boolean).join('');

            const busStop = pois.find((p: any) => p.type.includes('公交车站'));

            if (busStop) {
              const stopPos = getLatLng(busStop.location);
              setSelectionPos(stopPos);
              setSelectedSegmentName(null);
              setSelectedSegmentLines(null);

              const initialLines = (busStop.address || '').split(/[;；]/).map((s: string) => s.trim()).filter((s: string) =>
                s.length > 0 && !isLineNameBlockedRef(s)
              ).filter(isValidBusLineName);

              setSelectedStop({
                name: busStop.name,
                location: busStop.location,
                address: preciseLocation || busStop.address,
                lines: initialLines,
                city: currentCity,
                isBusStop: true
              });

              // Fetch details async to get full correctness
              fetchStopDetails(busStop.name, stopPos as [number, number], AMap, currentCity).then((details: any) => {
                if (details && version === mapPointVersionRef.current && map === mapRef.current) {
                  setSelectedStop((prev: any) => {
                    if (prev && prev.name === busStop.name) {
                      // Apply interval filters to loaded lines as well
                      const filteredLoaded = (details.lines || []).filter((l: string) => !isLineNameBlockedRef(l));
                      const mergedLines = Array.from(new Set([...(prev.lines || []), ...filteredLoaded]));
                      return { ...prev, ...details, lines: mergedLines, city: currentCity };
                    }
                    return prev;
                  });
                }
              });
            } else {
              // Clicked elsewhere, set selection but check if it's a road
              setSelectionPos([lng, lat]);
              setSelectedSegmentName(null);
              setSelectedSegmentLines(null);

              const nearestRoad = regeocode.roads && regeocode.roads.length > 0 ? regeocode.roads[0].name : '';
              const genericPoi = pois.length > 0 ? pois[0].name : '当前位置';
              const displayName = nearestRoad || genericPoi;

              setSelectedStop({
                name: displayName,
                location: { lng, lat },
                address: preciseLocation || regeocode.formattedAddress,
                lines: [],
                city: currentCity,
                isBusStop: false
              });
            }
          }
        });
      };

      defaultMapClickHandlerRef.current = defaultClickHandler;
      mapClickHandlerRef.current = defaultClickHandler;
      map.on('click', defaultClickHandler);
    }).catch(e => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      console.error('AMapLoader load error:', e);
      setLoading(false);
      setApiErrorNotification('公共高德地图服务暂时不可用，请稍后刷新。');
    });

    return () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (map) {
        if (satelliteLayerRef.current) {
          try { satelliteLayerRef.current.setMap(null); } catch (e) {}
          satelliteLayerRef.current = null;
        }
        if (roadNetLayerRef.current) {
          try { roadNetLayerRef.current.setMap(null); } catch (e) {}
          roadNetLayerRef.current = null;
        }
        if (mapClickHandlerRef.current) map.off('click', mapClickHandlerRef.current);
        roadViewportCleanupRef.current?.();
        timelineOverlaysRef.current.forEach(entry => (entry.overlay as any).destroy?.());
        timelineOverlaysRef.current = [];
        map.destroy();
      }
    };
  }, []);

  // Controlling visibility of station markers


  useEffect(() => {
    if (mapInstance && (window as any).AMap) syncStopMarkersToMap(mapInstance, (window as any).AMap);
  }, [showStations, mapInstance]);

  // Initial markers search if stations are shown on load could be handled here or just wait for map click/search button
  // Removing the effect that called handleSearch on showStations toggle

  // Recover selected stop and lines if map recreates
  useEffect(() => {
    if (mapInstance && selectedStop) {
      // Normalize location: could be {lng, lat} or selectionPos [lng, lat]
      const pos = selectedStop.location ? 
        (Array.isArray(selectedStop.location) ? { lng: selectedStop.location[0], lat: selectedStop.location[1] } : selectedStop.location) : 
        (selectionPos ? { lng: selectionPos[0], lat: selectionPos[1] } : null);

      if (pos) {
        onStopClick({
          name: selectedStop.name,
          location: pos,
          address: selectedStop.address
        });
      }
    }
  }, [mapInstance]);

  // Handle Base Map Visibility and Satellite Layer
  useEffect(() => {
    if (!mapInstance) return;
    try {
      const AMap = (window as any).AMap;
      const layers = mapInstance.getLayers();

      if (AMap && AMap.TileLayer) {
        if (!satelliteLayerRef.current && AMap.TileLayer.Satellite) {
          satelliteLayerRef.current = new AMap.TileLayer.Satellite({ zIndex: 1 });
        }
        if (!roadNetLayerRef.current && AMap.TileLayer.RoadNet) {
          roadNetLayerRef.current = new AMap.TileLayer.RoadNet({ zIndex: 2 });
        }
      }

      const satLayer = satelliteLayerRef.current;
      const roadNetLayer = roadNetLayerRef.current;

      if (!showBaseMap) {
        // Completely hidden: hide satellite, hide vector tiles
        if (satLayer) {
          try { satLayer.setMap(null); } catch (e) {}
        }
        if (roadNetLayer) {
          try { roadNetLayer.setMap(null); } catch (e) {}
        }
        if (layers[0]) layers[0].setOpacity(0);
        mapInstance.setFeatures([]);
        mapInstance.setMapStyle('amap://styles/whitesmoke');
      } else if (useSatelliteMap) {
        // Satellite mode: show satellite and roadnet layers
        if (layers[0]) layers[0].setOpacity(0);
        mapInstance.setFeatures([]);
        if (satLayer) {
          try { satLayer.setMap(mapInstance); } catch (e) {}
        }
        if (roadNetLayer) {
          try { roadNetLayer.setMap(mapInstance); } catch (e) {}
        }
      } else {
        // Standard vector base map
        if (satLayer) {
          try { satLayer.setMap(null); } catch (e) {}
        }
        if (roadNetLayer) {
          try { roadNetLayer.setMap(null); } catch (e) {}
        }
        if (layers[0]) layers[0].setOpacity(1);
        mapInstance.setFeatures(['bg', 'point', 'road', 'building']);
        mapInstance.setMapStyle('amap://styles/light');
      }
    } catch (e) {
      // Ignore errors if map is being destroyed
    }
  }, [showBaseMap, useSatelliteMap, mapInstance]);

  const handleSearch = async (forceRefresh = false, sharedOverride?: CityDataset) => {
    // Shared loads are lower priority than a local result or its submission dialog.
    if (sharedOverride) {
      if (pendingCityUploadRef.current || cityUploadBusy || manualResultCityRef.current === sharedOverride.city.replace(/市$/, '')) return;
      manualResultCityRef.current = '';
    }
    setCityDataNotice(null);
    const filtersAtStart = filterIntervalBusRef.current || filterAirportBusRef.current || blockedKeywordsRef.current.length > 0;
    const filterVersionAtStart = searchFilterVersionRef.current;
    sharedMapDataRef.current = false;
    clearPriorityCoverage();
    roadLookupVersionRef.current++;
    setShowTimeline(false);
    setTimelineAvailable(false);
    const map = mapRef.current;
    if (!map) return;

    isClearedRef.current = false;
    const thisSearchVer = ++searchVersionRef.current;


    setFilterTerminalOnly(false);
    filterTerminalOnlyRef.current = false;

    const currentZoom = map.getZoom();
    if (!enableCityWideSearch && currentZoom < 12) {
      return;
    }

    setAIRegionContext(null);
    setPendingCityUpload(null);
    setCityUploadError('');
    setShowEmptySearchNotice(false);
    const searchStartedAt = performance.now();

    setSearchActivity(sharedOverride?'auto':'manual');
    setSearchProgress({value:5,label:'正在确认检索范围…'});
    setIsSearching(true);
    setSharedCityStatus(sharedCityDataEnabled ? '正在检查共享城市线路…' : '');
    try {
      const AMap = (window as any).AMap;
      let searchServices:any = AMap;

      const center = map.getCenter();
      let currentCity = sharedOverride?.city || '';
      let currentDistrict = '';

      try {
        if (!currentCity) {
        const geocoder = new AMap.Geocoder();
        const addressResult: any = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 8000);
          geocoder.getAddress(center, (status: string, result: any) => {
            clearTimeout(timer);
            resolve(status === 'complete' ? result : null);
          });
        });
        if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) return;
        const address = addressResult?.regeocode?.addressComponent;
        currentCity = resolveSearchCity(address);
        currentDistrict = typeof address?.adcode === 'string' ? address.adcode : '';
        }
      } catch (e) {
        console.warn('City detection failed', e);
      }

      if (!currentCity) {
        setIsSearching(false);
        alert('无法确认地图中心所属城市，请稍后重试。');
        return;
      }

      setCurrentCity(currentCity);
      setSearchProgress({value:12,label:`正在准备${currentCity}检索…`});
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const boundCenter = bounds.getCenter();

      const lngDiff = ne.lng - sw.lng;
      const latDiff = ne.lat - sw.lat;

      const expandedBounds = new AMap.Bounds(
        [boundCenter.lng - lngDiff * 5.0, boundCenter.lat - latDiff * 5.0],
        [boundCenter.lng + lngDiff * 5.0, boundCenter.lat + latDiff * 5.0]
      );

      const targetSearchBox: GeoBox = {
        minLng: boundCenter.lng - lngDiff * 5.0,
        maxLng: boundCenter.lng + lngDiff * 5.0,
        minLat: boundCenter.lat - latDiff * 5.0,
        maxLat: boundCenter.lat + latDiff * 5.0,
      };

      if (lastSearchCityRef.current && lastSearchCityRef.current !== currentCity) {
        for (const [k, v] of fetchedLinesCache.current.entries()) {
          if (!v?.isUserSubmitted) {
            fetchedLinesCache.current.delete(k);
          }
        }
        queriedLineNamesRef.current.clear();
      }
      lastSearchCityRef.current = currentCity;

      let allPois: any[] = [];
      let usedRegionCache = false;
      let wasTruncated = false;
      let usedSharedCity = false;
      let refreshLineData = forceRefresh;

      if (enableLineCacheRef.current) {
        const cityCache = await getCityCacheData(currentCity);
        if (cityCache.purged) {
          for (const [k, v] of fetchedLinesCache.current.entries()) {
            if (!v?.isUserSubmitted) {
              fetchedLinesCache.current.delete(k);
            }
          }
          queriedLineNamesRef.current.clear();
          refreshLineCacheStats();
        }
        if (cityCache.lines.length > 0) {
          cityCache.lines.forEach((cachedLine) => {
            const existing = fetchedLinesCache.current.get(cachedLine.name);
            if (!existing || !existing.isUserSubmitted) {
              fetchedLinesCache.current.set(cachedLine.name, cachedLine);
            }
          });
          cachedLinesVersionRef.current++;
          updateTerminalNamesCache();
        }
        cityCache.queriedNames.forEach((qn) => {
          queriedLineNamesRef.current.add(`${currentCity}::${qn}`);
        });

        if (!forceRefresh && cityCache.regions.length > 0 && isSearchScopeCached(cityCache.regions, targetSearchBox, enableCityWideSearch)) {
          const matchedStops = enableCityWideSearch
            ? cityCache.stops
            : cityCache.stops.filter((s) =>
                s.location &&
                s.location.lng >= targetSearchBox.minLng &&
                s.location.lng <= targetSearchBox.maxLng &&
                s.location.lat >= targetSearchBox.minLat &&
                s.location.lat <= targetSearchBox.maxLat
              );
          if (matchedStops.length > 0) {
            allPois = matchedStops;
            usedRegionCache = true;
          }
        }
      }

      let sharedDataset = sharedOverride;
      if (!sharedDataset && (forceRefresh || manualResultCityRef.current !== currentCity.replace(/市$/, ''))) {
        // The overview is the authoritative index of published snapshots.  A missing
        // city is expected to fall through to local collection, not request a
        // non-existent latest.json first.
        const known = await loadPublishedCities().then(
          cities => cities.some(entry => entry.city.replace(/市$/, '') === currentCity.replace(/市$/, '')),
          // If the index is temporarily unavailable, retain the direct read so an
          // existing city remains usable and the read path can report its own error.
          () => true,
        );
        if (known) sharedDataset = await loadSharedCity(currentCity);
      }
      if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) return;
      if (sharedDataset) {
        if (!forceRefresh && (citySnapshotFresh(sharedDataset) || (actionsCityUpdatesEnabled && citySnapshotPreviewable(sharedDataset)))) {
          for (const [name, line] of fetchedLinesCache.current) if (!line.isUserSubmitted) fetchedLinesCache.current.delete(name);
        }
        sharedDataset.lines.forEach(line => {
          if (!isLineNameBlockedRef(line.name) && (!filterIntervalBusRef.current || !line.name.includes('区间'))) fetchedLinesCache.current.set(line.name, line);
        });
        cachedLinesVersionRef.current++;
        updateTerminalNamesCache();
        if (!forceRefresh && (citySnapshotFresh(sharedDataset) || (actionsCityUpdatesEnabled && citySnapshotPreviewable(sharedDataset)))) {
          allPois = sharedDataset.stops;
          usedRegionCache = true;
          usedSharedCity = true;
          sharedMapDataRef.current = true;
          cityDataCache.remember(sharedDataset);
          setLastCityDataset(sharedDataset);
          const message = sharedDataset.retrievalComplete
            ? `已读取共享线路 · ${new Date(sharedDataset.capturedAt).toLocaleDateString('zh-CN')}`
            : `已读取部分共享线路 · ${sharedDataset.lines.length} 个线路方向`;
          setSharedCityStatus(message);
          setCityUpdateJob(sharedDataset.retrievalComplete ? null : {city:sharedDataset.city,state:'retained',message});
        } else {
          // Stale snapshots can seed line data, but must not suppress live POI discovery.
          usedRegionCache = false;
          refreshLineData = true;
          setSharedCityStatus('共享线路需要更新，正在重新检索。');
        }
      } else if (sharedCityDataEnabled) {
        setSharedCityStatus('暂无可用共享线路，正在检索。');
      }

      // Shared data stays readable without visitor credentials; live city discovery must use their SDK key.
      if (!usedSharedCity) {
        const apiStatus = citySearchApiStatus(useCustomApiKey, customApiKey, customApiSecurityCode);
        if (apiStatus !== 'ready') {
          const message = '此城市需要重新检索，请先填写您自己的高德 Web端 API Key 和 Security Code。';
          setSharedCityStatus(message);
          setApiErrorNotification(message);
          focusCustomApiRef.current = true;
          setUseCustomApiKey(true);
          setSettingsTab('general');
          setShowSettings(true);
          return;
        }
      }

      if (!usedSharedCity) {
        searchServices = await getCitySearchServices(customApiKey, customApiSecurityCode);
        if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) return;
      }

      // Remote availability never gates a local search. No upload starts before explicit confirmation.
      if (!usedSharedCity) {
        manualResultCityRef.current = currentCity.replace(/市$/, '');
        cityJobWatchRef.current?.abort();
        setCityUpdateJob(null);
        setCityDataNotice(null);
      }

      if (!usedRegionCache && enableCityWideSearch) {
        setSearchProgress({value:18,label:'正在分区发现公交站点…'});
        const discovered = await discoverCityStops(searchServices, currentCity,
          () => searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current,
          checkAmapQuotaError, {
            preferredScope: currentDistrict,
            focusBounds: currentZoom >= CITY_DETAIL_ZOOM ? [sw.lng, sw.lat, ne.lng, ne.lat] : undefined,
          });
        allPois = discovered.pois;
        wasTruncated = !discovered.complete;
        setSearchProgress({value:35,label:`已发现 ${allPois.length} 个站点，正在整理候选线路…`});
      } else if (!usedRegionCache) {
        const placeSearch = new searchServices.PlaceSearch({
          type: '公交车站',
          pageSize: 50,
          city: currentCity,
          pageIndex: 1,
          extensions: 'all',
        });

        let pageIndex = 1;
        const MAX_PAGES = 30;
        let actualFetchedCount = 0;
        const fetchPage = async (page: number): Promise<boolean> => {
          return new Promise((resolve) => {
            let finished = false;
            const timeout = setTimeout(() => { finished = true; wasTruncated = true; resolve(false); }, 10000);
            placeSearch.setPageIndex(page);

            const callback = (status: string, result: any) => {
              if (finished) return;
              finished = true;
              clearTimeout(timeout);
              if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) { resolve(false); return; }
              checkAmapQuotaError(status, result);
              if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
                allPois.push(...result.poiList.pois);
                const totalCount = result.poiList.count || 0;
                actualFetchedCount += result.poiList.pois.length;
                const fetchedCount = actualFetchedCount;
                if (fetchedCount < totalCount && page < MAX_PAGES) {
                  resolve(true); 
                } else {
                  if (fetchedCount < totalCount && page >= MAX_PAGES) {
                    wasTruncated = true;
                  }
                  resolve(false);
                }
              } else {
                if (status !== 'no_data') wasTruncated = true;
                resolve(false);
              }
            };

            placeSearch.searchInBounds('', expandedBounds, callback);
          });
        };

        let hasMore = true;
        while (hasMore && searchVersionRef.current === thisSearchVer && !isClearedRef.current && !isMinigameActiveRef.current) {
          hasMore = await fetchPage(pageIndex);
          if (hasMore) pageIndex++;
        }
      }

      if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) {
        setIsSearching(false);
        return;
      }

      // Fast empty responses can indicate exhausted shared quota. Cached successes
      // and cancelled searches must never produce this notice.
      if (!usedRegionCache && allPois.length === 0 && performance.now() - searchStartedAt < 3000) {
        setShowEmptySearchNotice(true);
      }

      if (allPois.length > 0) {
        const pois = allPois;
        setStats(prev => ({ ...prev, stops: pois.length }));

        // High performance clear
        clearStopMarkerGroup(markerGroupRef.current);
        allMapStopsRef.current.clear();

        const markers: any[] = [];
        pois.forEach((poi: any) => {
          const linesAr = (poi.address || '').split(/[;；]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0 && (!filterIntervalBusRef.current || !s.includes('区间')));
          const key = `${poi.location.lng},${poi.location.lat}`;
          allMapStopsRef.current.set(key, {
            name: poi.name,
            location: poi.location,
            lines: linesAr,
            city: currentCity
          });
          stopCountCacheRef.current.set(key, linesAr.length);

          const origColor = getStopColor(linesAr.length, '#3b82f6');
          const marker = lazyStopMarker(AMap, {
            center: [poi.location.lng, poi.location.lat],
            radius: 8,
            fillColor: origColor,
            strokeColor: '#fff',
            strokeWeight: 2,
            bubble: false,
            zIndex: 30,
            cursor: 'pointer',
            extData: { key, originalColor: origColor, originalRadius: 8 }
          });

          marker.on('click', () => {
            const stopPos: [number, number] = [poi.location.lng, poi.location.lat];
            if (selectPlannerStop({ city: currentCity, name: poi.name, location: stopPos }, linesAr)) return;

            setSelectionPos(stopPos);
            setTopCard('stop');
            setSelectedSegmentLines(null);
            setSelectedSegmentName(null);
            const initialLines = (poi.address || '').split(/[;；]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0 && (!filterIntervalBusRef.current || !s.includes('区间')));
            setSelectedStop({
              name: poi.name,
              address: poi.address,
              lines: initialLines,
              city: currentCity
            });

            // Fetch details async to get the full lines list
            fetchStopDetails(poi.name, stopPos as [number, number], AMap, currentCity).then((details: any) => {
              if (details) {
                setSelectedStop((prev: any) => {
                  if (prev && prev.name === poi.name) {
                    const filteredLoaded = (details.lines || []).filter((l: string) => !isLineNameBlockedRef(l));
                    const mergedLines = Array.from(new Set([...(prev.lines || []), ...filteredLoaded]));
                    return { ...prev, ...details, lines: mergedLines, city: currentCity };
                  }
                  return prev;
                });
              }
            });
          });
          markers.push(marker);
        });

        activeRawMarkersRef.current = markers;
        roadStopMarkersRef.current = markers;
        syncStopMarkersToMap(map, AMap);
        roadStopsDataRef.current = new Map(allMapStopsRef.current);

        const lineNamesSet = new Set<string>();
        const lineScopes = new Map<string, Set<string>>();
        pois.forEach((poi: any) => {
          const linesString = poi.address || '';
          const lines = linesString.split(/[;；]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0 && (!filterIntervalBusRef.current || !s.includes('区间')));
          for (const name of lines) {
            lineNamesSet.add(name);
            if (!poi.searchScope || poi.searchScope === currentCity) continue;
            const key = lineBaseIdentity(name);
            if (!lineScopes.has(key)) lineScopes.set(key, new Set());
            lineScopes.get(key)!.add(poi.searchScope);
          }
        });

        if (!usedSharedCity && enableCityWideSearch && map.getZoom() >= 13) {
          // Cross-check the visible area against transit stations, even when
          // the city POIs came from cache. Keep requests bounded near the user.
          const visibleStops = pois.filter((poi: any) => poi.location && bounds.contains(poi.location))
            .sort((a: any, b: any) =>
              (a.location.lng - center.lng) ** 2 + (a.location.lat - center.lat) ** 2
              - (b.location.lng - center.lng) ** 2 - (b.location.lat - center.lat) ** 2).slice(0, 60);
          const extraNames = await discoverStationLines(searchServices, currentCity, visibleStops,
            () => searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current);
          extraNames.filter(name => !isLineNameBlockedRef(name)).forEach(name => lineNamesSet.add(name));
        }
        if (enableCityWideSearch) {
          for (const line of fetchedLinesCache.current.values()) {
            if (typeof line.city === 'string' && line.city.replace(/市$/, '') === currentCity.replace(/市$/, '') && !line.isUserSubmitted && !isLineNameBlockedRef(line.name)) {
              lineNamesSet.add(line.name);
            }
          }
        }
        if (usedSharedCity) {
          setSearchProgress({value:88,label:'正在加载共享线路…'});
          await aggregateAndVisualize(sharedDataset!.lines.filter(line => !isLineNameBlockedRef(line.name)
            && (!filterIntervalBusRef.current || !line.name.includes('区间'))).map(line => line.name), map, AMap);
        } else {
          const prepareUpload = (complete: boolean) => {
            if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) return;
            if (!complete) wasTruncated = true;
            try {
              const dataset = normalizeCityDataset({ schemaVersion: 1, city: currentCity, scope: 'city',
                coverage: 'observed', capturedAt: new Date().toISOString(), retrievalComplete: !wasTruncated,
                filtered: filtersAtStart || filterVersionAtStart !== searchFilterVersionRef.current
                  || filterIntervalBusRef.current || filterAirportBusRef.current || blockedKeywordsRef.current.length > 0,
                stops: pois,
                lines: [...fetchedLinesCache.current.values()].filter(line => !line.isUserSubmitted
                  && (!line.city || line.city.replace(/市$/, '') === currentCity.replace(/市$/, ''))),
              });
              setLastCityDataset(dataset);
              if (dataset.filtered) setSharedCityStatus('本次开启了线路过滤，仅在本地展示，不发布为全市共享数据。');
              else {
                setSharedCityStatus(dataset.retrievalComplete ? '本地检索完成；尚未提交到远端。' : '本次检索取得部分线路；尚未提交到远端。');
                setCityUploadError('');
                setCityUploadProgress(0);
                setPendingCityUpload(dataset);
              }
            } catch {
              setSharedCityStatus('本次检索结果未通过快照校验，无法提交；已获得的线路仍可在本地查看。');
            }
          };
          const linesComplete = await fetchAndDrawLines(Array.from(lineNamesSet), map, AMap, currentCity, () => false, refreshLineData, prepareUpload, searchServices, lineScopes,
            (done, total) => setSearchProgress({value:35 + Math.round(55 * done / Math.max(1,total)),label:`正在补全线路 ${done}/${total}…`}));
          if (!linesComplete) wasTruncated = true;
        }
        if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) {
          setIsSearching(false);
          return;
        }

        if (!usedRegionCache && performance.now() - searchStartedAt < 3000) {
          const hasMatchingLines = Array.from(fetchedLinesCache.current.values()).some((line: BusLine) =>
            !line.isUserSubmitted && (!line.city || line.city === currentCity) &&
            Array.from(lineNamesSet).some(name => matchesReturnedLine(name, line))
          );
          if (!hasMatchingLines) setShowEmptySearchNotice(true);
        }

        // Fetch all exact physical platforms from the fetched bus lines
        const trueStopsMap = new Map<string, any>();
        const platformsByName = new Map<string, Set<string>>();
        const platformName = (name: string = '') => name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '');
        const rememberPlatform = (key: string, value: any) => {
          const previous = trueStopsMap.get(key);
          if (previous) platformsByName.get(platformName(previous.name))?.delete(key);
          trueStopsMap.set(key, value);
          const name = platformName(value.name);
          if (!platformsByName.has(name)) platformsByName.set(name, new Set());
          platformsByName.get(name)!.add(key);
        };
        const findPlatform = (stop: any): string | undefined => {
          for (const key of platformsByName.get(platformName(stop.name)) || []) {
            const existing = trueStopsMap.get(key);
            const dx = existing.location.lng - stop.location.lng;
            const dy = existing.location.lat - stop.location.lat;
            if (dx * dx + dy * dy < 0.000000002) return key;
          }
        };

        const activeIdentities = new Set([...lineNamesSet].map(lineBaseIdentity));
        for (const [name, line] of fetchedLinesCache.current) {
          if (line.isUserSubmitted || isLineNameBlockedRef(name) || (filterIntervalBusRef.current && name.includes('区间'))) continue;
          if (!usedSharedCity && ![name, ...(line.sourceQueries || [])].some(query => activeIdentities.has(lineBaseIdentity(query)))) continue;
          for (const stop of line.via_stops || []) {
            if (!enableCityWideSearch && !expandedBounds.contains([stop.location.lng, stop.location.lat])) continue;
            const foundKey = findPlatform(stop);
            if (foundKey) trueStopsMap.get(foundKey).lines.add(name);
            else rememberPlatform(`${stop.location.lng},${stop.location.lat}`, { ...stop, lines: new Set([name]) });
          }
        }

        // Add any original POIs that might not have been covered by fetched lines
        pois.forEach((poi: any) => {
          const key = `${poi.location.lng},${poi.location.lat}`;
          if (!trueStopsMap.has(key)) {
            const addIt = !findPlatform(poi);
            if (addIt) {
              const lines = (poi.address || '').split(/[;；]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0 && (!filterIntervalBusRef.current || !s.includes('区间')));
              rememberPlatform(key, { ...poi, lines: new Set(lines) });
            }
          }
        });

        // Redraw with precise platforms
        if (searchVersionRef.current !== thisSearchVer || isClearedRef.current || isMinigameActiveRef.current) {
          setIsSearching(false);
          return;
        }
        if (trueStopsMap.size > 0) {
          clearStopMarkerGroup(markerGroupRef.current);
          allMapStopsRef.current.clear();
          const trueMarkers: any[] = [];
          trueStopsMap.forEach((poi: any, key: string) => {
            const linesArray = Array.from(poi.lines as Set<string>);
            allMapStopsRef.current.set(key, {
              name: poi.name,
              location: poi.location,
              lines: linesArray,
              city: currentCity
            });
            stopCountCacheRef.current.set(key, linesArray.length);
            const origColor = getStopColor(linesArray.length, '#3b82f6');
            const marker = lazyStopMarker(AMap, {
              center: [poi.location.lng, poi.location.lat],
              radius: 8,
              fillColor: origColor,
              strokeColor: '#fff',
              strokeWeight: 2,
              bubble: false,
              zIndex: 30,
              cursor: 'pointer',
              extData: { key, originalColor: origColor, originalRadius: 8 }
            });

            marker.on('click', () => {
              const stopPos = getLatLng(poi.location);
              if (selectPlannerStop({ city: currentCity, name: poi.name, location: stopPos }, linesArray)) return;

              setSelectionPos(stopPos);
              setSelectedSegmentLines(null);
              setSelectedSegmentName(null);
              const filteredInitial = linesArray.filter((l: string) => 
                (!filterIntervalBusRef.current || !l.includes('区间'))
              ).filter(name => fetchedLinesCache.current.has(name) || isValidBusLineName(name));
              setSelectedStop({
                name: poi.name,
                address: Array.from(new Set(filteredInitial.map((l: string) => l.split('(')[0].split('#')[0]))).join('; '),
                lines: filteredInitial,
                city: currentCity
              });

              // Fetch details async to get the full correct lines list
              fetchStopDetails(poi.name, stopPos, AMap, currentCity).then((details: any) => {
                if (details) {
                  setSelectedStop((prev: any) => {
                    if (prev && prev.name === poi.name) {
                      const filteredLoaded = (details.lines || []).filter((l: string) => !isLineNameBlockedRef(l));
                      const mergedLines = Array.from(new Set([...(prev.lines || []), ...filteredLoaded]));
                      return { ...prev, ...details, lines: mergedLines, city: currentCity };
                    }
                    return prev;
                  });
                }
              });
            });
            trueMarkers.push(marker);
          });
          activeRawMarkersRef.current = trueMarkers;
          roadStopMarkersRef.current = trueMarkers;
          syncStopMarkersToMap(map, AMap);
          roadStopsDataRef.current = new Map(allMapStopsRef.current);
        }

        const aiBox = getBoxForStops(Array.from(roadStopsDataRef.current.values())) || targetSearchBox;
        const areaLines = Array.from(fetchedLinesCache.current.values() as Iterable<BusLine>)
          .filter(line => (!line.city || line.city === currentCity) && line.path?.length > 1 &&
            clipPathToBox(line.path, aiBox.minLng, aiBox.maxLng, aiBox.minLat, aiBox.maxLat).length > 0)
          .map(line => ({ name: line.name, start: line.start_stop || '', end: line.end_stop || '',
            stopsInArea: (line.via_stops || []).filter(stop => {
              const [lng, lat] = getLatLng(stop.location);
              return lng >= aiBox.minLng && lng <= aiBox.maxLng && lat >= aiBox.minLat && lat <= aiBox.maxLat;
            }).map(stop => stop.name) }));
        if (areaLines.length) setAIRegionContext({ city: currentCity, bounds: { ...aiBox }, lines: areaLines });


        if (enableLineCacheRef.current && !usedRegionCache) {
          const linesToSave: BusLine[] = [];
          for (const lineVal of fetchedLinesCache.current.values()) {
            if (!lineVal.isUserSubmitted && (!lineVal.city || lineVal.city === currentCity)) {
              linesToSave.push(lineVal);
            }
          }
          const queriedPrefix = `${currentCity}::`;
          const queriedToSave: string[] = [];
          queriedLineNamesRef.current.forEach((qk) => {
            if (qk.startsWith(queriedPrefix)) {
              queriedToSave.push(qk.slice(queriedPrefix.length));
            }
          });
          await saveCitySearchToCache({
            city: currentCity,
            isCityWide: enableCityWideSearch,
            isComplete: !wasTruncated,
            searchBounds: targetSearchBox,
            pois,
            lines: linesToSave,
            queriedNames: queriedToSave,
          });
          refreshLineCacheStats();
        }
      }
      setSearchProgress({value:100,label:'检索完成，正在显示线路…'});
      setIsSearching(false);
    } catch (error) {
      console.error('Search error:', error);
      setIsSearching(false);
    } finally {
      if(searchVersionRef.current===thisSearchVer){setSearchActivity(null);setSearchProgress(null);setIsSearching(false);}
    }
  };

  const watchCityActionJob = async (initial: CityUpdateJob, preserveLocalMap = false) => {
    cityJobWatchRef.current?.abort();
    const controller = new AbortController();
    cityJobWatchRef.current = controller;
    try {
      const result = await cityUpdateJobs.watch(initial, job => {
        if (!controller.signal.aborted) { setCityUpdateJob(job); setSharedCityStatus(job.message); }
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.state === 'ready' || result.state === 'completed') {
        cityDataCache.invalidate(result.city);
        invalidateSharedCityRead(result.city);
      }
      if (preserveLocalMap) return;
      if (result.state === 'ready' || result.state === 'completed' || result.state === 'retained') {
        const snapshotId = result.result?.promoted ? result.result.snapshotId || undefined : undefined;
        const data = await loadSharedCity(result.city, snapshotId || result.id || crypto.randomUUID(), snapshotId);
        if (controller.signal.aborted) return;
        if (data && (citySnapshotFresh(data) || (actionsCityUpdatesEnabled && citySnapshotPreviewable(data)))) {
          setLastCityDataset(data);
          const map = mapRef.current;
          if (map && !isMinigameActiveRef.current) {
            map.getCity((address: any) => {
              const city = resolveSearchCity(address);
              if (!controller.signal.aborted && city.replace(/市$/, '') === data.city.replace(/市$/, '')) void handleSearch(false, data);
            });
          }
        } else setSharedCityStatus('任务已结束，共享文件仍在同步，可稍后重新进入该城市查看。');
      }
    } catch (error: any) {
      if (!controller.signal.aborted) {
        setSharedCityStatus(error.message || '无法读取更新状态，可稍后回来查看。');
        setCityUpdateJob(previous => previous ? { ...previous, message: error.message, state: 'failed' } : null);
      }
    }
  };

  const submitCityUpload = async () => {
    if (!pendingCityUpload || cityUploadBusy) return;
    const dataset = pendingCityUpload;
    setCityUploadBusy(true); setCityUploadError(''); setCityUploadProgress(0);
    try {
      const job = await uploadCitySnapshot(gatewayBase, dataset, setCityUploadProgress);
      setPendingCityUpload(null);
      setCityUpdateJob(job); setSharedCityStatus(job.message);
      void watchCityActionJob(job, true);
    } catch (error: any) {
      setCityUploadError(error.message || '远端提交失败；本地地图不受影响。');
    } finally { setCityUploadBusy(false); }
  };

  const fetchAndDrawLines = async (lineNames: string[], map: any, AMap: any, city: string, shouldCancel: () => boolean = () => false, forceRefresh = false, onCollected?: (complete: boolean) => void, searchServices: any = AMap, lineScopes = new Map<string, Set<string>>(), onProgress?: (done: number, total: number) => void) => {
    const startSearchVer = searchVersionRef.current;
    let complete = true;
    const cachedQueries = new Set<string>();
    if (!forceRefresh && lineNames.length && enableLineCacheRef.current) {
      for (const line of fetchedLinesCache.current.values()) {
        if (line.isUserSubmitted || line.scheduleDataVersion !== SCHEDULE_DATA_VERSION || (line.city && line.city !== city)) continue;
        for (const query of line.sourceQueries || []) cachedQueries.add(lineBaseIdentity(query));
      }
    }
    const seenQueries = new Set<string>();
    const linesToFetch = lineNames.filter(name => {
      const key = lineBaseIdentity(name);
      if (!key || seenQueries.has(key) || cachedQueries.has(key)) return false;
      seenQueries.add(key);
      return true;
    });

    if (linesToFetch.length > 0) {
      const newlyFetchedLines: BusLine[] = [];
      const newlyQueriedNames: string[] = [];
      const batchSize = 5;
      for (let i = 0; i < linesToFetch.length; i += batchSize) {
        if (searchVersionRef.current !== startSearchVer || isClearedRef.current || isMinigameActiveRef.current || shouldCancel()) {
          return false;
        }
        const batch = linesToFetch.slice(i, i + batchSize);
        await Promise.all(batch.map(async name => {
          const cancelled = () => searchVersionRef.current !== startSearchVer || isClearedRef.current
            || isMinigameActiveRef.current || shouldCancel();
          const keyword = name.replace(/[（(].*$/, '').replace(/#\d+$/, '').normalize('NFKC').trim();
          const result = await searchCityLine(searchServices, city || '全国', keyword, cancelled, checkAmapQuotaError);
          const exact = (line: any) => matchesLineQuery(keyword, line.name);
          const lines = new Map(result.lines.map(info => [info.id || info.name, info]));
          let queryComplete = result.complete;
          if (!result.lines.some(exact)) {
            for (const scope of lineScopes.get(lineBaseIdentity(name)) || []) {
              if (cancelled()) return;
              const regional = await searchCityLine(searchServices, scope, keyword, cancelled, checkAmapQuotaError);
              queryComplete = queryComplete && regional.complete;
              for (const info of regional.lines.filter(exact)) lines.set(info.id || info.name, info);
            }
          }
          if (cancelled()) return;
          const verified = queryComplete && [...lines.values()].some(exact);
          if (!verified) complete = false;
          if (verified) {
            queriedLineNamesRef.current.add(`${city}::${name}`);
            newlyQueriedNames.push(name);
          }
          for (const info of lines.values()) {
            if (isLineNameBlockedRef(info.name)) continue;
            const previous = fetchedLinesCache.current.get(info.name);
            const lineObj: BusLine = {
              id: info.id, name: info.name, city,
              sourceQueries: [...new Set([...(previous?.sourceQueries || []), ...(verified ? [name] : [])])],
              path: info.path.map((point: any) => getLatLng(point)),
              ...getOperatingHours(info),
              start_stop: info.start_stop, end_stop: info.end_stop, stops: [], via_stops: info.via_stops || [],
            };
            fetchedLinesCache.current.set(info.name, lineObj);
            newlyFetchedLines.push(lineObj);
          }
        }));
        onProgress?.(Math.min(i + batch.length, linesToFetch.length), linesToFetch.length);
      }
      cachedLinesVersionRef.current++;
      updateTerminalNamesCache();
      if (enableLineCacheRef.current && (newlyFetchedLines.length > 0 || newlyQueriedNames.length > 0)) {
        saveLinesToCache(city, newlyFetchedLines, newlyQueriedNames).then(() => refreshLineCacheStats());
      }
    }

    if (searchVersionRef.current !== startSearchVer || isClearedRef.current || isMinigameActiveRef.current || shouldCancel()) {
      return;
    }
    onCollected?.(complete);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await aggregateAndVisualize(lineNames, map, AMap);
    return complete;
  };

  const handleClear = () => {
    setSearchActivity(null);
    mapPointVersionRef.current++;
    manualResultCityRef.current = '';
    setPendingCityUpload(null);
    clearPriorityCoverage();
    cityJobWatchRef.current?.abort();
    setCityUpdateJob(null);
    setCityDataNotice(null);
    sharedMapDataRef.current = false;
    setLastCityDataset(null);
    setSharedCityStatus('');
    roadLookupVersionRef.current++;
    dismissSearchSuggestions();
    if (plannerOverlaysRef.current.length && mapRef.current) mapRef.current.remove(plannerOverlaysRef.current);
    plannerOverlaysRef.current = [];
    setShowTimeline(false);
    setTimelineAvailable(false);
    displayedLineNamesRef.current = [];
    setAIRegionContext(null);
    setShowEmptySearchNotice(false);
    isClearedRef.current = true;
    searchVersionRef.current++;

    if (mapRef.current && mapClickHandlerRef.current) {
      mapRef.current.off('click', mapClickHandlerRef.current);
    }
    if (mapRef.current && defaultMapClickHandlerRef.current) {
      mapRef.current.on('click', defaultMapClickHandlerRef.current);
      mapClickHandlerRef.current = defaultMapClickHandlerRef.current;
    }

    if (markerGroupRef.current) clearStopMarkerGroup(markerGroupRef.current);
    if (lineGroupRef.current) lineGroupRef.current.clearOverlays();





    if (selectionMarkerRef.current) {
      try {
        selectionMarkerRef.current.setMap(null);
        if (mapRef.current) mapRef.current.remove(selectionMarkerRef.current);
      } catch (e) {}
      selectionMarkerRef.current = null;
    }

    if (mapRef.current) {
      try {
        const textOverlays = mapRef.current.getAllOverlays?.('text') || [];
        textOverlays.forEach((t: any) => {
          try {
            t.setMap(null);
            mapRef.current.remove(t);
          } catch {}
        });
      } catch {}
    }

    // Clear local runtime map overlays/refs (persistent IndexedDB line cache is managed separately)
    fetchedLinesCache.current.clear();
    queriedLineNamesRef.current.clear();
    allMapStopsRef.current.clear();
    stopCountCacheRef.current.clear();
    setBoxSelectedStops([]);
    setIsBoxSelectMode(false);
    setSearchQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveBusLine(null);
    setStats({ stops: 0, lines: 0 });
    setFilterTerminalOnly(false);
    filterTerminalOnlyRef.current = false;
    setSelectedSegmentLines(null);
    setSelectedStop(null);
    setSelectionPos(null);
    setSelectedSegmentName(null);
    setSelectedSegmentAddress(null);
    setIsSearching(false);
    roadViewportCleanupRef.current?.();
    roadViewportCleanupRef.current = null;
    roadOverlaysRef.current = [];
    roadStopMarkersRef.current = [];
    activeRawMarkersRef.current = [];
    roadStopsDataRef.current.clear();
    activeBusLinePolylineRef.current = null;
  };

  const applyAILines = async (city: string, names: string[]): Promise<string> => {
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    if (!map || !AMap || isMinigameActiveRef.current || isSearching) throw new Error('请先等待地图就绪并结束其他检索。');
    handleClear();
    isClearedRef.current = false;
    const version = ++searchVersionRef.current;
    setIsSearching(true);
    const matched: string[] = [];
    const missing: string[] = [];
    const lines: BusLine[] = [];
    const normalize = (name: string) => name.split(/[（(]/)[0].replace(/\s+/g, '');
    try {
      for (let i = 0; i < names.length; i++) {
        if (searchVersionRef.current !== version || isClearedRef.current || isMinigameActiveRef.current) throw new Error('地图检索已取消。');
        const name = names[i];
        setAISearchProgress(`正在检索 ${i + 1}/${names.length}：${name}`);
        const found = await new Promise<BusLine[]>(resolve => {
          let settled = false;
          const finish = (result: BusLine[]) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
          const timer = setTimeout(() => finish([]), 8000);
          try {
            const search = new AMap.LineSearch({ city, pageSize: 100, extensions: 'all' });
            search.search(name, (status: string, result: any) => {
              if (settled || searchVersionRef.current !== version) { finish([]); return; }
              checkAmapQuotaError(status, result);
              const found = status === 'complete' ? (result?.lineInfo || []).filter((line: any) => normalize(line.name || '') === normalize(name) && line.path?.length > 1) : [];
              finish(found.map((line: any) => ({ id: line.id, name: line.name, city, path: line.path.map((point: any) => getLatLng(point)),
                ...getOperatingHours(line), start_stop: line.start_stop, end_stop: line.end_stop, via_stops: line.via_stops || [], stops: [] })));
            });
          } catch { finish([]); }
        });
        if (searchVersionRef.current !== version || isClearedRef.current || isMinigameActiveRef.current) throw new Error('地图检索已取消。');
        if (found.length) { matched.push(name); lines.push(...found); } else missing.push(name);
      }
      lines.forEach(line => fetchedLinesCache.current.set(line.name, line));
      const points = lines.flatMap(line => line.path);
      if (points.length) {
        const lngs = points.map(point => point[0]);
        const lats = points.map(point => point[1]);
        const bounds = new AMap.Bounds(
          [lngs.reduce((a, b) => Math.min(a, b)), lats.reduce((a, b) => Math.min(a, b))],
          [lngs.reduce((a, b) => Math.max(a, b)), lats.reduce((a, b) => Math.max(a, b))]
        );
        map.setBounds(bounds);
        const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();

        aggregateAndVisualize(Array.from(new Set(lines.map(line => line.name))), map, AMap);
      }
      return `共 ${names.length} 条候选线路，成功检索 ${matched.length} 条，已显示到地图。${missing.length ? '\n未找到或请求失败：' + missing.join('、') : ''}`;
    } finally { setAISearchProgress(''); if (searchVersionRef.current === version) setIsSearching(false); }
  };

  const aggregateAndVisualize = async (activeLineSet: string[], map: any, AMap: any) => {
    roadViewportCleanupRef.current?.();
    roadViewportCleanupRef.current = null;
    const renderVersion = ++aggregateVersionRef.current;
    const searchVersion = searchVersionRef.current;
    const cancelled = () => renderVersion !== aggregateVersionRef.current || searchVersion !== searchVersionRef.current || isClearedRef.current || isMinigameActiveRef.current;
    let sliceStarted = performance.now();
    const yieldToUI = async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      sliceStarted = performance.now();
      return cancelled();
    };
    if (await yieldToUI()) return;
    const cityWideRendering = true;
    const expandedLineNames: string[] = [];
    const cacheKeys = Array.from(fetchedLinesCache.current.keys()) as string[];

    activeLineSet.forEach(name => {
      const matches = fetchedLinesCache.current.has(name) ? [name] : cacheKeys.filter(key => matchesReturnedLine(name, fetchedLinesCache.current.get(key)!));
      if (matches.length > 0) {
        expandedLineNames.push(...matches);
      }
    });

    // If selectedSegmentLines is active, filter allMapStopsRef to only include stops belonging to the selected lines
    if (selectedSegmentLines && selectedSegmentLines.length > 0) {
      const activeLineNamesSet = new Set(expandedLineNames.map(name => name.split('(')[0]));
      const filteredStops = new Map<string, any>();
      roadStopsDataRef.current.forEach((stop, key) => {
        const hasMatchingLine = stop.lines.some((l: string) => activeLineNamesSet.has(l.split('(')[0]));
        if (hasMatchingLine) {
          filteredStops.set(key, stop);
        }
      });
      if (filteredStops.size > 0) {
        allMapStopsRef.current = filteredStops;
      }
    }

    // Add approved user-submitted lines if not filtered out
    const isFilteredOut = localStorage.getItem('app_filter_user_submissions') === 'true';
    if (showUserSubmittedData && !isFilteredOut) {
      const currentBounds = map.getBounds();
      if (currentBounds) {
        const sw = currentBounds.getSouthWest();
        const ne = currentBounds.getNorthEast();
        approvedUserLines.forEach(ul => {
          const inBounds = ul.path && ul.path.some((pt: any) => {
            const lng = pt.lng !== undefined ? pt.lng : pt[0];
            const lat = pt.lat !== undefined ? pt.lat : pt[1];
            return lng >= sw.lng - 0.05 && lng <= ne.lng + 0.05 && lat >= sw.lat - 0.05 && lat <= ne.lat + 0.05;
          });
          if (inBounds) {
            const matches = cacheKeys.filter(key => key === ul.name);
            matches.forEach(m => {
              if (!expandedLineNames.includes(m)) {
                expandedLineNames.push(m);
              }
            });
          }
        });
      }
    }

    expandedLineNames.splice(0, expandedLineNames.length, ...new Set(expandedLineNames));
    displayedLineNamesRef.current = [...expandedLineNames];
    setTimelineAvailable(expandedLineNames.length > 0);

    // Retain whole paths and small bounding blocks. No per-edge objects/Sets or mutated source geometry.
    const renderRoutes: RenderRoute[] = [];
    const colorGroups = new Map<string, Array<[number, number][]>>();
    for (const name of expandedLineNames) {
      if (performance.now() - sliceStarted > 8 && await yieldToUI()) return;
      const line = fetchedLinesCache.current.get(name);
      if (!line || line.path.length < 2) continue;
      const displayPath = offsetRoutePath(line.path);
      renderRoutes.push({ name, path: line.path, displayPath });
      const color = line.isUserSubmitted ? '#9C7A97' : '#52796F';
      if (!colorGroups.has(color)) colorGroups.set(color, []);
      colorGroups.get(color)!.push(displayPath);
    }
    const hitIndex = new RouteRenderIndex(renderRoutes);
    setStats(prev => ({ ...prev, lines: new Set(expandedLineNames.map(lineBaseIdentity)).size }));

    const allOverlays: any[] = [];



    const networkLayers: { color: string; overlay: any }[] = [];
    const visibleGroups = () => {
      if(map.getZoom()<CITY_DETAIL_ZOOM)return new Map<string,[number,number][][]>();
      const bounds = map.getBounds(), sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
      const padX = (ne.lng - sw.lng) * .15, padY = (ne.lat - sw.lat) * .15;
      const visible = hitIndex.visiblePaths({minLng:sw.lng-padX,maxLng:ne.lng+padX,minLat:sw.lat-padY,maxLat:ne.lat+padY});
      const groups = new Map<string, [number,number][][]>();
      for (const [name, paths] of visible) {
        const color = fetchedLinesCache.current.get(name)?.isUserSubmitted ? '#9C7A97' : '#52796F';
        if (!groups.has(color)) groups.set(color, []);
        for (const path of paths) {
          const clipped = [path];
          for (const segment of clipped) groups.get(color)!.push(segment);
        }
      }
      return groups;
    };
    const initialGroups = visibleGroups();
    colorGroups.forEach((_paths, color) => {
      const paths = initialGroups.get(color) || [];
      const joinedPaths = paths;

      {
        const polyline = new AMap.Polyline({
          path: joinedPaths,
          strokeColor: color,
          strokeWeight: lineThickness === 'thin' ? 3 : 6,
          strokeOpacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
          isOutline: true,
          outlineColor: '#ffffff',
          borderWeight: lineThickness === 'thin' ? 0.5 : 1.5,
          bubble: true,
          zIndex: color === '#B56666' ? 15 : (color === '#C29B63' ? 12 : 10)
        });
        allOverlays.push(polyline);
        networkLayers.push({color,overlay:polyline});
      }
    });

    if (cancelled()) return;
    const selectedPolyline = activeBusLinePolylineRef.current;
    lineGroupRef.current.clearOverlays();
    lineGroupRef.current.addOverlays(allOverlays);
    if (selectedPolyline) lineGroupRef.current.addOverlay(selectedPolyline);
    roadOverlaysRef.current = allOverlays;
    const updateViewport = () => {
      if (cancelled()) return;
      const attached = lineGroupRef.current?.getOverlays() || [];
      if (!networkLayers.every(layer => attached.includes(layer.overlay))) return;
      const groups = visibleGroups();
      for (const {color,overlay} of networkLayers) overlay.setPath(groups.get(color) || []);
    };
    map.on('moveend', updateViewport);
    map.on('zoomend', updateViewport);
    roadViewportCleanupRef.current = () => { map.off('moveend', updateViewport); map.off('zoomend', updateViewport); };
    if (mapClickHandlerRef.current) {
      map.off('click', mapClickHandlerRef.current);
    }

    const onMapClick = (e: any) => {
      if (isMinigameActiveRef.current) return;
      if (isDrawingModeRef.current) {
        handleDrawingMapClick(e);
        return;
      }
      const clickLngLat = [e.lnglat.lng, e.lnglat.lat] as [number, number];
      if (pickPlannerMapStop(clickLngLat, map)) return;

      const currentZoom = map.getZoom();
      const zoomFactor = Math.max(1, Math.pow(2, 16 - currentZoom));
      const SEARCH_DIST = 0.00018 * zoomFactor;
      const foundSegments = hitIndex.query(clickLngLat, SEARCH_DIST);

      if (foundSegments.length > 0) {
        foundSegments.sort((a, b) => a.dist - b.dist);
        const closest = foundSegments[0];
        const minDist = closest.dist;

        if (minDist > SEARCH_DIST) return;

        const selectionThreshold = Math.max(minDist + 0.000045 * zoomFactor, minDist * 1.6);
        const linesSet = new Set<string>();

        // Calculate direction of the closest segment to filter out opposite directions
        const v1x = closest.data.end[0] - closest.data.start[0];
        const v1y = closest.data.end[1] - closest.data.start[1];

        foundSegments.forEach(s => {
          if (s.dist <= selectionThreshold) {
            const v2x = s.data.end[0] - s.data.start[0];
            const v2y = s.data.end[1] - s.data.start[1];
            // Use dot product to ensure same general direction
            if (v1x * v2x + v1y * v2y >= 0) {
              s.lines.forEach(l => linesSet.add(l));
            }
          }
        });

        if (linesSet.size > 0) {
          const closestSegmentProjectedTrue = getProjection(clickLngLat, closest.data.start, closest.data.end);
          const closestSegmentProjectedVisual = getProjection(clickLngLat, closest.data.offsetStart, closest.data.offsetEnd);

          setSelectionPos(closestSegmentProjectedVisual as [number, number]);
          setTopCard('stop');
          setSelectedStop(null);
          setSelectedSegmentName("正在获取路段信息...");
          setSelectedSegmentLines(Array.from(linesSet));
          const lookupVersion = ++roadLookupVersionRef.current;
          const lookupSearchVersion = searchVersionRef.current;
          const lookupCancelled = () => lookupVersion !== roadLookupVersionRef.current
            || lookupSearchVersion !== searchVersionRef.current || isClearedRef.current || isMinigameActiveRef.current;
          // Nearby station labels may contain routes absent from city POI
          // address strings. Verify each candidate's geometry before selection.
          if (!sharedMapDataRef.current) void (async () => {
            const nearby: any[] = await new Promise(resolve => {
              const timer = setTimeout(() => resolve([]), 6000);
              try {
                new AMap.PlaceSearch({ city: currentCity, type: '公交车站', pageSize: 20, extensions: 'all' })
                  .searchNearBy('', closestSegmentProjectedTrue, 400, (status: string, result: any) => {
                    clearTimeout(timer);
                    resolve(status === 'complete' ? result?.poiList?.pois || [] : []);
                  });
              } catch { clearTimeout(timer); resolve([]); }
            });
            if (lookupCancelled()) return;
            const candidates = new Set<string>();
            nearby.forEach(poi => String(poi.address || '').split(/[;；]/).map(name => name.trim()).filter(Boolean).forEach(name => candidates.add(name)));
            const stationLines = await discoverStationLines(AMap, currentCity, nearby.slice(0, 8), lookupCancelled);
            stationLines.forEach(name => candidates.add(name));
            const names = [...candidates].filter(name => !isLineNameBlockedRef(name));
            if (lookupCancelled() || !names.length) return;
            const activeNames = [...new Set([...displayedLineNamesRef.current, ...names])];
            await fetchAndDrawLines(activeNames, map, AMap, currentCity, lookupCancelled);
            if (lookupCancelled()) return;
            const verifiedLines = new Set(linesSet);
            const directionLength = Math.hypot(v1x, v1y);
            for (const name of displayedLineNamesRef.current) {
              const path = fetchedLinesCache.current.get(name)?.path || [];
              for (let i = 0; i < path.length - 1; i++) {
                const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1];
                const length = Math.hypot(dx, dy);
                if (!length || !directionLength || (dx * v1x + dy * v1y) / (length * directionLength) < 0.85) continue;
                if (distToSegment(closestSegmentProjectedTrue, path[i], path[i + 1]) <= 0.00012) {
                  verifiedLines.add(name);
                  break;
                }
              }
            }
            if (!lookupCancelled()) setSelectedSegmentLines([...verifiedLines]);
          })().catch(error => console.warn('Road coverage cross-check failed', error));

          if (geocoderRef.current) {
            // Shift the query point 30 meters along the line segment to avoid crossroad intersections
            // which often return the intersecting minor road name instead of the main road.
            const dx = closest.data.end[0] - closest.data.start[0];
            const dy = closest.data.end[1] - closest.data.start[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            let queryLngLat = closestSegmentProjectedTrue;
            if (len > 0.0001) {
               const shiftAmt = 0.0003; // ~30 meters
               const distToEnd = Math.sqrt(Math.pow(closest.data.end[0] - queryLngLat[0], 2) + Math.pow(closest.data.end[1] - queryLngLat[1], 2));
               if (distToEnd > shiftAmt) {
                 queryLngLat = [queryLngLat[0] + (dx/len)*shiftAmt, queryLngLat[1] + (dy/len)*shiftAmt];
               } else {
                 queryLngLat = [queryLngLat[0] - (dx/len)*shiftAmt, queryLngLat[1] - (dy/len)*shiftAmt];
               }
            }

            geocoderRef.current.getAddress(queryLngLat, (status: string, result: any) => {
              if (lookupCancelled()) return;
              if (status === 'complete' && result.regeocode) {
                const comp = result.regeocode.addressComponent;
                const preciseLocation = [
                  comp.province,
                  comp.city !== comp.province ? comp.city : '',
                  comp.district,
                  comp.township
                ].filter(Boolean).join('');
                const nearestRoad = result.regeocode.roads && result.regeocode.roads.length > 0 ? result.regeocode.roads[0].name : '';
                const genericPoi = result.regeocode.pois && result.regeocode.pois.length > 0 ? result.regeocode.pois[0].name : '';
                const fallbackName = nearestRoad || genericPoi || comp.street || comp.township || comp.district;

                setSelectedSegmentName(fallbackName || "当前位置");
                setSelectedSegmentAddress(preciseLocation || result.regeocode.formattedAddress);
              } else {
                setSelectedSegmentName("当前路段");
                setSelectedSegmentAddress(null);
              }
            });
          }
        }
      }
    };

    map.on('click', onMapClick);
    mapClickHandlerRef.current = onMapClick;

  };

  useEffect(() => {
    if (!mapInstance || !sharedCityDataEnabled || !currentCity || currentCity === '全国' || showMinigameModal
      || (!appSettingsVisible && (onboardingStep !== 0 || zoomLevel < CITY_DETAIL_ZOOM))) {
      setCityDataNotice(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadPublishedCities().then(cities => {
        if (cancelled) return;
        const city = cities.find(entry => entry.city.replace(/市$/, '') === currentCity.replace(/市$/, ''));
        setPublishedCitySummary(city ?? null);
        setCityDataNotice(city ? null : { city: currentCity, kind: 'missing' });
      }).catch(() => {});
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mapInstance, currentCity, zoomLevel >= CITY_DETAIL_ZOOM, showMinigameModal, onboardingStep, appSettingsVisible]);

  useEffect(() => {
    const AMap = (window as any).AMap;
    if (!mapInstance || !AMap || !showUserSubmittedData || filterUserSubmissions || !approvedUserLines.length
      || showMinigameModal || showTimeline || timelineAvailable) return;
    const routes = approvedUserLines.filter(line => !viewportLineBlocked(line.name) && line.path?.length > 1)
      .map(line => {
        const path = line.path.map(getLatLng);
        return { name: line.name, path, displayPath: offsetRoutePath(path) };
      });
    if (!routes.length) return;
    const index = new RouteRenderIndex(routes);
    const overlay = new AMap.Polyline({
      path: [], strokeColor: '#9c7a97', strokeWeight: lineThickness === 'thin' ? 3 : 6,
      lineCap: 'round', lineJoin: 'round', bubble: true, zIndex: 10,
    });
    const refresh = () => {
      const bounds = mapInstance.getBounds();
      const sw = bounds?.getSouthWest(), ne = bounds?.getNorthEast();
      const visible = sw && ne && mapInstance.getZoom() >= CITY_DETAIL_ZOOM
        ? index.visiblePaths({ minLng: sw.lng, minLat: sw.lat, maxLng: ne.lng, maxLat: ne.lat }) : new Map();
      overlay.setPath([...visible.values()].flat());
    };
    mapInstance.add(overlay);
    refresh();
    mapInstance.on('moveend', refresh);
    mapInstance.on('zoomend', refresh);
    return () => {
      mapInstance.off('moveend', refresh);
      mapInstance.off('zoomend', refresh);
      mapInstance.remove(overlay);
    };
  }, [mapInstance, showUserSubmittedData, filterUserSubmissions, approvedUserLines, showMinigameModal,
    showTimeline, timelineAvailable, viewportLineBlocked, lineThickness]);

  useEffect(() => {
    if (showTimeline || showMinigameModal) priorityCoverageRef.current?.hide();
    else priorityCoverageRef.current?.show();
  }, [mapInstance, showTimeline, showMinigameModal]);

  useEffect(() => {
    if (!showTimeline || !mapRef.current || !(window as any).AMap) return;
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    lineGroupRef.current?.hide();
    markerGroupRef.current?.hide();
    const oldClick = mapClickHandlerRef.current;
    if (oldClick) map.off('click', oldClick);
    return () => {
      lineGroupRef.current?.show();
      markerGroupRef.current?.show();
      if (oldClick) map.on('click', oldClick);
    };
  }, [showTimeline]);

  useEffect(() => {
    if (!showTimeline || !mapRef.current || !(window as any).AMap) return;
    const map = mapRef.current;
    const AMap = (window as any).AMap;
    const indexedRoutes = timelineLines
      .filter(line => line.path?.length > 1)
      .map(line => ({ name: line.name, path: line.path.map(getLatLng), displayPath: line.path.map(getLatLng) }));
    const routeIndex = new RouteRenderIndex(indexedRoutes);
    const selectTimelineRoad = (event?: any) => {
      const lnglat = event?.lnglat;
      if (!lnglat) return;
      const point: [number, number] = [lnglat.getLng(), lnglat.getLat()];
      if (pickPlannerMapStop(point, map)) return;
      const names = [...new Set(routeIndex.query(point, 0.00018).flatMap(hit => [...hit.lines]))];
      if (!names.length) return;
      setSelectedStop(null);
      setActiveBusLine(null);
      setSelectionPos(point);
      setSelectedSegmentName('当前路段');
      setSelectedSegmentAddress(null);
      setSelectedSegmentLines(names);
      setTopCard('stop');
    };
    const entries: TimelineOverlayEntry[] = timelineLines.flatMap((line) => {
      const path = (line.path || []).map(getLatLng);
      if (path.length < 2) return [];
      const overlay = lazyTimelineRoute(map, AMap, {
        strokeColor: line.isUserSubmitted ? '#BA55D3' : '#52796F',
        strokeWeight: lineThickness === 'thin' ? 3 : 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        isOutline: true,
        outlineColor: '#ffffff',
        borderWeight: lineThickness === 'thin' ? 0.5 : 1.5,
        zIndex: 55,
        bubble: true,
      }, selectTimelineRoad);
      overlay.setPaths([path]);
      return [{ line, overlay, visible: true }];
    });
    timelineOverlaysRef.current = entries;
    updateTimelineVisibility(entries, timelineMinuteRef.current);
    return () => {
      entries.forEach(entry => (entry.overlay as any).destroy());
      if (timelineOverlaysRef.current === entries) timelineOverlaysRef.current = [];
    };
  }, [showTimeline, timelineLines, mapInstance, lineThickness]);


  useEffect(() => {
    if (showTimeline) updateTimelineVisibility(timelineOverlaysRef.current, timelineMinute);
  }, [showTimeline, timelineMinute, timelineLines]);

  useEffect(() => {
    if (!showTimeline || !timelinePlaying) return;
    const timer = window.setInterval(() => {
      setTimelineMinute(minute => minute >= 1439 ? 0 : minute + 1 / 3);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [showTimeline, timelinePlaying]);

  useEffect(() => {
    if (!showTimeline) setTimelinePlaying(false);
  }, [showTimeline]);

  useEffect(() => {
    if (!showTimeline) return;
    timelineOverlaysRef.current.forEach(entry => (entry.overlay as any).setOptions({ strokeWeight: lineThickness === 'thin' ? 3 : 6 }));
  }, [showTimeline, timelineLines, lineThickness]);

  const drawBusPlan = (plan: BusPlan) => {
    const map = mapRef.current, AMap = (window as any).AMap;
    if (!map || !AMap || isMinigameActiveRef.current || plannerSearchVersionRef.current !== searchVersionRef.current) throw new Error('地图状态已改变，请重新规划。');
    if (plannerOverlaysRef.current.length) map.remove(plannerOverlaysRef.current);
    const overlays: any[] = [];
    plan.steps.forEach(step => {
      if (step.path.length < 2) return;
      overlays.push(new AMap.Polyline({ path: step.path, strokeColor: step.mode === 'WALK' ? '#B58A52' : '#52796F',
        strokeWeight: step.mode === 'WALK' ? 4 : 6, strokeStyle: step.mode === 'WALK' ? 'dashed' : 'solid', strokeOpacity: 0.95, zIndex: 80, lineJoin: 'round', lineCap: 'round' }));
    });
    plannerOverlaysRef.current = overlays;
    map.add(overlays);
    if (overlays.length) map.setFitView(overlays, false, [100, 50, 120, window.innerWidth >= 640 ? 440 : 50]);
  };

  const handleScreenshot = async () => {
    if (!containerRef.current) return;
    try {
      const canvas = await html2canvas(containerRef.current, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });
      const link = document.createElement('a');
      link.download = `bus-line-screenshot-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (error) {
      console.error('Screenshot error:', error);
    }
  };

  const getDistSq = (p1: [number, number], p2: [number, number]) => {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
  };

  const distToSegmentSq = (p: [number, number], v: [number, number], w: [number, number]) => {
    const l2 = getDistSq(v, w);
    if (l2 === 0) return getDistSq(p, v);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const dx = p[0] - (v[0] + t * (w[0] - v[0]));
    const dy = p[1] - (v[1] + t * (w[1] - v[1]));
    return dx * dx + dy * dy;
  };

  const distToSegment = (p: [number, number], v: [number, number], w: [number, number]) => {
    return Math.sqrt(distToSegmentSq(p, v, w));
  };

  const getProjection = (p: [number, number], v: [number, number], w: [number, number]): [number, number] => {
    const l2 = getDistSq(v, w);
    if (l2 === 0) return v;
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return [
      v[0] + t * (w[0] - v[0]),
      v[1] + t * (w[1] - v[1])
    ];
  };

  const parseLineInfo = (lineStr: string) => {
    // Check if it's an approved user-submitted line
    const userLine = showUserSubmittedData ? approvedUserLines.find(ul => ul.name === lineStr) : null;
    if (userLine) {
      const firstStop = userLine.via_stops[0]?.name || '始发站';
      const lastStop = userLine.via_stops[userLine.via_stops.length - 1]?.name || '终点站';
      return {
        name: userLine.name,
        start: firstStop,
        end: lastStop
      };
    }

    const match = lineStr.match(/^(.+?)\((.+?)--(.+?)\)$/);
    if (match) {
      return { name: match[1].trim(), start: match[2].trim(), end: match[3].trim() };
    }

    let info = fetchedLinesCache.current.get(lineStr);

    if (!info) {
      const cleanLineStr = lineStr.replace('路', '').trim();
      const baseName = cleanLineStr.split('(')[0].trim();
      const bracketMatch = cleanLineStr.match(/\((.+?)\)/);
      const bracketText = bracketMatch ? bracketMatch[1].trim() : '';

      // First try to find exact direction if available, else first match
      for (const [key, value] of fetchedLinesCache.current.entries()) {
        const cleanKey = key.replace('路', '').trim();
        const keyBaseName = cleanKey.split('(')[0].trim();

        if (keyBaseName === baseName) {
           if (bracketText && !cleanKey.includes(bracketText)) {
             continue;
           }
           info = value;
           break;
        }
      }
    }

    if (info) {
      return { 
        name: info.name.split('(')[0].trim(), 
        start: (info.start_stop || '始发站').trim(), 
        end: (info.end_stop || '终点站').trim()
      };
    }

    return { name: lineStr.trim(), start: '-', end: '-' };
  };

  // Background fetch for missing line directions
  useEffect(() => {
    if (selectedStop?.key?.startsWith('tile:') || (!selectedStop && selectedViewportRoutesRef.current.length)) return;
    const visibleLines = selectedStop?.lines || selectedSegmentLines || [];
    if (visibleLines.length > 0) {
      const missingLines = visibleLines.filter((l: string) => {
        const parsed = parseLineInfo(l);
        const cached = fetchedLinesCache.current.get(l);
        return parsed.start === '-' || parsed.end === '-' || (cached?.scheduleDataVersion !== SCHEDULE_DATA_VERSION && !cached?.isUserSubmitted);
      });

      if (missingLines.length > 0 && (window as any).AMap) {
        const queries = [...new Set(missingLines.map((name: string) => parseLineInfo(name).name))];
        let cancelled = false;
        let updated = false;
        let checked = 0;
        for (const shortName of queries) {
          const lineSearch = new (window as any).AMap.LineSearch({
            pageIndex: 1, city: currentCity || '全国', pageSize: 10, extensions: 'all',
          });
          lineSearch.search(shortName, (status: string, result: any) => {
            if (cancelled) return;
            checked++;
            if (status === 'complete' && result?.lineInfo?.length) {
              result.lineInfo.forEach((info: any, index: number) => {
                const name = info.name || `${shortName}#${index}`;
                const current = fetchedLinesCache.current.get(name);
                if (current?.isUserSubmitted || current?.scheduleDataVersion === SCHEDULE_DATA_VERSION) return;
                if (current?.id && info.id && current.id !== info.id) return;
                if (!current && (sharedMapDataRef.current || !Array.isArray(info.path))) return;
                fetchedLinesCache.current.set(name, {
                  ...(current || {
                    id: info.id, name, city: currentCity, path: info.path.map(getLatLng),
                    start_stop: info.start_stop, end_stop: info.end_stop, via_stops: info.via_stops || [], stops: [],
                  }),
                  ...getOperatingHours(info),
                });
                updated = true;
              });
            }
            if (checked === queries.length && updated) {
              cachedLinesVersionRef.current++;
              setCacheUpdateTick(v => v + 1);
            }
          });
        }
        return () => { cancelled = true; };
      }
    }
  }, [selectedStop, selectedSegmentLines, currentCity]);

  // Background fetch for stop line counts when a bus line is active
  useEffect(() => {
    if (!stationLineStatsRef.current || !activeBusLine || !activeBusLine.via_stops || !(window as any).AMap) return;

    // Check if we need to load any stats
    let needsFetch = false;
    for (const stop of activeBusLine.via_stops) {
      if (!stopCountCacheRef.current.has(`${stop.location.lng},${stop.location.lat}`)) {
        needsFetch = true;
        break;
      }
    }

    if (!needsFetch) return; // All cached

    const stationSearch = new (window as any).AMap.StationSearch({
      pageIndex: 1,
      pageSize: 50,
      city: currentCity || '全国'
    });

    let currentUpdateTick = 0;
    let cancelled = false;

    const runBatch = async () => {
      for (let i = 0; i < activeBusLine.via_stops.length; i++) {
        // Stop if map changes or we deactivate the line early
        if (cancelled || !stationLineStatsRef.current || !mapRef.current) break;

        const stop = activeBusLine.via_stops[i];
        const key = `${stop.location.lng},${stop.location.lat}`;
        if (stopCountCacheRef.current.has(key)) continue;

        const originalName = stop.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '');

        await new Promise<void>(resolve => {
           let finished = false;
           const timeout = setTimeout(() => {
              if (!finished) {
                 finished = true;
                 stopCountCacheRef.current.set(key, 1);
                 resolve();
              }
           }, 2000);

           try {
             stationSearch.search(originalName, (status: string, result: any) => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                let lineCount = 0;
                if (status === 'complete' && result.stationInfo && result.stationInfo.length > 0) {
                   let bestStation = result.stationInfo[0];
                   let minDist = Infinity;
                   result.stationInfo.forEach((si: any) => {
                     const dx = si.location.lng - stop.location.lng;
                     const dy = si.location.lat - stop.location.lat;
                     const d = dx*dx + dy*dy;
                     if (d < minDist) { minDist = d; bestStation = si; }
                   });
                   if (bestStation && minDist < 0.0005) {
                      const linesStr = bestStation.buslines ? bestStation.buslines.map((l: any)=>l.name).filter(Boolean) : [];
                      lineCount = linesStr.filter((s: string) => s.length > 0 && !isLineNameBlockedRef(s)).length;
                   }
                }
                stopCountCacheRef.current.set(key, lineCount || 1);
                currentUpdateTick++;
                resolve();
             });
           } catch(e) {
             if (!finished) {
               finished = true;
               clearTimeout(timeout);
               stopCountCacheRef.current.set(key, 1);
               resolve();
             }
           }
        });

        if (cancelled) return;
        // Directly update map marker colors for performance without triggering heavy React re-renders
        if (currentUpdateTick > 0 && (i % 4 === 0 || i === activeBusLine.via_stops.length - 1)) {
           currentUpdateTick = 0;
           if (markerGroupRef.current) {
             const overlays = markerGroupRef.current.getOverlays();
             overlays.forEach((o: any) => {
               const ext = o.getExtData ? o.getExtData() : null;
               if (ext && ext.key && ext.type === 'busLineStop') {
                 const newCount = stopCountCacheRef.current.get(ext.key) || 0;
                 const newColor = getStopColor(newCount, '#3b82f6');
                 ext.originalColor = newColor;
                 if (o._opts && o._opts.fillColor !== newColor && !filterTerminalOnlyRef.current) {
                    o.setOptions({ fillColor: newColor });
                 }
               }
             });
           }
        }
      }
      if (!cancelled) setCacheUpdateTick(v => v + 1);
    };

    runBatch();
    return () => { cancelled = true; };
  }, [activeBusLine, currentCity]);

  const geometryDebug = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugGeometry');
  const isAnswering = showMinigameModal && gameState === 'playing';
  return (
    <div className="flex flex-col h-screen w-full bg-[#F4F6F4] font-sans text-slate-900 overflow-hidden relative selection:bg-m3-primary/20">
      {geometryDebug && mapInstance && <GeometryDebugPanel map={mapInstance} />}
      {/* Global API Quota / Error Banner */}
      <AnimatePresence>
        {(apiErrorNotification || showEmptySearchNotice) && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[150] max-w-md w-[92vw] bg-amber-600 text-white p-3 sm:p-3.5 rounded-2xl shadow-2xl backdrop-blur-md flex items-center justify-between gap-3 border border-amber-400/50 pointer-events-auto"
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-200" />
              <span className="text-xs font-bold leading-tight">{showEmptySearchNotice ? (useCustomApiKey ? '当前区域无公交线路，或 您提供的API 已达到当月上限' : '当前区域无公交线路，或 公共API 已达到当月上限') : apiErrorNotification}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  focusCustomApiRef.current = true;
                  setUseCustomApiKey(true);
                  setShowSettings(true);
                  setSettingsTab('general');
                  setShowEmptySearchNotice(false);
                  setApiErrorNotification(null);
                }}
                className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-black transition-all cursor-pointer"
              >
                填写自己的 API
              </button>
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => { setApiErrorNotification(null); setShowEmptySearchNotice(false); }}
                className="p-1 hover:bg-white/20 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBusPlanner && <BusPlanner onClose={() => { setShowBusPlanner(false); if (plannerOverlaysRef.current.length) mapRef.current?.remove(plannerOverlaysRef.current); plannerOverlaysRef.current = []; }}
          currentCity={currentCity} onMapPick={setPlannerStopPicker}
          disabled={isSearching || loading || showMinigameModal || isDrawingMode}
          onClear={() => { handleClear(); plannerSearchVersionRef.current = searchVersionRef.current; }} onDraw={drawBusPlan} />}
      </AnimatePresence>

      <AnimatePresence>
        {showBuslineAI && <BuslineAI onClose={() => setShowBuslineAI(false)} context={aiRegionContext}
          disabled={isSearching || (showMinigameModal && gameState !== 'menu')} searchProgress={aiSearchProgress} onApply={applyAILines} />}
      </AnimatePresence>

      <header className="fixed top-0 left-0 right-0 z-20 px-4 pt-5 pb-0 pointer-events-none">
        {!isAnswering && !isDrawingMode && (
          <div className="flex items-start justify-between gap-4 w-full h-[46px]">
            {/* Pure Material 3 Search Bar (without logo, slightly narrower) */}
            <div ref={searchContainerRef} className={`backdrop-blur-xl bg-m3-surface/95 border border-m3-outline-variant/40 shadow-sm flex items-center h-[46px] pointer-events-auto transition-all duration-300 ease-out overflow-visible ${isMobileSearchOpen ? 'absolute left-4 right-4 md:relative md:left-auto md:right-auto md:w-[280px] rounded-full z-30' : 'relative w-[180px] sm:w-[240px] md:w-[280px] rounded-full'}`}>

              {/* Search Lead Icon */}
              <div className="flex items-center justify-center pl-4 pr-1.5 shrink-0 text-m3-primary">
                <Search className="w-4.5 h-4.5 text-[#52796F]" />
              </div>

              {/* Input Field Area */}
              <div className="flex-1 flex items-center overflow-hidden h-full pl-1 pr-2">
                <input 
                  type="text" 
                  placeholder={(!enableCityWideSearch && zoomLevel < 12) ? t('searchHint') : t('searchPlaceholder')} 
                  className="bg-transparent border-none outline-none text-xs sm:text-sm font-medium text-slate-800 w-full placeholder:text-[#7A8E83] h-full"
                  value={searchQuery}
                  onChange={(e) => onSearchInputChange(e.target.value)}
                  role="combobox"
                  aria-label="搜索线路或地点"
                  aria-autocomplete="list"
                  aria-expanded={showSuggestions}
                  aria-controls="search-suggestions"
                  onFocus={() => { searchActiveRef.current = true; if (searchQuery.trim()) onSearchInputChange(searchQuery); }}
                  onCompositionStart={() => { searchComposingRef.current = true; searchIdRef.current++; if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); }}
                  onCompositionEnd={e => { searchComposingRef.current = false; onSearchInputChange(e.currentTarget.value); }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || searchComposingRef.current || e.keyCode === 229) return;
                    if (e.key === 'Escape') { dismissSearchSuggestions(); return; }
                    if (e.key === 'Enter') {
                      if (suggestions.length > 0 && showSuggestions) {
                        handleManualSearch(suggestions[0]);
                      } else {
                        performFullSearch(searchQuery);
                      }
                      setIsMobileSearchOpen(false);
                    }
                  }}
                  autoFocus={isMobileSearchOpen}
                />
                {searchQuery && (
                  <button 
                    onMouseDown={(e) => { 
                      e.preventDefault();
                      handleClear();
                    }} 
                    className="px-1.5 shrink-0 h-full flex items-center text-[#7A8E83] hover:text-slate-800"
                    title="清空搜索"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Suggestions Dropdown - Material 3 Floating Card */}
              <AnimatePresence>
                {showSuggestions && searchQuery.trim().length > 0 && (
                  <motion.div
                    id="search-suggestions" role="listbox" aria-busy={suggestionsLoading}
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 280 }}
                    className="absolute top-[calc(100%+8px)] left-0 right-0 bg-m3-surface/98 backdrop-blur-2xl border border-m3-outline-variant/40 rounded-3xl shadow-xl overflow-hidden py-2 z-50 pointer-events-auto"
                  >
                    {suggestionsLoading && <p role="status" className="px-5 py-3 text-xs text-slate-500">正在查找…</p>}
                    {!suggestionsLoading && suggestions.length === 0 && <p role="status" className="px-5 py-3 text-xs text-slate-500">暂无匹配结果，可按回车继续搜索</p>}
                    {suggestions.slice(0, 6).map((tip, idx) => (
                      <button
                        key={idx}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => handleManualSearch(tip)}
                        className="w-full px-5 py-3.5 text-left hover:bg-m3-primary/8 transition-colors flex flex-col gap-0.5 relative border-b border-m3-outline-variant/15 last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">{tip.name}</span>
                          {tip.isAggregated && (
                            <span className="px-2 py-0.5 rounded-full bg-m3-primary-container text-[8px] font-bold text-m3-on-primary-container border border-m3-outline/10">
                              汇总
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border border-m3-outline/10 whitespace-nowrap shrink-0 ${getSuggestionKind(tip) === 'station' ? 'bg-m3-primary-container text-m3-on-primary-container' : getSuggestionKind(tip) === 'line' ? 'bg-m3-secondary-container text-m3-on-secondary-container' : 'bg-m3-surface-container text-slate-500'}`}>
                            {getSuggestionKind(tip) === 'station' ? '站点' : getSuggestionKind(tip) === 'line' ? '线路' : '地点'}
                          </span>
                          {(tip.isUserSubmitted || tip.type === 'userLine') && (
                            <span className="px-2 py-0.5 rounded-full bg-m3-tertiary-container text-[8px] font-bold text-m3-on-tertiary-container border border-m3-outline/10 whitespace-nowrap">
                              用户
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-slate-500">{tip.district || tip.address}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Quick Actions Container - Material Design 3 (Stations and Basemap moved to bottom hub) */}
            <div className={`mr-16 flex items-center gap-2 transition-opacity duration-300 ${isMobileSearchOpen ? 'opacity-0 md:opacity-100 pointer-events-none md:pointer-events-auto' : 'opacity-100'}`}>

              {/* Custom Draw Mode Paintbrush FAB - hidden when showUserSubmittedData is disabled */}
              {showUserSubmittedData && (
                <div className="pointer-events-auto shrink-0">
                  <button 
                    onClick={() => {
                      setIsDrawingMode(true);
                      setDrawnPoints([]);
                      setUndoStack([]);
                      setRedoStack([]);
                      setSelectedPointIdx(null);
                      setShowExitConfirm(false);
                      setIsBoxSelectMode(false);
                      setBoxSelectedStops([]);
                    }}
                    className="backdrop-blur-md bg-m3-surface/90 border border-m3-outline-variant/30 w-[42px] h-[42px] rounded-2xl shadow-sm flex items-center justify-center text-slate-700 hover:bg-m3-surface-container-high hover:scale-105 transition-all duration-200 active:scale-90 group"
                    title="进入线路绘制模式"
                  >
                    <Paintbrush className="w-4.5 h-4.5 text-slate-700 group-hover:text-m3-primary transition-transform group-hover:scale-110" />
                  </button>
                </div>
              )}

              {/* Admin-only buttons if verified */}
              {isAdminVerified && (
                <>
                  {/* Audit Review FAB */}
                  <div className="pointer-events-auto shrink-0">
                    <button 
                      onClick={() => {
                        setShowAuditModal(p => !p);
                        setShowManageModal(false);
                        fetchPendingSubmissions();
                      }}
                      className={`backdrop-blur-md border border-m3-outline-variant/30 w-[42px] h-[42px] rounded-2xl shadow-sm flex items-center justify-center transition-all duration-200 active:scale-90 group ${showAuditModal ? 'bg-amber-600 text-white hover:scale-105' : 'bg-m3-surface/90 text-amber-700 hover:bg-m3-surface-container-high hover:scale-105'}`}
                      title="自绘线路待审核中心"
                    >
                      <ClipboardCheck className="w-4.5 h-4.5 transition-transform group-hover:scale-110" />
                    </button>
                  </div>

                  {/* Data Management FAB */}
                  <div className="pointer-events-auto shrink-0">
                    <button 
                      onClick={() => {
                        setShowManageModal(p => !p);
                        setShowAuditModal(false);
                        fetchApprovedLines();
                      }}
                      className={`backdrop-blur-md border border-m3-outline-variant/30 w-[42px] h-[42px] rounded-2xl shadow-sm flex items-center justify-center transition-all duration-200 active:scale-90 group ${showManageModal ? 'bg-m3-primary text-m3-on-primary hover:scale-105' : 'bg-m3-surface/90 text-slate-700 hover:bg-m3-surface-container-high hover:scale-105'}`}
                      title="批量管理已发布的用户数据"
                    >
                      <Database className="w-4.5 h-4.5 transition-transform group-hover:scale-110" />
                    </button>
                  </div>
                </>
              )}

              {/* Minigame FAB */}
              <div className="pointer-events-auto shrink-0">
                <button 
                  onClick={() => {
                    setGameMode(null);
                    setGameState('menu');
                    void warmLadderBoards('line', leaderboardScope('line'));
                    setShowMinigameModal(true);
                  }}
                  className="backdrop-blur-md bg-m3-surface/90 border border-m3-outline-variant/40 w-[42px] h-[42px] rounded-2xl shadow-sm flex items-center justify-center text-slate-700 hover:bg-m3-surface-container-high hover:text-m3-primary hover:scale-105 transition-all duration-200 active:scale-90 group"
                  title="小游戏：公交猜一猜"
                >
                  <Gamepad2 className="w-4.5 h-4.5 transition-transform group-hover:rotate-12 duration-300" />
                </button>
              </div>

              {(timelineAvailable || viewportStats.lines > 0 || showTimeline) && !isSearching && !loading && !isDrawingMode && !showMinigameModal && (
                <button type="button" aria-pressed={showTimeline} aria-label="时间轴" title="时间轴" onClick={() => void openTimeline()} className={`pointer-events-auto shrink-0 w-[42px] h-[42px] rounded-2xl border border-m3-outline-variant/40 shadow-sm flex items-center justify-center transition-all active:scale-95 ${showTimeline ? 'bg-m3-primary text-white' : 'bg-m3-surface/95 text-m3-primary'}`}>
                  <Clock className="w-4.5 h-4.5" />
                </button>
              )}
              {!showMinigameModal && <button type="button" aria-label="公交路线规划" title="公交路线规划" aria-pressed={showBusPlanner}
                onClick={() => { setShowBusPlanner(true); setShowBuslineAI(false); }}
                className="pointer-events-auto fixed bottom-36 right-4 flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl border border-m3-outline-variant/40 bg-m3-surface/95 text-m3-primary shadow-sm transition-transform active:scale-95 sm:static">
                <Route className="h-4.5 w-4.5" />
              </button>}
              <div className="pointer-events-auto shrink-0">
                <button onClick={() => { setShowBuslineAI(prev => !prev); setShowBusPlanner(false); }} title="Busline AI" aria-label="打开 Busline AI"
                  className="backdrop-blur-md bg-m3-primary-container/95 text-m3-on-primary-container border border-m3-outline-variant/40 w-[42px] h-[42px] rounded-2xl shadow-sm flex items-center justify-center hover:scale-105 transition-all duration-200 active:scale-95">
                  <Sparkles className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>
          </div>
        )}


      </header>

      {nearbyPanel && !showMinigameModal && onboardingStep===0 && !activeBusLine && !selectedStop && <NearbyRoutes state={nearbyPanel}
        onClose={()=>{locationRequestRef.current++;nearbyRequestRef.current?.abort();setNearbyPanel(null);}} onRetry={handleLocate}
        onSelect={({ city, line }) => void handleManualSearch({ name: line.name, routeId: line.id, sourceCity: city, type: 'busline' })} />}
      <CityUploadDialog data={pendingCityUpload} busy={cityUploadBusy} progress={cityUploadProgress} error={cityUploadError}
        onSubmit={() => void submitCityUpload()} onClose={() => { if (!cityUploadBusy) setPendingCityUpload(null); }} />
      {!loading && !showMinigameModal && onboardingStep===0 && <MapActivityIndicator raised={showMoreInfo} progress={searchProgress} mode={searchActivity==='manual'||(isSearching&&searchActivity!=='auto')?'search':searchActivity==='auto'?'city':null} />}
      <CityUpdateStatus job={cityUpdateJob} onClose={() => { cityJobWatchRef.current?.abort(); setCityUpdateJob(null); }} />
      {cityDataNotice && !cityUpdateJob && !isSearching && <div role="status" className="absolute top-24 left-4 sm:left-6 z-30 max-w-sm rounded-2xl bg-m3-surface/95 border border-m3-outline-variant/40 p-4 shadow-lg flex items-center gap-3">
        <div className="text-xs text-slate-600"><p className="font-bold text-slate-800 mb-1">{cityDataNotice.city}</p>
          {cityDataNotice.kind === 'expired' ? '共享线路已超过两个月或尚不完整，请全市检索更新。'
            : cityDataNotice.kind === 'busy' ? '已有城市更新任务，请稍后再试。'
            : cityDataNotice.kind === 'unavailable' ? '暂时无法读取共享线路，您仍可手动进行全市检索。' : '暂无可用的全市线路，请检索后共享给其他用户。'}</div>
        <button type="button" aria-label="全市检索" title="全市检索" onClick={() => void handleSearch(true)} className="p-3 shrink-0 rounded-full bg-m3-primary text-m3-on-primary"><Search className="w-5 h-5" /></button>
        <button type="button" aria-label="关闭城市数据提示" onClick={() => setCityDataNotice(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
      </div>}

      <main className="relative flex-1">
        <div className="relative w-full h-full">
          <CityOverviewLayer map={mapInstance} enabled={!showTimeline && !showMinigameModal} detailReady={viewportDetailReady} />
          <ViewportTransitLayer map={mapInstance}
            enabled={sharedCityDataEnabled && !showTimeline && !showMinigameModal}
            stationMode={stationMode} thick={lineThickness === 'thick'} stationLineStats={stationLineStats}
            subdued={!!activeBusLine || coverageActive || timelineAvailable}
            blocked={viewportLineBlocked} selection={viewportSelectionRef} onStats={setViewportStats} onDetailReady={setViewportDetailReady} />
          <div ref={containerRef} className="w-full h-full bg-white shadow-inner" id="amap-container" />

          {isBoxSelectMode && (
            <div 
              onMouseDown={handleBoxSelectMouseDown}
              onMouseMove={handleBoxSelectMouseMove}
              onMouseUp={handleBoxSelectMouseUp}
              className="absolute inset-0 z-10 cursor-crosshair select-none"
            >
              {isBoxSelecting && boxSelectStartPos && boxSelectEndPos && (
                <div 
                  className="absolute border-2 border-dashed border-m3-primary bg-m3-primary/10 rounded pointer-events-none"
                  style={{
                    left: Math.min(boxSelectStartPos.x, boxSelectEndPos.x),
                    top: Math.min(boxSelectStartPos.y, boxSelectEndPos.y),
                    width: Math.abs(boxSelectEndPos.x - boxSelectStartPos.x),
                    height: Math.abs(boxSelectEndPos.y - boxSelectStartPos.y),
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* Custom Drawing Mode Left Sidebar for Stations (Requirement 2) */}
        {isDrawingMode && drawnPoints.length > 0 && (
          <div className="absolute top-24 left-4 z-20 w-[240px] md:w-[260px] max-h-[calc(100vh-240px)] bg-slate-900/95 backdrop-blur-2xl border border-slate-700/80 text-white shadow-[0_20px_50px_rgba(0,0,0,0.4)] rounded-[24px] overflow-hidden flex flex-col pointer-events-auto border-t border-t-slate-800 animate-in fade-in slide-in-from-left-4 duration-300">
            {/* Header */}
            <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-lg bg-emerald-500 flex items-center justify-center text-white">
                  <List className="w-3.5 h-3.5" />
                </div>
                <span className="font-black text-[13px] text-slate-100 tracking-tight">站点</span>
              </div>
              <span className="text-[10px] font-black text-emerald-400 bg-emerald-950/60 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                {drawnPoints.filter(p => p.isStop).length} 站
              </span>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1.5 scroll-smooth text-slate-100">
              {(() => {
                let stopCounter = 0;
                return drawnPoints.map((pt, idx) => {
                  if (!pt.isStop) return null;
                  stopCounter++;
                  const currentStopNum = stopCounter;
                  const isSelected = selectedPointIdx === idx;

                  return (
                    <div
                      key={pt.id || idx}
                      onClick={() => {
                        setSelectedPointIdx(idx);
                        if (mapInstance) {
                          mapInstance.setCenter([pt.lng, pt.lat]);
                        }
                      }}
                      className={`group flex items-center justify-between p-2.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm'
                          : 'bg-slate-900/40 hover:bg-slate-800/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {/* Circle Stop indicator with order index number */}
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-5 h-5 rounded-full font-black text-[10px] flex items-center justify-center shrink-0 transition-transform ${
                          isSelected
                            ? 'bg-emerald-500 text-white shadow-sm scale-110'
                            : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:scale-105'
                        }`}>
                          {currentStopNum}
                        </div>

                        <div className="flex flex-col min-w-0">
                          <span className={`text-[11px] font-black leading-tight tracking-tight truncate ${isSelected ? 'text-emerald-300' : 'text-slate-200'}`}>
                            {pt.name || `站点${currentStopNum}`}
                          </span>
                          <span className="text-[8px] text-slate-500 font-mono tracking-tighter truncate leading-none mt-0.5">
                            {pt.lng.toFixed(5)}, {pt.lat.toFixed(5)}
                          </span>
                        </div>
                      </div>

                      {/* Actions on hover/select */}
                      <div className="flex items-center gap-0.5 shrink-0 pl-1">
                        {/* Loop close shortcut */}
                        {idx === 0 && drawnPoints.length >= 2 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseLoop();
                            }}
                            className="w-6.5 h-6.5 flex items-center justify-center text-orange-400 hover:text-orange-300 hover:bg-orange-950/50 rounded-lg transition-colors"
                            title="闭合交路（创建环线）"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="stroke-current" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                            </svg>
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setNamingStopIdx(idx);
                            setNamingValue(pt.name || '');
                          }}
                          className="w-6.5 h-6.5 flex items-center justify-center text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          title="修改站点名称"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {boxSelectedStops.length > 0 && (
          <div className="absolute top-24 left-4 z-40 w-[calc(100vw-32px)] md:w-[340px] max-h-[45vh] md:max-h-[calc(100vh-140px)] backdrop-blur-2xl bg-white/95 border border-slate-200/60 shadow-2xl rounded-3xl overflow-hidden flex flex-col pointer-events-auto animate-in fade-in slide-in-from-left-4 duration-300">
            {/* Minimalist Header without titles/subtexts */}
            <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div 
                onClick={() => setIsBoxPanelCollapsed(!isBoxPanelCollapsed)}
                className="flex items-center gap-2 cursor-pointer flex-1 select-none"
              >
                <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
                  <BoxSelect className="w-4 h-4" />
                </div>
                <span className="font-black text-xs text-slate-600 tracking-tight">统计</span>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setBoxSelectedStops([])}
                  className="p-1 px-2.5 rounded-full hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 text-xs font-black transition-colors"
                >
                  清除
                </button>
                <button 
                  onClick={() => setIsBoxPanelCollapsed(!isBoxPanelCollapsed)}
                  className="p-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200/60 text-slate-500 text-xs font-bold transition-all"
                >
                  {isBoxPanelCollapsed ? "展开" : "收起"}
                </button>
              </div>
            </div>

            {!isBoxPanelCollapsed && (
              <>
                {/* Counts Stats Row (Swapped order: Lines first, Stops second) */}
                <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/20 text-center py-2.5">
                  <div>
                    <span className="block text-lg font-black text-blue-600 leading-none">{boxSelectedLines.length}</span>
                    <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase mt-1 inline-block">线路</span>
                  </div>
                  <div>
                    <span className="block text-lg font-black text-slate-800 leading-none">{mergedSelectedStops.length}</span>
                    <span className="text-[9px] font-bold text-slate-400 tracking-wider uppercase mt-1 inline-block">站点</span>
                  </div>
                </div>

                {/* Scrollable Contents */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">

                  {/* Swapped List 1: Selected Stops now in Grid Button format */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2 px-1">
                      <div className="w-1.5 h-3 bg-m3-error rounded-full" />
                      <span className="text-xs font-black text-slate-700">站点 ({mergedSelectedStops.length})</span>
                    </div>
                    {mergedSelectedStops.length === 0 ? (
                      <p className="text-xs text-slate-400 italic px-1 py-1.5">无站点</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                        {mergedSelectedStops.map((stop: any) => {
                          return (
                            <button
                              key={stop.key}
                              onClick={(e) => {
                                if (e.ctrlKey || e.metaKey) {
                                  removeBoxStops(stop.keys);
                                } else {
                                  if (mapRef.current) {
                                    const latlng = getLatLng(stop.location);
                                    mapRef.current.setCenter(latlng);
                                    mapRef.current.setZoom(17);
                                    setSelectionPos(latlng);
                                  }
                                }
                              }}
                              className="w-full text-left p-2 rounded-xl border border-slate-100 bg-white hover:border-m3-error/30 hover:bg-m3-error-container/20 transition-all flex flex-col gap-0.5 shadow-sm active:scale-95 group relative"
                            >
                              <div className="flex items-center gap-1 pr-3 min-w-0">
                                <MapPin className="w-3 h-3 text-m3-error shrink-0" />
                                <span className="font-black text-[11px] text-slate-800 group-hover:text-m3-error truncate leading-none">
                                  {stop.name}
                                </span>
                              </div>
                              <span className="text-[9px] text-slate-400 font-medium truncate w-[130px]">
                                {stop.lines?.length || 0} 条线路
                              </span>
                              <span 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeBoxStops(stop.keys);
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-100 text-slate-300 hover:text-m3-error transition-all"
                                title="移除"
                              >
                                <X className="w-3.5 h-3.5" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Swapped List 2: Contained Lines now in Spacious Vertical Card list format */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2 px-1">
                      <div className="w-1.5 h-3 bg-blue-500 rounded-full" />
                      <span className="text-xs font-black text-slate-700">线路 ({boxSelectedLines.length})</span>
                    </div>
                    {boxSelectedLines.length === 0 ? (
                      <p className="text-xs text-slate-400 italic px-1 py-2">所选站点内无公交线路</p>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                        {boxSelectedLines.map((lineName: string) => {
                          const info = parseLineInfo(lineName);
                          const isUserSub = fetchedLinesCache.current.get(lineName)?.isUserSubmitted || approvedUserLines.some(ul => ul.name === lineName);
                          return (
                            <div
                              key={lineName}
                              onClick={() => handleManualSearch({ name: lineName, type: 'busline',
                                sourceCity: boxSelectedStops.find(stop => stop.key.startsWith('tile:') && stop.lines.includes(lineName))?.city })}
                              className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100/50 hover:bg-slate-100 hover:border-slate-200 transition-all cursor-pointer group"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Bus className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-black text-[11px] text-slate-800 truncate block leading-none">
                                      {info.name}
                                    </span>
                                    {isUserSub && (
                                      <span className="px-1 py-0.5 rounded bg-purple-50 text-[8px] font-bold text-[#BA55D3] border border-purple-100 scale-90 origin-left">
                                        用户
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[9px] text-slate-400 font-medium truncate block mt-0.5 leading-none">
                                    {info.start !== '-' ? `${info.start} ⇌ ${info.end}` : '双向 / 环线'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {boxSelectedLines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void showStopConnectivity(boxSelectedLines)}
                        disabled={coverageBusy || isSearching}
                        className="w-full mt-3 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-4 h-4" />
                        查看通达度 ({boxSelectedLines.length}条线路)
                      </button>
                    )}
                  </div>

                </div>
              </>
            )}
          </div>
        )}





        {showTimeline && <TimelineBar minute={timelineMinute} onChange={minute => { setTimelinePlaying(false); setTimelineMinute(minute); setSelectedSegmentLines(null); setSelectedStop(null); }} onClose={() => setShowTimeline(false)} onTogglePlayback={() => setTimelinePlaying(value => !value)} playing={timelinePlaying}
          active={timelineActiveCount} total={timelineLines.length} />}

        {/* Custom Drawing Mode HUD Floating Toolbar Panel */}
        {isDrawingMode && (
          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-30 w-[95%] max-w-3xl backdrop-blur-2xl bg-slate-900/95 text-white border border-slate-700/80 rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col md:flex-row items-center justify-between gap-4 pointer-events-auto">
            {/* Left instructions or stats */}
            <div className="flex items-center gap-3">
              <button
                onClick={openNoticeManually}
                className="backdrop-blur-md bg-slate-800 hover:bg-slate-700/80 border border-slate-700/80 p-2 rounded-xl text-emerald-400 hover:text-emerald-300 transition-all active:scale-95 flex items-center justify-center shrink-0"
                title="查看绘制功能提示"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">绘制模式</span>
                <span className="text-xs font-bold text-slate-200">
                  {drawnPoints.length === 0 
                    ? '点击地图即可绘制' 
                    : `已绘: ${drawnPoints.length}点 | 站台: ${drawnPoints.filter(p => p.isStop).length}个`
                  }
                </span>
              </div>
            </div>

            {/* Button groups */}
            <div className="flex items-center flex-wrap gap-2 md:gap-2.5">
              <button
                onClick={() => setShowHistoryModal(true)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold hover:bg-slate-700 active:scale-95 transition-all text-slate-300"
                title="查看历史提交"
              >
                查看历史提交
              </button>

              {/* Mode Switcher Group */}
              <div className="flex items-center bg-slate-850 border border-slate-800 rounded-xl p-0.5 shadow-inner shrink-0">
                <button
                  type="button"
                  onClick={() => setDrawingSubMode('snap')}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1 text-xs font-black transition-all ${
                    drawingSubMode === 'snap'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                  title="智能吸附：沿道路智能寻路吸附"
                >
                  <Magnet className="w-3.5 h-3.5" />
                  <span>智能吸附</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawingSubMode('straight')}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1 text-xs font-black transition-all ${
                    drawingSubMode === 'straight'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                  title="直线：点击位置直接连直线"
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>直线</span>
                </button>
              </div>

              <button
                onClick={handleAddStopAtSelected}
                disabled={selectedPointIdx === null}
                className="p-2.5 rounded-xl bg-blue-600/95 text-white border border-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
                title={selectedPointIdx !== null && drawnPoints[selectedPointIdx]?.isStop ? '修改站点名称' : '设为站点并命名'}
              >
                <MapPin className="w-4 h-4" />
              </button>

              <button
                onClick={handleOpenSubmitDialog}
                disabled={drawnPoints.length < 2}
                className="p-2.5 rounded-xl bg-emerald-600 text-white border border-emerald-500 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all shrink-0"
                title="提交路线"
              >
                <Check className="w-4 h-4" />
              </button>

              {showExitConfirm ? (
                <div className="flex items-center gap-1 bg-m3-error-container/20 border border-m3-error/20 p-1 rounded-xl shrink-0">
                  <span className="text-[9px] font-black text-m3-error px-1">确认退出?</span>
                  <button
                    onClick={() => {
                      setIsDrawingMode(false);
                      setDrawnPoints([]);
                      setUndoStack([]);
                      setRedoStack([]);
                      setSelectedPointIdx(null);
                      setShowExitConfirm(false);
                    }}
                    className="px-2 py-1 bg-m3-error hover:opacity-90 text-white font-black text-[9px] rounded-lg transition-all text-center leading-none"
                  >
                    确认
                  </button>
                  <button
                    onClick={() => setShowExitConfirm(false)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[9px] rounded-lg transition-all text-center leading-none"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (drawnPoints.length === 0) {
                      setIsDrawingMode(false);
                      setDrawnPoints([]);
                      setUndoStack([]);
                      setRedoStack([]);
                      setSelectedPointIdx(null);
                    } else {
                      setShowExitConfirm(true);
                    }
                  }}
                  className="p-2.5 rounded-xl bg-m3-error-container/20 text-m3-error border border-m3-error/30 hover:bg-m3-error-container/40 active:scale-95 transition-all shrink-0"
                  title="退出"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}

              {/* 上一步和下一步放到最边缘并且为一个模块里 */}
              <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl divide-x divide-slate-700 overflow-hidden shrink-0 ml-auto select-none">
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="p-2 md:p-2.5 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title="上一步"
                >
                  <Undo className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="p-2 md:p-2.5 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title="下一步"
                >
                  <Redo className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Naming Station Overlay Pop-up Modal */}
        {namingStopIdx !== null && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/20 backdrop-blur-sm pointer-events-auto">
            <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl w-full max-w-sm flex flex-col gap-4 text-white">
              <h3 className="text-base font-black tracking-tight text-center">修改站点名称</h3>
              <input
                type="text"
                placeholder="输入站点名称"
                value={namingValue}
                onChange={e => setNamingValue(e.target.value)}
                className="px-4 py-3 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none focus:border-blue-500 text-xs font-bold w-full"
                autoFocus
              />
              <div className="flex justify-end gap-3.5 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setNamingStopIdx(null);
                    setNamingValue('');
                  }}
                  className="px-4 py-2 border border-slate-700 rounded-xl hover:bg-slate-800 text-xs text-slate-300 font-bold"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveStopName}
                  className="px-5 py-2 rounded-xl bg-emerald-600 border border-emerald-500 hover:bg-emerald-500 text-xs text-white font-black shadow-lg shadow-emerald-500/15"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Submission Info Form Modal */}
        {showSubmitModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm pointer-events-auto">
            <div className="bg-slate-900 border border-slate-700 px-6 py-6 rounded-[2.5rem] shadow-2xl w-full max-w-sm flex flex-col gap-4 text-white">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="text-base font-black tracking-tight">提交线路</h3>
              </div>
              <p className="text-xs text-slate-400">
                请填写以下发布信息以提交审核：
              </p>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 w-full">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400">城市</label>
                    <input
                      type="text"
                      value={submitCity}
                      onChange={e => setSubmitCity(e.target.value)}
                      className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none text-xs font-bold w-full"
                    />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400">辖区</label>
                    <input
                      type="text"
                      value={submitDistrict}
                      onChange={e => setSubmitDistrict(e.target.value)}
                      className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none text-xs font-bold w-full"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400">线路名称 (必填)</label>
                  <input
                    type="text"
                    placeholder="如：923路"
                    value={submitLineName}
                    onChange={e => setSubmitLineName(e.target.value)}
                    className="px-3 py-2.5 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none focus:border-emerald-500 text-xs font-bold placeholder:text-slate-500 w-full"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400">署名 (必填)</label>
                  <input
                    type="text"
                    placeholder="您的昵称"
                    value={submitUserNickname}
                    onChange={e => setSubmitUserNickname(e.target.value)}
                    className="px-3 py-2.5 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none focus:border-emerald-500 text-xs font-bold placeholder:text-slate-500 w-full"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400">数据来源 (可选)</label>
                  <textarea
                    placeholder="例如：线路方案公示网站链接、公交迷公告网址"
                    value={submitDataSourceText}
                    onChange={e => setSubmitDataSourceText(e.target.value)}
                    className="px-3 py-1.5 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none focus:border-emerald-500 text-[11px] font-bold placeholder:text-slate-500 w-full h-12 resize-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 flex items-center justify-between">
                    <span>上传数据来源文件 (可选)</span>
                    {submitDataSourceImages.length > 0 && (
                      <button 
                        type="button" 
                        onClick={() => setSubmitDataSourceImages([])}
                        className="text-[9px] text-m3-error hover:opacity-80 font-bold"
                      >
                        清除所有图片 ({submitDataSourceImages.length}/5)
                      </button>
                    )}
                  </label>

                  {/* Grid of uploaded image previews */}
                  {submitDataSourceImages.length > 0 && (
                    <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                      {submitDataSourceImages.map((imgBase64, idx) => (
                        <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-900 group">
                          <img 
                            src={imgBase64} 
                            alt={`Preview ${idx + 1}`} 
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setSubmitDataSourceImages(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="absolute top-1 right-1 p-0.5 bg-m3-error hover:opacity-90 rounded-full text-white cursor-pointer shadow-md transition"
                            title="删除图片"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      id="data-source-image-file"
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) {
                          const newTotal = submitDataSourceImages.length + files.length;
                          if (newTotal > 5) {
                            alert(`本次最多只能上传5张图片（当前已添加${submitDataSourceImages.length}张，您又选择了${files.length}张）`);
                          }
                          const sliceCount = Math.max(0, 5 - submitDataSourceImages.length);
                          const allowedFiles = files.slice(0, sliceCount);

                          try {
                            setLoading(true);
                            const promises = allowedFiles.map(file => compressImageToBase64(file as File));
                            const compressedList = await Promise.all(promises);
                            setSubmitDataSourceImages(prev => [...prev, ...compressedList]);
                            setLoading(false);
                          } catch (err) {
                            setLoading(false);
                            alert('图片文件读取失败，请检查文件类型。');
                          }
                        }
                      }}
                    />
                    <label
                      htmlFor="data-source-image-file"
                      className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 border-dashed rounded-xl text-center text-[10px] font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      添加图片 (已添加 {submitDataSourceImages.length} / 5)
                    </label>
                  </div>
                  <span className="text-[9px] text-slate-500 leading-tight">
                    说明：上传数据来源（例如多张线路公告、站台公示照片等）可让线路上传审核更易通过
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-2">
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2 border border-slate-700 rounded-xl hover:bg-slate-800 text-xs text-slate-300 font-bold"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmitSubmission}
                  className="px-5 py-2 rounded-xl bg-emerald-600 border border-emerald-500 hover:bg-emerald-500 text-xs text-white font-black shadow-lg shadow-emerald-500/15"
                >
                  提交
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Use Drawing Guidelines Tips Notice Modal */}
        {showDrawNotice && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 backdrop-blur-md pointer-events-auto">
            <div className="bg-slate-900 border border-slate-700 p-6 md:p-8 rounded-[2.5rem] shadow-2xl w-full max-w-sm md:max-w-md flex flex-col gap-5 text-white animate-in fade-in duration-200">
              <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                <Info className="w-5 h-5 text-emerald-400 shrink-0" />
                <h3 className="text-base font-black tracking-tight text-slate-100">使用绘制功能提示</h3>
              </div>

              <div className="flex flex-col gap-4 text-xs font-medium text-slate-300 leading-relaxed">
                <div className="flex gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-slate-400 shrink-0 font-bold text-[10px]">1</span>
                  <p>请规范绘制，不得绘制违法、违规的不良信息，否则审核将不予通过并追究责任。</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-slate-400 shrink-0 font-bold text-[10px]">2</span>
                  <p>请勿短期内恶意大量绘制无效线路，否则用户将被禁止使用该功能。</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-slate-400 shrink-0 font-bold text-[10px]">3</span>
                  <p>该功能当前为测试功能，若您遇到使用上的问题，可通过微信公众号<strong className="text-emerald-400 font-black">“巴士线路图”</strong>进行反馈。</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-800 pt-4 mt-1">
                <button
                  type="button"
                  disabled={noticeCountdown > 0}
                  onClick={() => {
                    setShowDrawNotice(false);
                    localStorage.setItem('has_seen_draw_notice', 'true');
                  }}
                  className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all w-full text-center flex items-center justify-center gap-2 select-none
                    ${noticeCountdown > 0 
                      ? 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed' 
                      : 'bg-emerald-600 border border-emerald-500 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/15 active:scale-95'}`}
                >
                  {noticeCountdown > 0 ? `了解并同意 (${noticeCountdown}s)` : '了解并进入'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* User Submission Local & Net Status History Modal */}
        {showHistoryModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm pointer-events-auto">
            <div className="bg-slate-900 border border-slate-700 px-6 py-6 rounded-[2.5rem] shadow-2xl w-full max-w-lg h-[460px] flex flex-col text-white">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <h3 className="text-base font-black tracking-tight">自绘历史提交</h3>
                </div>
                <button 
                  onClick={() => setShowHistoryModal(false)}
                  className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5">
                {historicalSubmissions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12 gap-1.5 text-xs">
                    <span>暂无提交记录</span>
                    <span className="text-[10px] text-slate-600">点击画笔按钮可在地图绘制线路。</span>
                  </div>
                ) : (
                  historicalSubmissions.map((hist) => {
                    const status = submissionStatuses[hist.id] || hist.status || 'pending';
                    return (
                      <div key={hist.id} className="p-3.5 bg-slate-800/80 border border-slate-700/50 rounded-xl flex items-center justify-between gap-3 text-xs">
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-white text-sm">{hist.name}</span>
                            <span className="text-[10px] text-slate-400">By {hist.creatorNickname}</span>
                          </div>
                          <span className="text-[10px] text-slate-300 font-medium truncate">
                            途经: {(hist.via_stops || []).map((vs: any) => vs.name).join(' → ')}
                          </span>
                          {status === 'rejected' && (hist.rejectReason || submissionStatuses[hist.id + '_reason']) && (
                            <span className="text-[10px] text-m3-error font-bold bg-m3-error-container/20 px-2 py-1 rounded border border-m3-error/25 block mt-0.5 max-w-full break-words">
                              未通过原因: {hist.rejectReason || submissionStatuses[hist.id + '_reason']}
                            </span>
                          )}
                          <span className="text-[9px] text-slate-500">
                            城市: {hist.city} {hist.district} • {new Date(hist.timestamp).toLocaleString()}
                          </span>
                        </div>

                        <div>
                          {status === 'approved' ? (
                            <span className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 text-[10px] font-black">
                              已通过
                            </span>
                          ) : status === 'rejected' ? (
                            <span className="px-2.5 py-1.5 rounded-lg bg-m3-error-container/20 text-m3-error border border-m3-error/25 text-[10px] font-black">
                              未通过 (已删)
                            </span>
                          ) : (
                            <span className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/25 text-[10px] font-black">
                              待审核
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Admin Login Modal Overlay Trigger */}
        {showAdminLogin && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/30 backdrop-blur-sm pointer-events-auto">
            <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl shadow-2xl w-full max-w-xs flex flex-col gap-4 text-white">
              <h3 className="text-sm font-black tracking-tight text-center">输入密码</h3>
              <input
                type="password"
                placeholder="密码"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                className="px-4 py-2.5 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none focus:border-blue-500 text-xs font-bold"
                onKeyDown={e => e.key === 'Enter' && handleAdminLoginVerify()}
              />
              <div className="flex justify-end gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminLogin(false);
                    setAdminPassword('');
                  }}
                  className="px-4 py-2 border border-slate-700 rounded-xl hover:bg-slate-800 text-xs text-slate-300 font-bold"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAdminLoginVerify}
                  className="px-5 py-2 rounded-xl bg-blue-600 border border-blue-500 hover:bg-blue-500 text-xs text-white font-black"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Admin Review Dashboard Overlay Panel */}
        {showAuditModal && (
          <div className="fixed top-20 right-4 z-[100] flex flex-col pointer-events-auto w-[400px] h-[550px] max-w-[calc(100vw-32px)]">
            <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 p-5 rounded-3xl shadow-2xl flex flex-col text-white h-full">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <h3 className="text-sm font-black tracking-tight">审核</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => fetchPendingSubmissions()}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-300 text-[10px] font-bold"
                  >
                    刷新
                  </button>
                  <button 
                    onClick={() => {
                      setShowAuditModal(false);
                      setRejectingSubId(null);
                      setRejectReasonValue('');
                    }}
                    className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 mb-2 shrink-0">
                提示：点击任意卡片即可在地图加载预览。
              </p>

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5">
                {pendingSubmissions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16 gap-2 text-xs">
                    <span>审核队列已全部清空 ✨</span>
                  </div>
                ) : (
                  pendingSubmissions.map((sub) => (
                    <div 
                      key={sub.id} 
                      onClick={() => handlePreviewLineOnMap(sub)}
                      className="p-3 bg-slate-850/80 border border-slate-850 hover:border-amber-500/50 rounded-xl flex flex-col gap-3 text-xs transition-all cursor-pointer hover:bg-slate-800 group relative"
                      title="点击进行地图预览"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-extrabold text-blue-400 text-sm truncate max-w-[170px]">{sub.name}</span>
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-700 text-[8px] font-black text-slate-300 shrink-0">
                            {sub.city} • {sub.district || '所有区'}
                          </span>
                        </div>
                        <div className="text-slate-400 text-[9px]">
                          投递：{sub.creatorNickname || '匿名'}
                        </div>
                        <div className="text-slate-300 text-[10px] line-clamp-2 leading-relaxed">
                          <span className="font-bold text-slate-400">途经站点: </span>
                          {sub.via_stops && sub.via_stops.length > 0 ? (
                            (sub.via_stops || []).map((vs: any) => vs.name).join(' → ')
                          ) : (
                            <span className="italic text-slate-500">仅有轨迹</span>
                          )}
                        </div>

                        {sub.dataSourceText && (
                          <div className="mt-1 p-2 rounded bg-slate-800/60 text-slate-300 text-[9px] border border-slate-750">
                            <span className="font-bold text-slate-450">数据来源: </span>
                            {sub.dataSourceText}
                          </div>
                        )}

                        {sub.dataSourceImage && (() => {
                          const imgs = parseDataSourceImages(sub.dataSourceImage);
                          if (imgs.length === 0) return null;
                          return (
                            <div className="mt-1.5" onClick={e => e.stopPropagation()}>
                              <span className="font-bold text-slate-400 block text-[9px] mb-1">照片凭证 ({imgs.length} 张):</span>
                              <div className="flex flex-wrap gap-1.5">
                                {imgs.map((imgSrc, imgIdx) => (
                                  <div key={imgIdx} className="relative group/pic overflow-hidden w-[60px] h-[60px] rounded-lg border border-slate-750 bg-slate-900 transition hover:border-emerald-500/50">
                                    <img 
                                      src={imgSrc} 
                                      alt={`Proof ${imgIdx + 1}`} 
                                      className="w-full h-full object-cover cursor-zoom-in"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const w = window.open();
                                        w?.document.write(`<html><body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center"><img src="${imgSrc}" style="max-width:100%;max-height:100%;object-fit:contain"/></body></html>`);
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {rejectingSubId === sub.id ? (
                        <div className="w-full flex flex-col gap-1.5 mt-1 bg-slate-900/80 p-2.5 rounded-xl border border-m3-error/30" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[9px] text-m3-error font-bold">退回因由 (可选)：</span>
                          <input 
                            type="text"
                            placeholder="请填写原因（例如：部分节点走向不够平滑）"
                            value={rejectReasonValue}
                            onChange={(e) => setRejectReasonValue(e.target.value)}
                            className="w-full px-2 py-1 bg-slate-850 text-white rounded-lg border border-slate-700 outline-none text-[10px] font-bold"
                            autoFocus
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setRejectingSubId(null);
                                setRejectReasonValue('');
                              }}
                              className="px-2 py-0.5 text-[9px] text-slate-400 hover:text-white"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => {
                                handleAdminAction(sub.id, 'reject', rejectReasonValue);
                                setRejectingSubId(null);
                                setRejectReasonValue('');
                              }}
                              className="px-2 py-0.5 text-[9px] bg-m3-error hover:opacity-90 text-white font-extrabold rounded-md shadow"
                            >
                              确认退回
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 justify-end shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRejectingSubId(sub.id);
                              setRejectReasonValue('');
                            }}
                            className="px-2.5 py-1.5 border border-m3-error/20 text-m3-error hover:bg-m3-error-container/15 rounded-lg font-bold transition-all text-[10px]"
                          >
                            拒绝
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAdminAction(sub.id, 'approve');
                            }}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 rounded-lg font-black transition-all text-[10px]"
                          >
                            批准发布
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Audit Status Notification Banner */}
        {notification && notification.show && (
          <div className="fixed top-20 right-4 z-[110] w-[320px] bg-slate-900 border border-emerald-500/40 p-4 rounded-2xl shadow-2xl flex flex-col gap-2.5 pointer-events-auto text-white">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>发布审核结果提醒</span>
              </div>
              <button 
                onClick={() => setNotification(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300 font-medium">
              您在 <span className="font-bold text-amber-300">{notification.timeStr}</span> 上传的线路：已通过审核 <span className="text-emerald-400 font-extrabold">{notification.approved}</span> 个，不通过 <span className="text-m3-error font-extrabold">{notification.rejected}</span> 个。
            </p>
            <button
              onClick={() => {
                setShowHistoryModal(true);
                setNotification(null);
              }}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 hover:border-emerald-400 text-white rounded-xl text-[10px] font-extrabold text-center cursor-pointer transition shadow shadow-emerald-600/20"
            >
              点击以查看详情
            </button>
          </div>
        )}

        {/* Admin Data Management Dashboard Overlay Panel */}
        {showManageModal && (
          <div className="fixed top-20 right-4 z-[100] flex flex-col pointer-events-auto w-[360px] h-[550px] max-w-[calc(100vw-32px)]">
            <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 p-5 rounded-3xl shadow-2xl flex flex-col text-white h-full">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  <h3 className="text-sm font-black tracking-tight">数据管理</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={fetchApprovedLines}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-300 text-[10px] font-bold"
                  >
                    刷新
                  </button>
                  <button 
                    onClick={() => {
                      setShowManageModal(false);
                      setEditingLineId(null);
                    }}
                    className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 mb-2 shrink-0">
                提示：点击任意卡片加载预览；支持编辑与删除。
              </p>

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                {approvedUserLines.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16 gap-2 text-xs">
                    <span>正式发布的线路列表为空</span>
                  </div>
                ) : (() => {
                  const groups: Record<string, any[]> = {};
                  approvedUserLines.forEach(line => {
                    const city = line.city || '其他城市';
                    if (!groups[city]) groups[city] = [];
                    groups[city].push(line);
                  });

                  return Object.entries(groups).map(([city, lines]) => {
                    const isCollapsed = collapsedCities[city];
                    return (
                      <div key={city} className="flex flex-col gap-2 border border-slate-800/40 p-2.5 rounded-2xl bg-slate-900/45 shrink-0">
                        {/* City Accordion Header */}
                        <div 
                          onClick={() => setCollapsedCities(prev => ({ ...prev, [city]: !prev[city] }))}
                          className="flex items-center justify-between text-[11px] font-extrabold text-blue-400 bg-slate-850 px-3 py-2 rounded-xl cursor-pointer hover:bg-slate-800 select-none"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span>{city} ({lines.length} 个线路)</span>
                          </span>
                          <span className="text-[9px] text-slate-500 font-bold">
                            {isCollapsed ? '展开▼' : '折叠▲'}
                          </span>
                        </div>

                        {/* Collapsible Line Items */}
                        {!isCollapsed && (
                          <div className="flex flex-col gap-2 pl-0.5 mt-0.5">
                            {lines.map((line) => {
                              const isEditing = editingLineId === line.id;
                              return (
                                <div 
                                  key={line.id} 
                                  onClick={() => handlePreviewLineOnMap(line)}
                                  className="p-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/30 rounded-xl flex flex-col gap-2 transition-all cursor-pointer relative"
                                  title="点击进行地图预览"
                                >
                                  <div className="flex flex-col gap-0.5">
                                    {isEditing ? (
                                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                        <input 
                                          type="text"
                                          value={editingLineName}
                                          onChange={(e) => setEditingLineName(e.target.value)}
                                          className="px-2 py-0.5 bg-slate-800 border border-slate-600 rounded text-[11px] text-white max-w-[120px] font-bold"
                                          autoFocus
                                        />
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleEditApprovedLine(line.id, editingLineName);
                                          }}
                                          className="px-1.5 py-0.5 bg-purple-600 hover:bg-purple-500 text-white text-[8px] font-black rounded"
                                        >
                                          保存
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingLineId(null);
                                          }}
                                          className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[8px] font-bold rounded"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-extrabold text-white text-[11px] truncate max-w-[150px]">{line.name}</span>
                                        <span className="px-1.5 py-0.5 rounded bg-slate-700 text-[8px] font-black text-slate-400 shrink-0">
                                          {line.district || '全区'}
                                        </span>
                                      </div>
                                    )}
                                    <div className="text-slate-500 text-[8px]">
                                      发布者: {line.creatorNickname || '匿名'}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 justify-end shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                                    {!isEditing && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingLineId(line.id);
                                          setEditingLineName(line.name);
                                        }}
                                        className="px-1.5 py-0.5 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 rounded font-bold transition-all text-[8px] flex items-center gap-0.5"
                                      >
                                        <Edit3 className="w-2 h-2" />
                                        <span>名</span>
                                      </button>
                                    )}
                                    {deletingLineId === line.id ? (
                                      <div className="flex items-center gap-1 shrink-0 bg-m3-error-container/20 p-0.5 rounded border border-m3-error/20">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteApprovedLine(line.id);
                                          }}
                                          className="px-1.5 py-0.5 bg-m3-error hover:opacity-90 text-white rounded font-bold text-[8px] transition-colors"
                                        >
                                          确认
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDeletingLineId(null);
                                          }}
                                          className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-[8px] transition-colors"
                                        >
                                          否
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDeletingLineId(line.id);
                                        }}
                                        className="px-1.5 py-0.5 border border-m3-error/20 text-m3-error hover:bg-m3-error-container/15 rounded font-bold transition-all text-[8px] flex items-center gap-0.5"
                                      >
                                        <Trash2 className="w-2 h-2" />
                                        <span>删</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Minigame Modal / HUD */}
        <AnimatePresence>
          {showMinigameModal && (
            <>
              {(gameState === 'menu' || gameState === 'gameover' || gameLoading) && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => {
                    if (!gameLoading) {
                      exitMinigameToMap();
                    }
                  }}
                  className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md pointer-events-auto flex flex-col items-center justify-center text-white gap-3"
                >
                  {gameLoading && (
                    <>
                      {gameLaunchAnimation ? <motion.div initial={{ scale: 0.4, opacity: 0, rotate: -40 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }} className="relative flex h-24 w-24 items-center justify-center rounded-[30px] bg-m3-primary text-white shadow-[0_0_70px_rgba(82,121,111,0.8)]"><motion.div animate={{ scale: [1, 1.28, 1], opacity: [0.8, 0.15, 0.8] }} transition={{ duration: 1.05, repeat: Infinity }} className="absolute inset-[-18px] rounded-[40px] border-2 border-m3-primary" /><Route className="h-10 w-10" /></motion.div> : <Loader2 className="w-10 h-10 animate-spin text-m3-primary" />}
                      {!gameLaunchAnimation && <motion.p key="loading" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-sm font-black tracking-wide">{gameLoadingText}</motion.p>}
                      <button type="button" onClick={returnToMinigameMenu} className="mt-2 rounded-xl border border-white/35 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-white/10">取消并返回菜单</button>
                    </>
                  )}
                </motion.div>
              )}

              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 16 }}
                transition={{ type: 'spring', damping: 24, stiffness: 220 }}
                className={
                  (gameState === 'playing' || gameState === 'review') && !gameLoading
                    ? "fixed bottom-3 left-1/2 -translate-x-1/2 z-[121] w-[860px] max-w-[96vw] bg-m3-surface/95 backdrop-blur-xl border border-m3-outline-variant/40 rounded-[22px] shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
                    : gameState === 'playing' && gameLoading
                    ? "hidden"
                    : "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[121] w-[980px] max-w-[94vw] max-h-[85vh] bg-m3-surface-container-high border border-m3-outline-variant/30 rounded-[32px] shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
                }
              >
                {gameState === 'menu' && (
                  <div className="p-7 overflow-y-auto flex flex-col gap-6 relative md:grid md:grid-cols-[minmax(230px,0.8fr)_minmax(360px,1.2fr)] md:items-start">
                    <button
                      type="button"
                      onClick={exitMinigameToMap}
                      className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    <div className="md:col-span-2">
                      <div className="flex items-center gap-2.5 mb-1">
                        <div className="w-9 h-9 rounded-2xl bg-m3-primary text-m3-on-primary flex items-center justify-center shadow-md">
                          <Gamepad2 className="w-5 h-5" />
                        </div>
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">公交猜一猜小游戏</h2>
                      </div>
                      <p className="text-xs text-slate-500 font-medium">挑战你的路网知识，解锁“巴士之神”至高荣誉！</p>
                    </div>

                    {gameAccountEnabled && <div className="rounded-2xl border border-m3-outline-variant/30 bg-m3-surface p-3 md:col-start-2 md:row-start-2">
                      {(() => { const mode = gameMode || 'line', scope = leaderboardScope(mode); const single = mode === 'city' || mode === 'county'; const label = mode === 'city' ? '全国榜' : mode === 'county' ? `${scope}榜` : `${scope}榜`; return <><div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-slate-700">{label} · {mode === 'line' ? '看图猜线路' : mode === 'station' ? '看通达度猜站名' : mode === 'city' ? '看线网猜城市' : '看线网猜县城'}</span><button type="button" onClick={() => void refreshLadderBoards(mode, scope)} className="text-[11px] font-bold text-m3-primary">刷新</button></div><div className={`grid gap-2 ${single ? 'grid-cols-1' : 'grid-cols-2'}`}><GameLadderPanel title={single ? '天梯榜' : '标准天梯'} entries={ladderBoards.standard} loading={leaderboardLoading} />{!single && <GameLadderPanel title="地狱天梯" entries={ladderBoards.hell} loading={leaderboardLoading} />}</div></>; })()}
                    </div>}

                    {/* Mode selection */}
                    <div className="space-y-3 md:col-start-1 md:row-start-2 md:row-span-5">
                      <label className="text-xs font-black text-slate-700 tracking-wide uppercase">选择游戏模式</label>
                      <div className="grid grid-cols-1 gap-2.5">
                        {[
                          { id: 'line', title: '看图猜线路', desc: '随机抽取线路观察走向，挑战猜出正确的公交线路名称' },
                          { id: 'station', title: '看通达度猜站名', desc: '观察站点周边多路公交交织网络，猜出对应的公交站点名称' },
                          { id: 'city', title: '看线网猜城市', desc: '从已有线路图城市中随机出题，猜出所属城市（共10题）' },
                          { id: 'county', title: '看线网猜县城', desc: '使用已有县政府站点附近的线网，遮挡周边区域后猜县城' }
                        ].map(m => (
                          <div 
                            key={m.id}
                            onClick={() => {
                              const mode = m.id as 'line' | 'station' | 'city' | 'county';
                              setGameMode(mode);
                              void warmLadderBoards(mode, leaderboardScope(mode));
                            }}
                            className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start gap-3.5 ${gameMode === m.id ? 'bg-m3-primary-container/40 border-m3-primary shadow-sm ring-1 ring-m3-primary/30' : 'bg-m3-surface border-m3-outline-variant/30 hover:bg-m3-surface-container-low'}`}
                          >
                            <GameModeVisual mode={m.id as 'line' | 'station' | 'city' | 'county'} active={gameMode === m.id} />
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-black text-slate-900">{m.title}</h3>
                              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{m.desc}</p>

                              {/* Best record */}
                              <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-slate-600">
                                <span>最佳纪录:</span>
                                <span className="px-2 py-0.5 rounded-full bg-m3-surface-container text-m3-primary font-black">
                                  {(m.id === 'city' || m.id === 'county')
                                    ? `${bestRecords[m.id]?.hard || 0}分`
                                    : `标准:${bestRecords[m.id].easy} | 地狱:${bestRecords[m.id].hell || 0}`}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Difficulty & Scope Settings */}
                    {gameMode && gameMode !== 'city' && gameMode !== 'county' && (
                      <div className="space-y-4 pt-2 border-t border-m3-outline-variant/20 md:col-start-2 md:row-start-3">
                        <div className="space-y-2">
                          <label className="text-xs font-black text-slate-700 tracking-wide uppercase">选择难度</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { id: 'easy', label: '标准天梯（选择题，120秒/题）' },
                              { id: 'hell', label: '地狱天梯（填空题，90秒/题）' }
                            ].map(d => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => setGameDifficulty(d.id as any)}
                                className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${gameDifficulty === d.id ? 'bg-m3-primary text-m3-on-primary border-m3-primary shadow-sm' : 'bg-m3-surface border-m3-outline-variant/30 text-slate-700 hover:bg-m3-surface-container'}`}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="text-xs font-bold text-slate-700">先选择省份<select value={gameProvince} disabled={gameCatalogLoading} onChange={event=>setGameProvince(event.target.value)} className="block mt-2 w-full px-3 py-2.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs">{gameProvinces.map(province=><option key={province} value={province}>{province}</option>)}</select></label>
                          <label className="text-xs font-bold text-slate-700">再选择城市<select value={gameCity} disabled={gameCatalogLoading||!gameCities.length} onChange={event=>setGameCity(event.target.value)} className="block mt-2 w-full px-3 py-2.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs">{gameCities.map(city=><option key={city.city} value={city.city}>{city.city}</option>)}</select></label>
                        </div>
                      </div>
                    )}

                    {gameMode === 'county' && (
                      <div className="space-y-4 pt-2 border-t border-m3-outline-variant/20 md:col-start-2 md:row-start-3">
                        <div className="space-y-2">
                          <label className="text-xs font-black text-slate-700 tracking-wide uppercase">选择省份（仅含已有县政府站点线网）</label>
                          <select
                            value={gameCountyProvince}
                            onChange={(e) => setGameCountyProvince(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs font-bold text-slate-800 outline-none focus:border-m3-primary"
                          >
                            {countyProvinces.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {gameCatalogLoading&&<p role="status" className="text-xs text-slate-500">正在读取已有线路图城市…</p>}
                    {gameDataError&&<p role="alert" className="text-xs text-m3-error">{gameDataError}</p>}
                    {!gameAccount && gameAccountEnabled && <p className="text-xs text-slate-500">游客可直接开始，成绩仅保存在本机。</p>}
                    {!gameCatalogLoading&&gameMode==='county'&&!countyProvinces.length&&<p role="status" className="text-xs text-slate-500">暂未收录可定位的县政府站点，请先选择其他模式。</p>}
                    {/* Start & Review Buttons */}
                    <div className="flex gap-2.5 md:col-start-2">
                      <button
                        type="button"
                        disabled={!gameMode||gameCatalogLoading||!gameCatalog.length||((gameMode==='line'||gameMode==='station')&&!gameCities.some(city=>city.city===gameCity))||(gameMode==='county'&&!countyProvinces.includes(gameCountyProvince))}
                        onClick={() => startMinigame(
                          gameMode!,
                          gameDifficulty,
                          gameCity,
                          gameMode === 'county' ? gameCountyProvince : gameProvince
                        )}
                        className="flex-1 py-3.5 rounded-2xl bg-m3-primary text-m3-on-primary font-black text-sm shadow-lg hover:opacity-95 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        {gameCatalogLoading?'正在读取城市…':'开始挑战'}
                      </button>
                      {gameHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={startMinigameReview}
                          className="px-4 py-3.5 rounded-2xl bg-m3-surface border border-m3-outline-variant/40 text-slate-800 font-black text-xs shadow-sm hover:bg-m3-surface-container transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                        >
                          <History className="w-4 h-4 text-m3-primary" />
                          复盘上局 ({gameHistory.length}题)
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {gameState === 'menu' && gameMode && (
                  <p className="px-4 pb-3 text-center text-xs font-bold text-m3-primary">
                    {(gameMode === 'line' || gameMode === 'station') ? `每题限时 ${getGameTimeLimit(gameMode, gameDifficulty)} 秒` : getGameTimeLimit(gameMode, gameDifficulty) === null ? '本局不限时' : `本局限时 ${getGameTimeLimit(gameMode, gameDifficulty)! / 60} 分钟`}
                    <span className="text-slate-500 font-medium"> · 出题加载期间暂停计时</span>
                  </p>
                )}

                {gameState === 'playing' && gameQuestionData && (
                  <div className="px-4 py-3 flex flex-col gap-2 relative bg-m3-surface">
                    <div className="flex items-center justify-between gap-2 border-b border-m3-outline-variant/20 pb-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="px-2.5 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container text-[11px] font-black shrink-0">
                          {gameMode === 'line'
                            ? '看图猜线路'
                            : gameMode === 'station'
                            ? '看通达度猜站名'
                            : gameMode === 'county'
                            ? '看线网猜县城'
                            : '看线网猜城市'}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500 shrink-0">
                          {gameMode === 'city' ? `第 ${gameQuestionNum}/10 题` : `第 ${gameQuestionNum} 题`}
                        </span>
                        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50/90 border border-amber-200/70 text-amber-900 text-[11px] font-bold min-w-0 truncate">
                          <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span className="truncate">{gameQuestionData.promptText}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0 ml-auto">
                        <span
                          role="timer"
                          aria-label={gameTimeLeft === null ? '无时间限制' : `剩余时间 ${formatGameTime(gameTimeLeft)}`}
                          className={`px-2.5 py-1 rounded-full text-xs font-black tabular-nums ${gameTimeLeft !== null && gameTimeLeft <= 30 ? 'bg-red-50 text-red-600' : 'bg-m3-primary-container text-m3-on-primary-container'}`}
                        >
                          {gameTimeLeft === null ? '不限时' : formatGameTime(gameTimeLeft)}
                        </span>
                        <span className="text-xs font-extrabold text-slate-700">得分: <strong className="text-m3-primary">{gameScore}</strong></span>
                        {confirmQuitGame ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={returnToMinigameMenu}
                              className="text-[11px] font-black text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded-lg transition-colors"
                            >
                              确认退出
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmQuitGame(false)}
                              className="text-[11px] font-bold text-slate-500 hover:text-slate-800 px-1.5 py-0.5"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmQuitGame(true)}
                            className="text-xs font-bold text-red-500 hover:underline"
                          >
                            退出
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:hidden items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50/90 border border-amber-200/70 text-amber-900 text-[11px] font-bold">
                      <Shield className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="truncate">{gameQuestionData.promptText}</span>
                    </div>

                    {isAdminVerified && (
                      <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs">
                        <Shield className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span className="font-black">管理员测试答案</span>
                        <strong className="font-black break-all">{gameQuestionData.correctAnswer}</strong>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-[11px] font-medium text-slate-500">每局共 7 次提示，从答案两端逐字揭示</span>
                      <motion.button
                        type="button"
                        onClick={handleGameHint}
                        disabled={gameLoading || gameFeedback !== null || gameHints.remaining === 0 || isGameHintComplete(gameQuestionData.correctAnswer, gameHints.usedOnQuestion)}
                        whileTap={{ scale: 0.94 }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-m3-primary-container text-m3-on-primary-container text-xs font-bold transition-colors hover:bg-m3-primary/20 disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {gameHints.remaining === 0 ? '提示已用完' : isGameHintComplete(gameQuestionData.correctAnswer, gameHints.usedOnQuestion) ? '本题已全部揭示' : '提示'}
                        <span className="tabular-nums">{gameHints.remaining}/7</span>
                      </motion.button>
                    </div>
                    <AnimatePresence>
                      {gameHints.usedOnQuestion > 0 && !gameLoading && (
                        <motion.div
                          key={gameQuestionNum}
                          initial={{ opacity: 0, y: 8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ type: 'spring', damping: 24, stiffness: 260 }}
                          role="status"
                          aria-live="polite"
                          className="px-3 py-2.5 rounded-2xl bg-m3-primary-container/50 border border-m3-outline-variant/40"
                        >
                          <div className="text-[10px] font-bold text-m3-primary mb-1">答案提示 · {Array.from(gameQuestionData.correctAnswer).length} 个字符</div>
                          <motion.p
                            key={gameHints.usedOnQuestion}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-sm font-black tracking-widest text-m3-on-primary-container break-all"
                          >
                            {getGameHint(gameQuestionData.correctAnswer, gameHints.usedOnQuestion)}
                          </motion.p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {gameFeedback && (
                      <div className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold text-center ${gameFeedback.correct ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                        {gameFeedback.msg}
                      </div>
                    )}

                    {!gameQuestionData.isFillIn && gameQuestionData.options && gameQuestionData.options.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(gameQuestionData.options || []).map((opt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            title={opt}
                            disabled={gameFeedback !== null}
                            onClick={() => handleMinigameSubmit(opt)}
                            className="px-3 py-2 rounded-xl border border-m3-outline-variant/30 bg-m3-surface-container-low hover:bg-m3-primary-container/30 hover:border-m3-primary text-slate-800 font-bold text-xs transition-all shadow-xs text-left truncate flex items-center gap-2"
                          >
                            <span className="w-5 h-5 rounded-full bg-m3-surface-container flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">
                              {['A', 'B', 'C', 'D'][idx]}
                            </span>
                            <span className="truncate">{opt}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="hidden sm:inline text-[11px] font-bold text-slate-500 shrink-0">填空作答:</span>
                        <input
                          type="text"
                          disabled={gameFeedback !== null}
                          placeholder={
                            gameMode === 'county'
                              ? '输入县城名称（如：桐庐 / 桐庐县）'
                              : gameMode === 'city'
                              ? '输入城市名称（如：北京 / 北京市）'
                              : gameMode === 'station'
                              ? '输入站点名称（如：西单）'
                              : '输入线路名称（如：1路 / 919快）'
                          }
                          value={gameUserInput}
                          onChange={(e) => setGameUserInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && gameUserInput.trim()) {
                              handleMinigameSubmit(gameUserInput);
                            }
                          }}
                          className="flex-1 px-3.5 py-2 rounded-xl bg-m3-surface border border-m3-outline-variant/30 text-xs font-bold text-slate-800 outline-none focus:border-m3-primary"
                        />
                        <button
                          type="button"
                          disabled={gameFeedback !== null || !gameUserInput.trim()}
                          onClick={() => handleMinigameSubmit(gameUserInput)}
                          className="px-5 py-2 rounded-xl bg-m3-primary text-m3-on-primary font-black text-xs shadow-sm hover:opacity-95 transition-all disabled:opacity-50 shrink-0"
                        >
                          提交
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {gameState === 'playing' && !gameLoading && !gameQuestionData && (
                  <div className="p-6 flex flex-col items-center text-center gap-4 bg-m3-surface">
                    <p className="text-xs font-bold text-slate-600">题目生成遇到网络波动，请重试或返回菜单。</p>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => generateQuestion(gameMode!, gameDifficulty, gameCity, gameQuestionNum)}
                        className="px-4 py-2 rounded-xl bg-m3-primary text-m3-on-primary text-xs font-black shadow-sm"
                      >
                        重新出题
                      </button>
                      <button
                        type="button"
                        onClick={returnToMinigameMenu}
                        className="px-4 py-2 rounded-xl bg-m3-surface-container text-slate-700 text-xs font-black"
                      >
                        返回菜单
                      </button>
                    </div>
                  </div>
                )}

                {gameState === 'gameover' && (
                  <div className="p-8 flex flex-col items-center text-center gap-5 relative">
                    <button
                      type="button"
                      onClick={exitMinigameToMap}
                      className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-full bg-m3-surface-container hover:bg-m3-surface-container-high text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-600 flex items-center justify-center shadow-lg">
                      <Trophy className="w-8 h-8" />
                    </div>

                    <div>
                      <h2 className="text-xl font-black text-slate-900">{gameTimedOut ? '时间到，挑战结束！' : '挑战结束！'}</h2>
                      <p className="text-xs text-slate-500 font-medium mt-1">本次挑战最终得分</p>
                      <div className="text-4xl font-black text-m3-primary mt-2">{gameScore} <span className="text-sm font-bold text-slate-400">分</span></div>
                    </div>

                    {(() => {
                      const rating = getRating(gameMode!, gameScore);
                      return (
                        <div className={`px-5 py-2 rounded-2xl border text-xs font-black shadow-sm flex items-center gap-2 ${rating.color}`}>
                          <Award className="w-4 h-4" />
                          获得段位评级：{rating.title}
                        </div>
                      );
                    })()}

                    {isAdminVerified && <p className="text-xs font-bold text-m3-primary">管理员模式已启用</p>}
                    {gameAuthMessage && <p role="status" className="text-xs text-slate-500">{gameAuthMessage}</p>}
                    <div className="flex gap-2.5 w-full pt-2">
                      {gameHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={startMinigameReview}
                          className="flex-1 py-3 rounded-2xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-black text-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <History className="w-4 h-4" />
                          复盘本局 ({gameHistory.length}题)
                        </button>
                      )}
                      <button
                        type="button"

                        onClick={() => startMinigame(gameMode!, gameDifficulty, gameCity)}
                        className="flex-1 py-3 rounded-2xl bg-m3-primary text-m3-on-primary font-black text-xs shadow-md hover:opacity-95 transition-all"
                      >
                        再玩一次
                      </button>
                      <button
                        type="button"
                        onClick={returnToMinigameMenu}
                        className="flex-1 py-3 rounded-2xl bg-m3-surface-container hover:bg-m3-surface-container-high text-slate-700 font-black text-xs transition-all"
                      >
                        返回菜单
                      </button>
                    </div>
                  </div>
                )}

                {gameState === 'review' && gameHistory[reviewIndex] && (() => {
                  const item = gameHistory[reviewIndex];
                  const lineMeta = item.mode === 'line' && item.lineInfos?.[0]?.name
                    ? parseLineInfo(item.lineInfos[0].name)
                    : null;
                  const modeLabel = item.mode === 'line'
                    ? '看图猜线路'
                    : item.mode === 'station'
                    ? '看通达度猜站名'
                    : item.mode === 'county'
                    ? '看线网猜县城'
                    : '看线网猜城市';

                  return (
                    <div className="px-4 py-3 flex flex-col gap-2.5 bg-m3-surface">
                      {/* Top Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-m3-outline-variant/20 pb-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-black flex items-center gap-1 shrink-0">
                            <History className="w-3 h-3" />
                            题目复盘
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-m3-primary-container text-m3-on-primary-container text-[11px] font-bold shrink-0">
                            {modeLabel}
                          </span>
                          <span className="text-[11px] font-black text-slate-700 shrink-0">
                            第 {reviewIndex + 1} / {gameHistory.length} 题
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-m3-surface-container text-slate-600 text-[11px] font-bold shrink-0">
                            {item.province ? `${item.province} · ${item.targetCity}` : item.targetCity}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-black shrink-0 ${item.isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {item.isCorrect ? '回答正确' : '回答错误'}
                          </span>
                          {reviewHoveredStop && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-bold truncate max-w-[200px]">
                              {reviewHoveredStop}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-auto">
                          <button
                            type="button"
                            onClick={() => {
                              setReviewAutoPlay(false);
                              restoreMapAfterMinigame();
                              setGameState('gameover');
                            }}
                            className="text-xs font-bold text-slate-600 hover:text-slate-900 px-2 py-0.5 rounded-lg hover:bg-m3-surface-container transition-colors"
                          >
                            返回结算
                          </button>
                          <button
                            type="button"
                            onClick={returnToMinigameMenu}
                            className="text-xs font-bold text-red-500 hover:underline"
                          >
                            返回菜单
                          </button>
                        </div>
                      </div>

                      {/* Answer Summary Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-m3-surface-container-low border border-m3-outline-variant/20 text-xs">
                        <div className="flex flex-wrap items-center gap-3 min-w-0">
                          <span className="font-bold text-slate-600">
                            你的答案：<strong className={item.isCorrect ? 'text-emerald-700' : 'text-red-600'}>{item.userAnswer || '（未填）'}</strong>
                          </span>
                          <span className="font-bold text-slate-700">
                            正确答案：<strong className="text-m3-primary">{item.correctAnswer}</strong>
                          </span>
                          {lineMeta && lineMeta.start && lineMeta.start !== '-' && (
                            <span className="text-[11px] font-medium text-slate-500">
                              （<span className="text-emerald-600 font-bold">●</span> {lineMeta.start} → <span className="text-red-500 font-bold">●</span> {lineMeta.end}）
                            </span>
                          )}
                        </div>
                        {item.mode === 'line' && (
                          <div className="flex items-center gap-2.5 text-[11px] font-bold text-slate-500 shrink-0">
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> 始发站</span>
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> 终点站</span>
                          </div>
                        )}
                      </div>

                      {/* Controls Row: Sequence Stepper + Basemap & Stops Toggles */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            disabled={reviewIndex <= 0}
                            onClick={() => { setReviewAutoPlay(false); setReviewIndex(i => Math.max(0, i - 1)); }}
                            className="px-2.5 py-1.5 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high disabled:opacity-40 text-xs font-bold text-slate-700 flex items-center gap-1 transition-colors"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            上一题
                          </button>
                          <div className="flex items-center gap-1 overflow-x-auto max-w-[260px] sm:max-w-[340px] py-0.5">
                            {gameHistory.map((h, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => { setReviewAutoPlay(false); setReviewIndex(idx); }}
                                className={`w-6 h-6 rounded-lg text-[11px] font-black transition-all shrink-0 border ${
                                  idx === reviewIndex
                                    ? 'bg-m3-primary text-m3-on-primary border-m3-primary shadow-sm'
                                    : h.isCorrect
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                }`}
                              >
                                {idx + 1}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            disabled={reviewIndex >= gameHistory.length - 1}
                            onClick={() => { setReviewAutoPlay(false); setReviewIndex(i => Math.min(gameHistory.length - 1, i + 1)); }}
                            className="px-2.5 py-1.5 rounded-xl bg-m3-surface-container hover:bg-m3-surface-container-high disabled:opacity-40 text-xs font-bold text-slate-700 flex items-center gap-1 transition-colors"
                          >
                            下一题
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          {gameHistory.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!reviewAutoPlay && reviewIndex >= gameHistory.length - 1) {
                                  setReviewIndex(0);
                                }
                                setReviewAutoPlay(v => !v);
                              }}
                              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition-colors ${
                                reviewAutoPlay
                                  ? 'bg-m3-primary text-m3-on-primary border-m3-primary'
                                  : 'bg-m3-surface border-m3-outline-variant/30 text-slate-700 hover:bg-m3-surface-container'
                              }`}
                            >
                              {reviewAutoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              {reviewAutoPlay ? '暂停播放' : '依次播放'}
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                          <button
                            type="button"
                            onClick={() => setReviewShowBasemap(v => !v)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                              reviewShowBasemap
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : 'bg-m3-surface border-m3-outline-variant/30 text-slate-600 hover:bg-m3-surface-container'
                            }`}
                          >
                            <MapIcon className="w-3.5 h-3.5" />
                            底图：{reviewShowBasemap ? '开' : '关'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReviewShowStops(v => !v)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                              reviewShowStops
                                ? 'bg-blue-50 text-blue-800 border-blue-300'
                                : 'bg-m3-surface border-m3-outline-variant/30 text-slate-600 hover:bg-m3-surface-container'
                            }`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            站点：{reviewShowStops ? '开' : '关'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <WechatAccountLink
          account={gameAccount}
          accessToken={gameAccessToken}
          authLoading={gameAuthLoading}
          hideTrigger={isAnswering}
          open={showSettings}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onOpen={() => { setSettingsTab('profile'); setShowSettings(true); }}
          onClose={() => setShowSettings(false)}
          onSignedIn={(account, accessToken) => {
            setGameAccount(account);
            setGameAccessToken(accessToken);
            setGameAuthLoading(false);
          }}
          onLogout={() => {
            setGameAccessToken('');
            setGameAccount(null);
            setGameAuthLoading(false);
          }}
        >
                    {settingsTab === 'general' && <div className="mb-6"><CityDataPanel data={lastCityDataset}
                      summary={publishedCitySummary?.city.replace(/市$/, '') === currentCity.replace(/市$/, '') ? publishedCitySummary : null}
                      status={sharedCityStatus} onUpload={lastCityDataset && !lastCityDataset.filtered ? () => { setShowSettings(false); setCityUploadError(''); setPendingCityUpload(lastCityDataset); } : undefined} onRefresh={(lastCityDataset ? !citySnapshotFresh(lastCityDataset)
                        : !!publishedCitySummary && Date.now() >= cityDatasetExpiresAt(publishedCitySummary)) ? () => { if (!isSearching) { setShowSettings(false); void handleSearch(true); } } : undefined} /></div>}

                    {settingsTab === 'general' ? (
                      <div className="space-y-5">
                        <div className="space-y-3.5">
                          {/* 站点显示模式 3-State Control */}
                          <div className="flex flex-col gap-2 p-1 border-b border-m3-outline-variant/20 pb-3">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-700">站点显示模式</span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {stationMode === 'all' ? '全部站点' : stationMode === 'terminal' ? '仅终点站' : '隐藏站点'}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 bg-m3-surface-container-highest p-1 rounded-xl">
                              <button
                                type="button"
                                onClick={() => setStationMode('all')}
                                className={`py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                  stationMode === 'all'
                                    ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                全部站点
                              </button>
                              <button
                                type="button"
                                onClick={() => setStationMode('terminal')}
                                className={`py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                  stationMode === 'terminal'
                                    ? 'bg-slate-700 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                仅终点站
                              </button>
                              <button
                                type="button"
                                onClick={() => setStationMode('none')}
                                className={`py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                  stationMode === 'none'
                                    ? 'bg-m3-outline text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                不显示
                              </button>
                            </div>
                            <span className="text-[10px] text-slate-400 leading-tight">
                              仅终点站模式下，每个终点站均以明显的灰色圆圈突出显示。
                            </span>
                          </div>

                          {/* 底图样式 3-State Control */}
                          <div className="flex flex-col gap-2 p-1 border-b border-m3-outline-variant/20 pb-3">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-slate-700">底图样式</span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                {mapMode === 'normal' ? '正常底图' : mapMode === 'satellite' ? '卫星底图' : '空白底图'}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 bg-m3-surface-container-highest p-1 rounded-xl">
                              <button
                                type="button"
                                onClick={() => setMapMode('normal')}
                                className={`py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                  mapMode === 'normal'
                                    ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                正常底图
                              </button>
                              <button
                                type="button"
                                onClick={() => setMapMode('satellite')}
                                className={`py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                  mapMode === 'satellite'
                                    ? 'bg-m3-primary text-m3-on-primary shadow-xs'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                卫星底图
                              </button>
                              <button
                                type="button"
                                onClick={() => setMapMode('blank')}
                                className={`py-1.5 px-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                                  mapMode === 'blank'
                                    ? 'bg-m3-outline text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-800'
                                }`}
                              >
                                空白底图
                              </button>
                            </div>
                            <span className="text-[10px] text-slate-400 leading-tight">
                              支持标准矢量底图、高清晰度遥感卫星影像或极简白板。
                            </span>
                          </div>

                        </div>

                          <div className="flex flex-col p-1 gap-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-500 select-none">{t('showUserSubmittedData')}</span>
                              <button 
                                type="button"
                                disabled={true}
                                className="w-12 h-6.5 rounded-full relative flex items-center px-1 border-2 bg-slate-200/80 border-slate-300 cursor-not-allowed opacity-60 transition-none"
                                title={t('customDrawingDisabledHint')}
                              >
                                <div 
                                  className="rounded-full shadow-sm w-3.5 h-3.5 bg-slate-400"
                                />
                              </button>
                            </div>
                            <span className="text-[10px] font-medium text-slate-400 select-none">
                              {t('customDrawingDisabledHint')}
                            </span>
                        </div>

                      <div className="h-[1px] bg-m3-outline-variant/20 w-full" />

                      {/* Custom API Key & Security Code Toggle & Input (Always at the very bottom of General) */}
                      <div ref={customApiSectionRef} className="flex flex-col gap-3 p-1">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-700">地图与检索使用自有高德 API</span>
                            <span className="text-[10px] text-slate-400 mt-1 max-w-[200px] leading-tight font-medium">开启后地图、普通检索与全市检索都会使用该配置；关闭后使用公共 API</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => {
                              const next = !useCustomApiKey;
                              setUseCustomApiKey(next);
                              localStorage.setItem('app_use_custom_api_key', String(next));
                              if (!next) window.location.reload();
                            }}
                            className={`w-12 h-6.5 rounded-full transition-colors duration-200 relative flex items-center px-1 border-2 ${useCustomApiKey ? 'bg-m3-primary border-m3-primary' : 'bg-m3-surface-container-highest border-m3-outline'}`}
                          >
                            <motion.div 
                              animate={{ x: useCustomApiKey ? 22 : 0 }}
                              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                              className={`rounded-full shadow-sm transition-colors duration-200 ${useCustomApiKey ? 'w-4.5 h-4.5 bg-m3-on-primary' : 'w-3.5 h-3.5 bg-m3-outline'}`}
                            />
                          </button>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-500">{AMAP_API_PRIVACY_NOTICE}</p>
                        {useCustomApiKey && (
                          <div className="flex flex-col gap-2.5 pt-1">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 block mb-1">
                                高德 Web端 API Key (VITE_AMAP_KEY)
                              </label>
                              <input
                                type="text"
                                value={customApiKey}
                                onChange={(e) => setCustomApiKey(e.target.value)}
                                placeholder="请输入高德API Key"
                                className="px-3 py-2 bg-m3-surface-container border border-m3-outline-variant text-slate-800 rounded-xl outline-none text-xs font-bold focus:border-m3-primary transition-all w-full"
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
                                className="px-3 py-2 bg-m3-surface-container border border-m3-outline-variant text-slate-800 rounded-xl outline-none text-xs font-bold focus:border-m3-primary transition-all w-full"
                              />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                              <span>保存后页面会刷新，地图、检索与全市检索都会使用该配置。</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (useCustomApiKey && citySearchApiStatus(true, customApiKey, customApiSecurityCode) === 'missing') {
                                    setApiErrorNotification('请先输入有效的高德API Key与安全密钥');
                                    return;
                                  }
                                  localStorage.setItem('app_use_custom_api_key', String(useCustomApiKey));
                                  localStorage.setItem('app_custom_api_key', customApiKey.trim());
                                  localStorage.setItem('app_custom_api_security_code', customApiSecurityCode.trim());
                                  setShowSettings(false);
                                  window.location.reload();
                                }}
                                className="px-2.5 py-1 bg-m3-primary/10 hover:bg-m3-primary/20 text-m3-primary font-bold rounded-lg transition-all cursor-pointer"
                              >
                                保存配置
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="h-[1px] bg-m3-outline-variant/20 w-full" />

                      {/* Reset App Button */}
                      <div className="flex items-center justify-between gap-3 p-1">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-700">重置</span>
                          <span className="text-[10px] text-slate-400 mt-1 max-w-[200px] leading-tight font-medium">
                            清除本网站缓存与本次访问数据后重新加载；不删除已保存的个人线路与 API 配置
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleResetApp}
                          className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/80 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          重置
                        </button>
                      </div>
                    </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center min-h-full py-2 gap-4 bg-m3-surface select-none">
                        <div className="w-18 h-18 bg-m3-surface-container border border-m3-outline-variant/35 rounded-3xl flex items-center justify-center shadow-lg mb-1 transition-all hover:scale-105 hover:rotate-2 duration-300">
                           <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 17H20" stroke="#3B6B91" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                            <path d="M17 4V20" stroke="#3B6B91" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                            <path d="M8 20V13L13 8H22" stroke="#3B6B91" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-black text-slate-800 tracking-tight">{t('title')}</h3>
                        <div className="px-3 py-1 bg-m3-primary-container rounded-full border border-m3-outline/5 select-none font-sans">
                           <span className="text-[9px] font-black text-m3-on-primary-container tracking-widest uppercase">busline 5.5</span>
                        </div>
                        <div className="flex flex-col items-center mt-2 gap-3">
                           <span 
                             onClick={handleFooterClick}
                             className="text-[11px] font-extrabold text-slate-505 cursor-pointer hover:text-m3-primary transition-colors select-none"
                           >
                             @TsFeng
                           </span>
                           <div className="flex items-center gap-2.5">
                             <button 
                               type="button"
                               onClick={() => setShowWeChatQR(true)} 
                               className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#07c160] text-white hover:bg-[#06ae54] transition-all shadow-sm hover:scale-110 active:scale-95 cursor-pointer border border-[#06ae54]/25"
                               title="加入微信群"
                             >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8.22 2c-3.69 0-6.68 2.45-6.68 5.48 0 1.76.98 3.33 2.5 4.39l-.65 1.94 2.22-.1.1.1a12.83 12.83 0 0 0 2.51.27c.4 0 .78-.03 1.15-.08a4.98 4.98 0 0 1-.16-1.22c0-2.61 2.37-4.73 5.3-4.73.47 0 .93.06 1.36.17l.06-.35c.19-1.92-1.57-4.14-4.88-5.32L11 2H8.22M5.7 5.16a.71.71 0 1 1 0 1.42.71.71 0 0 1 0-1.42zM10.14 5.19a.72.72 0 1 1 0 1.43.72.72 0 0 1 0-1.43zm6.33 4.25c-3.08 0-5.58 2.05-5.58 4.56 0 1.46.82 2.77 2.09 3.65l-.54 1.62 1.85-.92c.67.18 1.4.29 2.18.29 3.08 0 5.58-2.05 5.58-4.56S19.55 9.44 16.47 9.44m-2.12 2.33a.6.6 0 1 1 0 1.19.6.6 0 0 1 0-1.19zm3.83 0a.6.6 0 1 1 0 1.19.6.6 0 0 1 0-1.19z"/>
                                </svg>
                             </button>
                             <a href="https://space.bilibili.com/24964342" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#fb7299] text-white hover:bg-[#ff8eb3] transition-all shadow-sm border border-[#ff8eb3]/20 hover:scale-110 active:scale-95">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.755 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386z"/></svg>
                              </a>
                               <a href="https://github.com/tsfeng6" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-black transition-all shadow-sm hover:scale-110 active:scale-95 border border-slate-800">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                              </a>
                           </div>
                        </div>
                      </div>
                    )}
        </WechatAccountLink>

        {/* WeChat Group QR Code Modal */}
        <AnimatePresence>
          {showWeChatQR && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowWeChatQR(false)}
                className="fixed inset-0 z-[120] bg-slate-900/40 backdrop-blur-sm pointer-events-auto"
              />
              {/* Modal Container */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[121] w-[340px] bg-m3-surface-container rounded-[2rem] shadow-2xl overflow-hidden flex flex-col pointer-events-auto border border-m3-outline-variant/30 select-none"
              >
                {/* Header info */}
                <div className="pt-6 pb-4 px-6 flex flex-col items-center justify-center relative">
                  <button
                    type="button"
                    onClick={() => setShowWeChatQR(false)}
                    className="absolute top-4 right-4 w-7.5 h-7.5 flex items-center justify-center rounded-full bg-m3-surface-container-high text-m3-outline hover:text-m3-primary hover:bg-m3-primary-container transition-all shadow-sm z-10 border border-m3-outline-variant/10"
                  >
                    <X className="w-4 h-4" />
                  </button>

                  {/* 3x3 Grid User Avatars (collage like WeChat Group Avatar) */}
                  <div className="w-14 h-14 bg-slate-200/80 rounded-xl p-1 grid grid-cols-3 gap-1 shadow-inner border border-slate-300 mb-3 select-none">
                    {Array.from({ length: 9 }).map((_, i) => {
                      const gradients = [
                        'from-rose-400 to-red-500',
                        'from-blue-400 to-indigo-500',
                        'from-emerald-400 to-teal-500',
                        'from-amber-400 to-orange-500',
                        'from-purple-400 to-fuchsia-500',
                        'from-sky-400 to-cyan-500',
                        'from-pink-400 to-rose-500',
                        'from-lime-400 to-green-500',
                        'from-violet-400 to-indigo-600',
                      ];
                      return (
                        <div 
                          key={i} 
                          className={`w-full h-full rounded bg-gradient-to-br ${gradients[i % gradients.length]} opacity-85 shadow-[0_0.5px_1px_rgba(0,0,0,0.1)]`}
                        />
                      );
                    })}
                  </div>

                  {/* Group Name */}
                  <h3 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-1.5 leading-tight select-none">
                    群聊: Busline Home
                  </h3>
                </div>

                {/* QR Code Canvas Card Area */}
                <div className="px-6 pb-6 flex flex-col items-center">
                  <div className="w-full bg-m3-surface rounded-3xl p-6 border border-m3-outline-variant/30 flex flex-col items-center shadow-md relative group">
                    {wechatQRImg ? (
                      <div className="relative w-52 h-52 flex items-center justify-center bg-white">
                        <img 
                          src={wechatQRImg} 
                          alt="WeChat Group QR Code" 
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain rounded-lg"
                        />
                      </div>
                    ) : (
                      /* Fallback: Beautiful simulated vector QR Code SVG with the green WeChat icon in center */
                      <div className="relative w-52 h-52 flex flex-col items-center justify-center p-3 border border-dashed border-m3-outline-variant/60 bg-m3-surface-container-low rounded-2xl select-none">
                        <svg width="120" height="120" viewBox="0 0 24 24" className="text-slate-700 opacity-80" fill="currentColor">
                          <rect x="1" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          <rect x="3" y="3" width="3" height="3" />
                          <rect x="16" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          <rect x="18" y="3" width="3" height="3" />
                          <rect x="1" y="16" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          <rect x="3" y="18" width="3" height="3" />
                          <rect x="16" y="16" width="3" height="3" />
                          <rect x="10" y="2" width="1.5" height="1.5" />
                          <rect x="13" y="4" width="1.5" height="1.5" />
                          <rect x="10" y="7" width="1.5" height="1.5" />
                          <rect x="2" y="10" width="1.5" height="1.5" />
                          <rect x="5" y="12" width="1.5" height="1.5" />
                          <rect x="7" y="10" width="1.5" height="1.5" />
                          <rect x="10" y="11" width="1.5" height="1.5" />
                          <rect x="12" y="13" width="1.5" height="1.5" />
                          <rect x="14" y="9" width="1.5" height="1.5" />
                          <rect x="20" y="11" width="1.5" height="1.5" />
                          <rect x="22" y="13" width="1.5" height="1.5" />
                          <rect x="11" y="17" width="1.5" height="1.5" />
                          <rect x="13" y="19" width="1.5" height="1.5" />
                          <rect x="13" y="22" width="1.5" height="1.5" />
                          <rect x="9" y="20" width="1.5" height="1.5" />
                        </svg>

                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-10 h-10 bg-[#07c160] rounded-full border-4 border-white shadow flex items-center justify-center">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="white" className="animate-pulse">
                              <path d="M8.22 2c-3.69 0-6.68 2.45-6.68 5.48 0 1.76.98 3.33 2.5 4.39l-.65 1.94 2.22-.1.1.1a12.83 12.83 0 0 0 2.51.27c.4 0 .78-.03 1.15-.08a4.98 4.98 0 0 1-.16-1.22c0-2.61 2.37-4.73 5.3-4.73.47 0 .93.06 1.36.17l.06-.35c.19-1.92-1.57-4.14-4.88-5.32L11 2H8.22M5.7 5.16a.71.71 0 1 1 0 1.42.71.71 0 0 1 0-1.42zm4.44.03a.72.72 0 1 1 0 1.43.72.72 0 0 1 0-1.43zm6.33 4.25c-3.08 0-5.58 2.05-5.58 4.56 0 1.46.82 2.77 2.09 3.65l-.54 1.62 1.85-.92c.67.18 1.4.29 2.18.29 3.08 0 5.58-2.05 5.58-4.56S19.55 9.44 16.47 9.44m-2.12 2.33a.6.6 0 1 1 0 1.19.6.6 0 0 1 0-1.19zm3.83 0a.6.6 0 1 1 0 1.19.6.6 0 0 1 0-1.19z"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Operator Action Buttons */}
                  {isAdminVerified && (
                    <div className="mt-5 w-full flex items-center justify-center gap-2 pb-1">
                      <input 
                        type="file" 
                        ref={wechatFileInputRef} 
                        onChange={handleWeChatQRUpload} 
                        accept="image/*" 
                        className="hidden" 
                      />
                      <button
                        onClick={() => wechatFileInputRef.current?.click()}
                        className="flex-1 py-2.5 px-4 rounded-2xl text-[12px] font-black text-white bg-[#07c160] hover:bg-[#06ae54] transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        上传
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Removed duplicate UI elements */}

        {showMoreInfo && (
          <div className="hidden md:block absolute bottom-5 left-5 z-20 pointer-events-none">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="backdrop-blur-md bg-m3-surface/95 border border-m3-outline-variant/40 p-3 rounded-2xl shadow-md flex flex-col gap-2.5 pointer-events-auto min-w-[130px]"
            >
              {/* Legend Row */}
              <div className="hidden md:flex items-center justify-between px-1 select-none">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#5E8271] shadow-sm" />
                  <span className="text-[10px] font-bold text-slate-500">1-3</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#C29B63] shadow-sm" />
                  <span className="text-[10px] font-bold text-slate-500">4-9</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#B56666] shadow-sm" />
                  <span className="text-[10px] font-bold text-slate-500">10+</span>
                </div>
              </div>

              {/* Separator */}
              <div className="hidden md:block h-px bg-m3-outline-variant/20 w-full" />

              {/* Stats row with pulsing indicator */}
              <div className="flex items-center justify-between px-1 select-none">
                <div className="flex gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-slate-800 leading-none">{timelineAvailable ? stats.stops : viewportStats.stops}</span>
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mt-1">{filterTerminalOnly ? '终点站' : t('stops')}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-slate-800 leading-none">{timelineAvailable ? stats.lines : viewportStats.lines}</span>
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter mt-1">{t('lines')}</span>
                  </div>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-m3-primary animate-pulse shadow-[0_0_6px_var(--m3-primary)]" />
              </div>
            </motion.div>
          </div>
        )}

        <AnimatePresence>
          {(selectedStop || selectedSegmentLines) && !isAnswering && (
            <motion.div
              layout
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className={`fixed bottom-[76px] left-4 right-4 md:top-[80px] md:bottom-auto md:left-4 md:right-auto ${topCard === 'stop' ? 'z-[55]' : 'z-[45]'} pointer-events-auto`}
              onPointerDown={() => setTopCard('stop')}
            >
              <div className="backdrop-blur-xl bg-m3-surface/98 border border-m3-outline-variant/40 p-3.5 md:p-5 rounded-[1.75rem] shadow-xl w-full md:w-[340px] md:max-h-[calc(100vh-200px)] overflow-hidden flex flex-col relative select-none">
                <button 
                  onClick={() => {
                    const hadSegmentLines = selectedSegmentLines !== null;
                    setSelectedStop(null);
                    setSelectedSegmentLines(null);
                    setSelectionPos(null);
                    setSelectedSegmentName(null);
                    setSelectedSegmentAddress(null);
                    if (hadSegmentLines && roadStopsDataRef.current.size > 0) {
                      allMapStopsRef.current = new Map(roadStopsDataRef.current);
                      if (mapInstance && (window as any).AMap) {
                        syncStopMarkersToMap(mapInstance, (window as any).AMap);
                      }
                    }
                  }}
                  type="button"
                  className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-m3-surface-container text-m3-outline hover:text-m3-primary hover:bg-m3-primary-container transition-all shadow-xs z-10 select-none"
                >
                  <X className="w-3.5 h-3.5 text-m3-outline" />
                </button>

                <div className="mb-2 md:mb-5 pr-8">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base md:text-xl font-black text-slate-800 tracking-tight truncate">
                      {selectedStop ? selectedStop.name : (selectedSegmentName === "正在获取路段信息..." ? "当前位置" : (selectedSegmentName || "当前位置"))}
                    </h3>
                    {((selectedStop && selectedStop.lines && selectedStop.lines.length > 0) || (selectedSegmentLines && selectedSegmentLines.length > 0 && selectedStop === null)) && (
                      <div className="bg-m3-primary-container text-m3-on-primary-container px-2.5 py-0.5 rounded-full text-[9.5px]/none font-extrabold tracking-wider shrink-0 border border-m3-outline-variant/20 select-none">
                        {new Set((selectedStop ? selectedStop.lines : selectedSegmentLines || []).map((l: string) => {
                          const info = parseLineInfo(l);
                          return info.name.replace('路', '') + '|' + info.start + '|' + info.end;
                        })).size} {t('lines')}
                      </div>
                    )}
                    {selectedStop && (selectedStop.terminal || isTerminalStation(selectedStop)) && (
                      <div className="bg-amber-500/15 text-amber-800 border border-amber-500/30 px-2 py-0.5 rounded-full text-[9.5px]/none font-black tracking-wider shrink-0 select-none flex items-center gap-1">
                        <Flag className="w-2.5 h-2.5 fill-current" />
                        <span>终点站</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    {(selectedStop?.address || selectedSegmentAddress) && (
                      <p className="text-[9px] md:text-[11px] font-medium text-slate-500 truncate max-w-[65%]">
                        {selectedStop?.address || selectedSegmentAddress}
                      </p>
                    )}
                    {selectedStop && selectedStop.lines && selectedStop.lines.length > 0 && selectedStop.isBusStop !== false && (
                      <button 
                        type="button"
                        onClick={() => {
                          setStationConnectivityCard({
                            stop: selectedStop,
                            checkedLines: new Set(),
                            transferEnabled: false,
                            atStation: 0
                          });
                        }}
                        className="text-[9.5px] md:text-[11px] font-bold text-m3-primary hover:bg-m3-primary-container hover:text-m3-on-primary-container bg-m3-surface-container-high px-3 py-1 rounded-full border border-m3-outline-variant/30 shadow-xs transition-all absolute right-11 top-3 md:relative md:top-auto md:right-auto cursor-pointer"
                      >
                        {t('connectivity')}
                      </button>
                    )}
                  </div>
                  {selectedStop?.segmentName && (
                    <div className="mt-2 text-[11px] md:text-[12px] font-bold text-slate-700 bg-m3-primary-container/30 border border-m3-outline-variant/30 px-3 py-1.5 rounded-xl flex items-center justify-center truncate select-none">
                      {selectedStop.segmentName}
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto md:overflow-y-auto custom-scrollbar flex-1 pb-1 md:pb-0 px-1 -mx-1 md:mx-0 md:pr-2 gap-1.5 md:gap-2.5 flex md:flex-col items-center md:items-stretch h-[52px] md:h-auto snap-x snap-mandatory">
                  {Array.from(new Map(
                    (selectedStop ? selectedStop.lines : selectedSegmentLines || [])
                      .map((line: string) => {
                        const info = parseLineInfo(line);
                        const cleanName = info.name.replace('路', '');
                        return [`${cleanName}|${info.start}|${info.end}`, { line, info: { ...info, name: cleanName } }];
                      })
                  ).values())
                  .sort((a: any, b: any) => a.info.name.localeCompare(b.info.name))
                  .map(({ line, info }: any, idx: number) => {
                    const { name, start, end } = info;
                    const isUserSub = fetchedLinesCache.current.get(line)?.isUserSubmitted || approvedUserLines.some(ul => ul.name === line);
                    const badgeText = name.replace('路', '');
                    const viewportRoute = !selectedStop && selectedViewportRoutesRef.current.find(route => route.name === line);
                    const schedule = fetchedLinesCache.current.get(line) || Array.from(fetchedLinesCache.current.values() as Iterable<BusLine>).find(candidate =>
                      candidate.name.split(/[（(]/)[0].replace('路', '').trim() === name.replace('路', '').trim() && candidate.start_stop === start && candidate.end_stop === end)
                      // The compact viewport tile includes the two display times,
                      // avoiding a duplicate AMap request for a route just picked
                      // from the map.
                      || viewportRoute
                      || timelineLines.find(candidate => candidate.name === line);
                    const inactiveOnTimeline = showTimeline && !!schedule && isLineOperating(schedule, timelineMinute) === false;
                    return (
                      <div 
                        key={line + idx}
                        onClick={() => {
                          const route = !selectedStop && selectedViewportRoutesRef.current.find(route => route.name === line);
                          void handleManualSearch({ name: line, type: 'busline', routeId: route ? route.id : undefined,
                            sourceCity: selectedStop?.key?.startsWith('tile:') ? selectedStop.city : route ? route.city : undefined });
                        }}
                        className={`md:bg-m3-surface md:border md:border-m3-outline-variant/30 md:rounded-2xl md:p-3 bg-m3-surface-container-low rounded-2xl p-2.5 px-3 flex md:gap-3.5 gap-3 items-center md:hover:bg-m3-surface-container-high hover:border-m3-primary/30 transition-all group relative overflow-hidden shrink-0 cursor-pointer snap-center max-w-[220px] md:max-w-none md:w-auto md:h-[72px] border border-transparent shadow-xs ${inactiveOnTimeline ? 'opacity-45 grayscale' : ''}`}
                      >
                        <div className="hidden md:block absolute left-0 top-0 bottom-0 w-1 bg-m3-primary/0 md:group-hover:bg-m3-primary transition-all" />

                        <div className="flex flex-col items-center select-none shrink-0 w-[60px] md:w-[68px]">
                          <div className={`w-full h-8 md:h-[38px] md:bg-m3-surface-container-high md:text-m3-primary text-slate-800 font-extrabold flex items-center justify-center md:border md:border-m3-outline-variant/30 md:shadow-xs md:group-hover:bg-m3-primary md:group-hover:text-m3-on-primary md:rounded-xl transition-all bg-m3-surface-container-high/60 rounded-xl md:p-0 overflow-hidden px-1`}
                          >
                            <span className={`block w-full text-center truncate ${badgeText.length > 5 ? 'text-[9px] md:text-[10px]' : badgeText.length > 3 ? 'text-[11px] md:text-[12px]' : 'text-[13px] md:text-[14px]'}`}>
                              {badgeText}
                            </span>
                          </div>
                          {isUserSub && (
                            <span className="text-[8.5px] font-black text-[#9C7A97] md:hidden mt-1.5 leading-none shrink-0 whitespace-nowrap px-2 py-0.5 rounded bg-[#F3ECF2] border border-[#E2D5E0]">
                              用户添加
                            </span>
                          )}
                        </div>

                        <div className="hidden md:flex flex-col min-w-0 flex-1 justify-center h-full">
                          {isUserSub && (
                            <div className="mb-1 text-left">
                              <span className="px-1.5 py-0.5 rounded bg-[#F3ECF2] text-[9px] font-bold text-[#9C7A97] border border-[#E2D5E0] whitespace-nowrap inline-block leading-none">
                                用户添加
                              </span>
                            </div>
                          )}
                          <div className="flex flex-col gap-1.5">
                            {start !== '-' ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-[#5E8271] shrink-0" />
                                  <span className="text-[11px] font-bold text-slate-700 truncate leading-none">{start}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-[#B56666] shrink-0" />
                                  <span className="text-[11px] font-medium text-slate-400 truncate leading-none">{end}</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-[10px] font-medium text-slate-400 italic px-1">
                                {t('noDirection')}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0"><OperatingHours first={schedule?.stime} last={schedule?.etime} description={schedule && 'scheduleDescription' in schedule ? schedule.scheduleDescription : undefined} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {stationConnectivityCard && !isAnswering && (
            <motion.div
              layout
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-[76px] left-4 right-4 md:top-[80px] md:bottom-auto md:left-4 md:right-auto z-[70] pointer-events-auto md:w-[340px]"
            >
              <div className="backdrop-blur-xl bg-m3-surface/98 border border-m3-outline-variant/40 p-4 rounded-[1.75rem] shadow-2xl max-h-[calc(100vh-140px)] overflow-hidden flex flex-col relative select-none">
                <button 
                  onClick={() => {
                    setStationConnectivityCard(null);
                    clearPriorityCoverage();
                    setConnectivityToast(null);
                  }}
                  type="button"
                  className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-m3-surface-container text-m3-outline hover:text-m3-primary hover:bg-m3-primary-container transition-all shadow-xs z-10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                <div className="mb-3 pr-8">
                  <h3 className="text-base font-black text-slate-800 tracking-tight truncate">
                    {stationConnectivityCard.stop.name}的通达度
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
                  {/* AI Summary Section */}
                  <div className="p-3.5 rounded-2xl bg-m3-primary-container/20 border border-m3-primary/10">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-4 bg-m3-primary rounded-full" />
                      <span className="text-[11px] font-black text-m3-primary uppercase tracking-wider">通达度总结 Busline AI</span>
                    </div>
                    <div className="text-xs text-slate-600 leading-relaxed min-h-[60px] whitespace-pre-wrap">
                      {stationConnectivityCard.aiSummary || (coverageBusy ? '正在思考中...' : '点击查询后生成 AI 总结...')}
                    </div>
                  </div>

                  {/* Settings Section */}
                  <div className="grid grid-cols-2 gap-3">
                    <div 
                      onClick={() => {
                        const nextEnabled = !stationConnectivityCard.transferEnabled;
                        setStationConnectivityCard({ 
                          ...stationConnectivityCard, 
                          transferEnabled: nextEnabled,
                          atStation: nextEnabled ? 1 : 0
                        });
                      }}
                      className={`flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all ${stationConnectivityCard.transferEnabled ? 'bg-m3-primary/5 border-m3-primary/30' : 'bg-slate-50 border-slate-200'}`}
                    >
                      <span className="text-xs font-bold text-slate-700">启用换乘</span>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${stationConnectivityCard.transferEnabled ? 'bg-m3-primary border-m3-primary' : 'bg-white border-slate-300'}`}>
                        {stationConnectivityCard.transferEnabled && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 p-1.5 border rounded-2xl transition-all ${stationConnectivityCard.transferEnabled ? 'bg-slate-50 border-slate-200' : 'bg-slate-100/50 border-slate-100 opacity-60'}`}>
                      <button 
                        onClick={() => {
                          if (!stationConnectivityCard.transferEnabled) return;
                          setStationConnectivityCard({ ...stationConnectivityCard, atStation: Math.max(1, stationConnectivityCard.atStation - 1) });
                        }}
                        disabled={!stationConnectivityCard.transferEnabled}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <div className="flex-1 text-center">
                        <span className="text-[10px] text-slate-400 block leading-none mb-0.5">第几站</span>
                        <span className="text-xs font-black text-slate-800 leading-none">{stationConnectivityCard.atStation}</span>
                      </div>
                      <button 
                        onClick={() => {
                          if (!stationConnectivityCard.transferEnabled) return;
                          setStationConnectivityCard({ ...stationConnectivityCard, atStation: Math.min(200, stationConnectivityCard.atStation + 1) });
                        }}
                        disabled={!stationConnectivityCard.transferEnabled}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {connectivityToast && (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold">
                      {connectivityToast}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      executeStationConnectivity(
                        stationConnectivityCard.stop,
                        new Set(), // Pass empty set as it's ignored
                        stationConnectivityCard.transferEnabled,
                        stationConnectivityCard.atStation
                      );
                    }}
                    disabled={coverageBusy || isSearching}
                    className="w-full py-3.5 px-6 rounded-2xl bg-slate-800 text-white font-black text-xs shadow-xl hover:bg-slate-900 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {coverageBusy ? <Loader2 className="w-4 h-4 animate-spin text-m3-primary" /> : <Search className="w-4 h-4 text-white" />}
                    查询通达度
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeBusLine && !isAnswering && (
            <motion.div
              layout
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              onPointerDown={() => setTopCard('line')}
              className={`fixed ${(selectedStop || selectedSegmentLines) ? 'bottom-[200px]' : 'bottom-[76px]'} md:bottom-auto left-4 right-4 md:top-20 md:left-4 ${topCard === 'line' ? 'z-[55]' : 'z-[45]'} md:w-64 pointer-events-auto md:h-[calc(100vh-200px)]`}
            >
              <div className="backdrop-blur-xl bg-m3-surface/98 border border-m3-outline-variant/40 rounded-[1.75rem] shadow-xl h-[100px] md:h-full flex flex-col overflow-hidden relative">
                <button 
                  onClick={() => {
                    setActiveBusLine(null);
                    if (lineGroupRef.current && activeBusLinePolylineRef.current) {
                      try {
                        lineGroupRef.current.removeOverlay(activeBusLinePolylineRef.current);
                      } catch (e) {}
                      activeBusLinePolylineRef.current = null;
                    }
                    activeRawMarkersRef.current = roadStopMarkersRef.current;
                    allMapStopsRef.current = new Map(roadStopsDataRef.current);
                    if (mapInstance && (window as any).AMap) {

                    }
                    requestAnimationFrame(() => {
                      const bw = lineThickness === 'thin' ? 0.5 : 1.5;
                      roadOverlaysRef.current.forEach((polyline: any) => {
                        try {
                          polyline.setOptions({
                            strokeOpacity: 0.9,
                            outlineColor: '#ffffff',
                            borderWeight: bw
                          });
                        } catch (e) {}
                      });
                    });
                  }}
                  className="absolute top-2.5 right-2.5 md:top-3 md:right-3 w-7 h-7 flex items-center justify-center hover:bg-m3-surface-container-high rounded-full transition-colors bg-m3-surface-container text-m3-outline hover:text-m3-primary shadow-xs z-10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="relative p-2.5 px-4 pr-24 md:p-4 md:pr-24 md:py-4 border-b border-m3-outline-variant/20 shrink-0 flex flex-col items-start gap-1">
                  <div className="absolute right-4 top-3"><OperatingHours first={activeBusLine.stime} last={activeBusLine.etime} description={activeBusLine.scheduleDescription} /></div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-black text-slate-800 text-sm md:text-lg whitespace-nowrap">
                      {parseLineInfo(activeBusLine.name).name.replace('路','')}
                    </span>
                    {activeBusLine.isUserSubmitted && (
                      <span className="px-1.5 py-0.5 rounded bg-[#F3ECF2] text-[8px] font-bold text-[#9C7A97] border border-[#E2D5E0] whitespace-nowrap">
                        用户添加
                      </span>
                    )}
                  </div>
                  {activeBusLine.isUserSubmitted && activeBusLine.creatorNickname && (
                    <span className="text-[10px] text-[#9C7A97] font-bold leading-none">
                      绘制者：{activeBusLine.creatorNickname}
                    </span>
                  )}
                  <span className="text-[10px] md:text-xs text-slate-500 font-medium truncate">
                    {parseLineInfo(activeBusLine.name).start !== '-' ? `${parseLineInfo(activeBusLine.name).start} - ${parseLineInfo(activeBusLine.name).end}` : '环线 / 方向未知'}
                  </span>
                </div>
                <div className="flex-1 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto custom-scrollbar p-0 md:p-4 md:pr-2 flex flex-row md:flex-col items-center md:items-stretch snap-x snap-mandatory mt-1 md:mt-0">
                  <div className="relative flex flex-row md:flex-col items-center md:items-stretch md:pl-1 h-full md:h-auto w-max md:w-auto px-4 md:px-0">
                    <div className="hidden md:block absolute left-[9px] top-4 bottom-4 w-0.5 bg-m3-outline-variant/30" />
                    <div className="md:hidden absolute top-[14px] left-8 right-8 h-0.5 bg-m3-outline-variant/30" />
                    {(activeBusLine.via_stops || []).map((stop: any, idx: number) => {
                      const isSelected = selectedStop?.name === stop.name;
                      const count = stopCountCacheRef.current.get(`${stop.location.lng},${stop.location.lat}`) || 0;
                      const iconColor = getStopColor(count, '#52796F');
                      return (
                        <div 
                          key={idx} 
                          className="flex flex-col md:flex-row items-center md:items-start md:mb-4 relative cursor-pointer group px-2 md:px-0 shrink-0 snap-center min-w-[72px] md:min-w-0"
                          onClick={async () => {
                            if (!mapRef.current) return;
                            mapRef.current.setCenter([stop.location.lng, stop.location.lat]);
                            mapRef.current.setZoom(17);
                            setSelectionPos([stop.location.lng, stop.location.lat]);
                            setSelectedStop({
                              name: stop.name,
                              address: t('loadingDetails'),
                              lines: [],
                              city: currentCity
                            });
                            const details = await fetchStopDetails(stop.name, [stop.location.lng, stop.location.lat], (window as any).AMap, currentCity);
                            if (details) {
                              setSelectedStop({ ...details, city: currentCity });
                            } else {
                              setSelectedStop({
                                name: stop.name,
                                address: '无详细线路数据',
                                lines: [activeBusLine.name.split('(')[0]],
                                city: currentCity,
                                isBusStop: true
                              });
                            }
                          }}
                        >
                          <div className={`flex flex-col items-center shrink-0 pt-0.5 my-2 md:my-0 md:mr-3 ${isSelected ? 'scale-125' : 'group-hover:scale-125'} transition-transform`}>
                            <div className="w-[12px] h-[12px] md:w-[14px] md:h-[14px] rounded-full border-2 md:border-3 border-white shadow-xs z-10" style={{ backgroundColor: iconColor, boxShadow: `0 0 0 1px ${iconColor}4D` }} />
                          </div>
                          <div className={`text-[10px] md:text-xs font-bold leading-tight md:pt-0.5 transition-colors w-full text-center md:text-left truncate px-1 md:px-0 ${isSelected ? 'text-m3-primary font-black' : 'text-slate-700 group-hover:text-m3-primary'}`}>
                            {stop.name}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!isAnswering && !isDrawingMode && (
          <button 
            type="button"
            onClick={handleLocate}
            className="fixed bottom-22 sm:bottom-6 right-4 sm:right-6 z-30 backdrop-blur-xl border border-m3-outline-variant/40 bg-m3-surface/95 text-slate-700 hover:text-m3-primary hover:bg-m3-surface-container-high w-11 h-11 sm:w-12 sm:h-12 rounded-full shadow-[0_6px_20px_rgba(28,47,39,0.15)] flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 group pointer-events-auto"
            title="定位当前位置"
          >
            <Navigation className="w-5 h-5 transition-transform group-hover:scale-110 text-m3-primary fill-current" />
          </button>
        )}

        <AnimatePresence>
          {showVersionUpdate && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm pointer-events-auto">
              <motion.div role="dialog" aria-modal="true" aria-labelledby="version-update-title"
                initial={{ opacity: 0, y: 16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', damping: 24, stiffness: 240 }}
                className="w-[360px] max-w-full bg-m3-surface border border-m3-outline-variant/40 rounded-[28px] shadow-2xl p-7 text-center">
                <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-m3-primary-container text-m3-primary flex items-center justify-center"><Check className="w-7 h-7" /></div>
                <h2 id="version-update-title" className="text-lg font-black text-m3-on-primary-container">版本已更新至 {APP_VERSION}</h2>
                <button type="button" autoFocus onClick={() => {
                  localStorage.setItem(APP_LAST_VERSION_KEY, APP_VERSION);
                  setShowVersionUpdate(false);
                }} className="w-full mt-6 py-3 rounded-full bg-m3-primary text-white text-sm font-bold hover:opacity-95 active:scale-95 transition-all">进入主页</button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>

      {!isAnswering && <footer className="fixed bottom-2 right-4 sm:bottom-3 sm:right-6 z-10 pointer-events-none flex flex-col items-end gap-1.5">
        <p className="max-w-[70vw] text-right text-[10px] leading-snug text-slate-600 bg-m3-surface/85 rounded px-1.5 py-0.5">
          公交线路数据来源：高德地图开放平台 · 仅供参考
        </p>
        <div className="mr-1 cursor-pointer pointer-events-auto" onClick={handleFooterClick}>
          <span className="text-[9px] font-bold text-slate-400 opacity-60 uppercase tracking-widest leading-none select-none">@TsFeng</span>
        </div>
        {showMoreInfo && (
          <div className="hidden md:flex backdrop-blur-xl bg-white/70 border border-white/50 p-1 px-4 rounded-xl shadow-xl items-center gap-2 pointer-events-auto h-[44px]">
            <div className="py-2 flex items-center gap-3 text-slate-500">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{t('level')}</span>
              <span className="text-sm font-black text-slate-700 leading-none">{zoomLevel.toFixed(1)}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`w-1 h-1 rounded-full transition-all ${
                    (zoomLevel - 13) * 2 >= i ? 'bg-blue-500' : 'bg-slate-200'
                  }`} />
                ))}
              </div>
            </div>
          </div>
        )}
      </footer>}


    </div>
  );
}
