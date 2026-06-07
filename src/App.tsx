import { useEffect, useRef, useState, useCallback } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { BusStop, BusLine, LineSegment } from './types';
import { Bus, Map as MapIcon, ZoomIn, Info, Loader2, List, X, Search, Settings, Camera, Eye, EyeOff, Navigation, Paintbrush, ClipboardCheck, Database, Trash2, Edit3, Undo, Redo, MapPin, Check, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import { 
  isFirebaseEnabled, 
  submitLineToFirebase, 
  fetchApprovedLinesFromFirebase, 
  checkSubmissionStatusFromFirebase, 
  getPendingSubmissionsFromFirebase, 
  updateSubmissionStatusInFirebase, 
  editApprovedLineInFirebase, 
  deleteApprovedLineInFirebase 
} from './firebase';

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '20f5c6b65349e5d4cb5f58c7e0c4a4ba'; 
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE || '312d8a4369a48971f1f9e2b19280d075';

if (typeof window !== 'undefined') {
  (window as any)._AMapSecurityConfig = {
    securityJsCode: SECURITY_CODE,
  };
}

const checkIsLineQuery = (str: string): boolean => {
  if (!str) return false;
  const s = str.trim();
  
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

export default function App() {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const getStopColor = useCallback((count: number, defaultColor: string) => {
    if (!stationLineStatsRef.current || count === 0) return defaultColor;
    if (count <= 2) return '#06b6d4'; // Cyan
    if (count <= 6) return '#f97316'; // Orange
    return '#a855f7'; // Purple
  }, []);

  const mapClickHandlerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('map_zoom');
    return saved ? parseFloat(saved) : 11;
  });
  const [selectedSegmentLines, setSelectedSegmentLines] = useState<string[] | null>(null);
  const [selectedStop, setSelectedStop] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showLargeAreaWarning, setShowLargeAreaWarning] = useState(false);
  const [stats, setStats] = useState({ stops: 0, lines: 0 });
  const [cacheUpdateTick, setCacheUpdateTick] = useState(0);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [showStations, setShowStations] = useState(() => {
    const saved = localStorage.getItem('app_show_stations');
    return saved === null ? true : saved === 'true';
  });
  const [showBaseMap, setShowBaseMap] = useState(() => {
    const saved = localStorage.getItem('app_show_basemap');
    return saved === null ? true : saved === 'true';
  });
  const [showMoreInfo, setShowMoreInfo] = useState(() => {
    const saved = localStorage.getItem('app_show_more_info');
    return saved === null ? false : saved === 'true';
  });
  const [stationLineStats, setStationLineStats] = useState(() => {
    const saved = localStorage.getItem('app_station_line_stats');
    return saved === null ? true : saved === 'true';
  });
  const stationLineStatsRef = useRef(stationLineStats);
  useEffect(() => { stationLineStatsRef.current = stationLineStats; }, [stationLineStats]);
  
  const stopCountCacheRef = useRef<Map<string, number>>(new Map());

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'experimental' | 'about' | 'dataFilter'>('general');
  const [filterAirportBus, setFilterAirportBus] = useState(() => {
    const saved = localStorage.getItem('app_filter_airport_bus');
    return saved === null ? false : saved === 'true';
  });
  const filterAirportBusRef = useRef(filterAirportBus);
  useEffect(() => {
    filterAirportBusRef.current = filterAirportBus;
  }, [filterAirportBus]);

  const [enableCityWideSearch, setEnableCityWideSearch] = useState(() => {
    return localStorage.getItem('app_experimental_citywide') === 'true';
  });
  const [showCityWideConfirm, setShowCityWideConfirm] = useState(false);
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem('app_lang') || 'zh-CN';
  });
  const [lineThickness, setLineThickness] = useState<'thick' | 'thin'>(() => {
    const saved = localStorage.getItem('app_line_thickness');
    return (saved === 'thin' || saved === 'thick') ? saved : 'thick';
  });
  const [showToolbox, setShowToolbox] = useState(false);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [activeBusLine, setActiveBusLine] = useState<any | null>(null);

  // --- USER DEFINED DRAWING AND ADMIN STATES ---
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

  // Admin and stats
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminMode, setAdminMode] = useState(false); // keep for compatibility or reference if needed
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const [editingLineName, setEditingLineName] = useState('');
  const [pendingSubmissions, setPendingSubmissions] = useState<any[]>([]);

  const [footerClickCount, setFooterClickCount] = useState(0);
  const [lastFooterClickTime, setLastFooterClickTime] = useState(0);

  const drawingGroupRef = useRef<any>(null);
  const isRoutingRef = useRef(false);

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
    try {
      let list: any[] = [];
      if (isFirebaseEnabled()) {
        console.log("Firebase is active, fetching approved lines from cloud Firestore...");
        list = await fetchApprovedLinesFromFirebase();
      } else {
        const url = `${window.location.origin}/api/submissions/approved`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        list = data || [];
      }
      
      // Load local-only static lines too!
      const localSaved = localStorage.getItem('client_approved_user_lines');
      if (localSaved) {
        try {
          const localList = JSON.parse(localSaved);
          localList.forEach((ul: any) => {
            if (!list.some((existing: any) => existing.id === ul.id)) {
              list.push(ul);
            }
          });
        } catch (e) {
          console.error(e);
        }
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
        const url = `${window.location.origin}/api/submissions/status?ids=${encodeURIComponent(ids)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        data = await res.json();
      }
      
      // Merge with custom statuses of lines locally saved/approved
      const mergedStatuses = { ...data };
      historicalList.forEach((h: any) => {
        if (h && h.id && !mergedStatuses[h.id]) {
          mergedStatuses[h.id] = h.status || 'approved';
        }
      });
      setSubmissionStatuses(mergedStatuses);
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
    fetchApprovedLines();
  }, []);

  useEffect(() => {
    if (historicalSubmissions.length > 0) {
      checkSubmissionStatuses(historicalSubmissions);
    }
  }, [historicalSubmissions]);

  // Translation dictionary
  const translations: Record<string, any> = {
    'zh-CN': {
      settings: '设置',
      general: '通用',
      dataFilter: '数据筛选',
      filterAirportBus: '过滤机场巴士',
      filterUserSubmissions: '过滤用户添加',
      stationLineStats: '站点线路统计',
      about: '关于',
      language: '语言设置',
      version: '当前版本',
      startSearch: '检索',
      searching: '检索中...',
      showStations: '显示站点',
      showBaseMap: '显示底图',
      showMoreInfo: '详细信息',
      lineThickness: '线条粗细',
      thick: '粗线条',
      thin: '细线条',
      experimental: '实验功能',
      cityWideSearch: '全市搜索',
      cityWideSearchWarning: '警告！全市搜索性能消耗较大，可能会导致设备极度不稳定，请知悉',
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
    },
    'zh-TW': {
      settings: '設置',
      general: '通用',
      dataFilter: '數據篩選',
      filterAirportBus: '過濾機場巴士',
      filterUserSubmissions: '過濾用戶添加',
      stationLineStats: '站點線路統計',
      about: '關於',
      language: '語言設置',
      version: '當前版本',
      startSearch: '檢索',
      searching: '檢索中...',
      showStations: '顯示站點',
      showBaseMap: '顯示底圖',
      showMoreInfo: '詳細資訊',
      lineThickness: '線條粗細',
      thick: '粗線條',
      thin: '細線條',
      experimental: '實驗功能',
      cityWideSearch: '全市搜索',
      cityWideSearchWarning: '警告！全市搜索性能消耗較大，可能會導致設備極度不穩定，請知悉',
      cancel: '取消',
      confirmEnable: '確認開啟',
      stats: '統計',
      stops: '站點',
      lines: '線路',
      searchHint: '請放大以檢索',
      locate: '定位',
      level: '縮放',
      title: '巴士線路圖',
      searchPlaceholder: '搜索公交站、線路...',
      loadingDetails: '正在加載詳情...',
      connectivity: '查看通達度',
      noDirection: '暫無方向信息',
      warning: '線路加載較多，請等待...',
      initializing: '系統初始化中',
      lineLabel: '線路',
    },
    'en': {
      settings: 'Settings',
      general: 'General',
      dataFilter: 'Data Filter',
      filterAirportBus: 'Filter Airport Bus',
      filterUserSubmissions: 'Filter User Submitted',
      stationLineStats: 'Station Line Stats',
      about: 'About',
      language: 'Language',
      version: 'Version',
      startSearch: 'Search',
      searching: 'Searching...',
      showStations: 'Stations',
      showBaseMap: 'Base Map',
      showMoreInfo: 'Details',
      lineThickness: 'Line Thickness',
      thick: 'Thick',
      thin: 'Thin',
      experimental: 'Experimental',
      cityWideSearch: 'City-wide Search',
      cityWideSearchWarning: 'Warning! City-wide search consumes significant performance and may cause severe device instability. Please be aware.',
      cancel: 'Cancel',
      confirmEnable: 'Confirm Enable',
      stats: 'Stats',
      stops: 'Stops',
      lines: 'Lines',
      searchHint: 'Zoom to search',
      locate: 'Locate',
      level: 'Level',
      title: 'busline',
      searchPlaceholder: 'Search stops, lines...',
      loadingDetails: 'loading details...',
      connectivity: 'connectivity',
      noDirection: 'no direction data',
      warning: 'high load, please wait...',
      initializing: 'initializing system',
      lineLabel: 'line',
    }
  };

  const t = (key: string) => {
    const val = translations[language]?.[key] || translations['zh-CN'][key];
    if (language === 'en') {
      // For English, ensure lowercase as requested for 'busline' and other labels
      if (key === 'title') return 'busline';
      if (key === 'lineLabel') return 'line';
      if (key === 'loadingDetails') return 'loading details...';
      if (key === 'noDirection') return 'no direction data';
      if (key === 'warning') return 'high load, please wait...';
      if (key === 'initializing') return 'initializing system';
      if (key === 'connectivity') return 'connectivity';
    }
    return val;
  };

  useEffect(() => {
    localStorage.setItem('app_lang', language);
  }, [language]);
  
  useEffect(() => {
    localStorage.setItem('app_line_thickness', lineThickness);
    
    // Auto-redraw lines after changing thickness
    if (mapInstance) {
      if (activeBusLine) {
        renderBusLine(activeBusLine, (window as any).AMap, mapInstance, true, true, false);
      } else if (selectedSegmentLines && selectedSegmentLines.length > 0) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      }
    }
  }, [lineThickness]);

  const [baseMapVisible, setBaseMapVisible] = useState(true);
  const [selectionPos, setSelectionPos] = useState<[number, number] | null>(null);
  const [selectedSegmentName, setSelectedSegmentName] = useState<string | null>(null);
  const [selectedSegmentAddress, setSelectedSegmentAddress] = useState<string | null>(null);
  const [currentCity, setCurrentCity] = useState<string>('全国');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autoCompleteRef = useRef<any>(null);
  
  const getRandomPastelColor = () => {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, 70%, 60%)`;
  };

  const handleLocate = () => {
    if (!mapRef.current) return;
    setLoading(true);
    mapRef.current.plugin('AMap.Geolocation', function() {
      const geolocation = new (window as any).AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 10000,
        buttonPosition: 'RB',
      });
      geolocation.getCurrentPosition((status: string, result: any) => {
        setLoading(false);
        if (status === 'complete') {
          mapRef.current.setCenter(result.position);
          mapRef.current.setZoom(16);
        }
      });
    });
  };

  const renderBusLine = (line: any, AMap: any, map: any, clear = true, showMarkers = true, shouldFitView = true) => {
    const path = line.path.map((p: any) => Array.isArray(p) ? p : [p.lng, p.lat]);
    
    if (lineGroupRef.current) {
      if (clear) lineGroupRef.current.clearOverlays();
      const polyline = new AMap.Polyline({
        path: path,
        strokeColor: line.isUserSubmitted ? '#BA55D3' : (clear ? '#3b82f6' : getRandomPastelColor()),
        strokeWeight: lineThickness === 'thin' ? 2.5 : 5,
        strokeOpacity: 0.8,
        lineJoin: 'round',
        lineCap: 'round',
        isOutline: true,
        outlineColor: '#ffffff',
        borderWeight: lineThickness === 'thin' ? 0.5 : 1.5,
        zIndex: 50
      });
      if (clear) {
        setActiveBusLine(line);
        polyline.on('click', (e: any) => {
          const clickLngLat = [e.lnglat.getLng(), e.lnglat.getLat()];
          
          if (!(window as any).AMap.GeometryUtil) return;
          const GeometryUtil = (window as any).AMap.GeometryUtil;
          
          // Map stops to path indices
          const stopIndices = line.via_stops.map((stop: any) => {
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
                city: currentCity,
                isBusStop: false,
                segmentName: `${line.via_stops[prevStopIdx].name} - ${line.via_stops[nextStopIdx].name}`
              });
            }
          });
        });
      }
      lineGroupRef.current.addOverlay(polyline);
    }

    if (markerGroupRef.current && showMarkers) {
      if (clear) markerGroupRef.current.clearOverlays();
      const markers = line.via_stops.map((stop: any) => {
        const count = stopCountCacheRef.current.get(`${stop.location.lng},${stop.location.lat}`) || 0;
        const marker = new AMap.CircleMarker({
          center: [stop.location.lng, stop.location.lat],
          radius: 6,
          fillColor: getStopColor(count, '#3b82f6'),
          strokeColor: '#fff',
          strokeWeight: 1.5,
          zIndex: 60,
          cursor: 'pointer',
          extData: { key: `${stop.location.lng},${stop.location.lat}`, type: 'busLineStop' }
        });
        marker.on('click', async () => {
          setSelectionPos([stop.location.lng, stop.location.lat]);
          setSelectedStop({
            name: stop.name,
            address: t('loadingDetails'),
            lines: [],
            city: currentCity
          });
          
          // Fetch full details to show all lines
          const details = await fetchStopDetails(stop.name, [stop.location.lng, stop.location.lat], AMap, currentCity);
          if (details) {
            setSelectedStop({ ...details, city: currentCity });
          } else {
             setSelectedStop({
               name: stop.name,
               address: '无详细线路数据',
               lines: [line.name.split('(')[0]], // Fallback to current line if data missing
               city: currentCity
             });
          }
        });
        return marker;
      });
      markerGroupRef.current.addOverlays(markers);
    }
    if (shouldFitView) map.setFitView();
  };

  const showStopConnectivity = async (stopLines: string[]) => {
    if (!lineGroupRef.current || !markerGroupRef.current || !(window as any).AMap || !stopLines.length) return;
    
    setIsSearching(true);
    lineGroupRef.current.clearOverlays();
    markerGroupRef.current.clearOverlays();
    setStats(prev => ({ ...prev, lines: stopLines.length }));
    
    const AMap = (window as any).AMap;
    const lineSearch = new AMap.LineSearch({
      city: currentCity || '全国',
      pageIndex: 1,
      pageSize: 1,
      extensions: 'all'
    });

    let completed = 0;
    const total = stopLines.length;
    
    // Batch processing to avoid overwhelming the API and UI
    const BATCH_SIZE = 5;
    for (let i = 0; i < stopLines.length; i += BATCH_SIZE) {
      const batch = stopLines.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (lineStr) => {
        return new Promise<void>((resolve) => {
          const { name: shortName } = parseLineInfo(lineStr);
          
          // Add a safety timeout for each search
          const timeout = setTimeout(() => {
            completed++;
            if (completed === total) {
              mapRef.current?.setFitView();
              setIsSearching(false);
            }
            resolve();
          }, 8000);

          lineSearch.search(shortName, (status: string, result: any) => {
            clearTimeout(timeout);
            completed++;
            if (result.lineInfo && filterAirportBusRef.current) {
              result.lineInfo = result.lineInfo.filter((l: any) => !/机场(巴士|大巴|专线|快线)/.test(l.name));
            }
            if (status === 'complete' && result.lineInfo && result.lineInfo.length > 0) {
              let bestLine = result.lineInfo[0];
              const exactMatch = result.lineInfo.find((l: any) => l.name === lineStr);
              if (exactMatch) {
                bestLine = exactMatch;
              } else if (lineStr.includes('(')) {
                const match = lineStr.match(/\((.+?)[-]+(.+?)\)/);
                if (match) {
                  const start = match[1];
                  const end = match[2];
                  const found = result.lineInfo.find((l: any) => 
                    l.name.includes(start) && l.name.includes(end)
                  );
                  if (found) bestLine = found;
                }
              }
              renderBusLine(bestLine, AMap, mapRef.current, false, false, false);
            }
            
            if (completed === total) {
              mapRef.current?.setFitView();
              setIsSearching(false);
            }
            resolve();
          });
        });
      }));
    }
  };

  const fetchStopDetails = async (name: string, location: [number, number], AMap: any, city: string): Promise<any> => {
    const getDistSq = (p1: [number, number], p2: [number, number]) => {
      return Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 15000);
      const safeResolve = (val: any) => {
        clearTimeout(timer);
        if (val && val.lines) {
          const cleanStopName = name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').replace(/\s*-\s*\d+$/, '').trim();
          const matchUserLines = approvedUserLines
            .filter(ul => {
              if (localStorage.getItem('app_filter_user_submissions') === 'true') {
                return false;
              }
              return ul.via_stops.some((vs: any) => {
                const cleanVs = vs.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '').trim();
                return cleanVs === cleanStopName;
              });
            })
            .map(ul => ul.name);
          val.lines = Array.from(new Set([...val.lines, ...matchUserLines]));
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
          const shortLines = addressStr.split(';').map((s: string) => s.trim()).filter((s: string) => 
            s.length > 0 && !s.includes('区间') && (!filterAirportBusRef.current || !/机场(巴士|大巴|专线|快线)/.test(s))
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

  const onStopClick = async (item: any) => {
    const map = mapRef.current;
    if (!map) return;
    const AMap = (window as any).AMap;
    if (!AMap) return;

    if (item.location) {
      map.setCenter([item.location.lng, item.location.lat]);
      if (map.getZoom() < 16) map.setZoom(16);
      setSelectionPos([item.location.lng, item.location.lat]);
    }
    
    setSelectedStop({
      name: item.name,
      address: t('loadingDetails'),
      lines: [],
      city: currentCity
    });

    const pos = item.location ? [item.location.lng, item.location.lat] : (selectionPos || [0, 0]);
    const details = await fetchStopDetails(item.name, pos as [number, number], AMap, currentCity);
    if (details) {
      setSelectedStop({ ...details, city: currentCity });
    } else {
      setSelectedStop({
        name: item.name,
        address: item.address,
        lines: (item.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => 
          s.length > 0 && !s.includes('区间') && (!filterAirportBusRef.current || !/机场(巴士|大巴|专线|快线)/.test(s))
        ),
        city: currentCity
      });
    }
  };

  const toggleStations = () => {
    const next = !showStations;
    setShowStations(next);
    localStorage.setItem('app_show_stations', next.toString());
  };

  const toggleBaseMap = () => {
    const next = !showBaseMap;
    setShowBaseMap(next);
    localStorage.setItem('app_show_basemap', next.toString());
  };

  const toggleFilterAirportBus = () => {
    const next = !filterAirportBus;
    setFilterAirportBus(next);
    localStorage.setItem('app_filter_airport_bus', next.toString());
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
      } else if (selectedSegmentLines && selectedSegmentLines.length > 0) {
        const AMap = (window as any).AMap;
        aggregateAndVisualize(selectedSegmentLines, mapInstance, AMap);
      } else {
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

  const toggleMoreInfo = () => {
    const next = !showMoreInfo;
    setShowMoreInfo(next);
    localStorage.setItem('app_show_more_info', next.toString());
  };

  // --- USER DRAWING OPERATIONS AND ROUTING HANDLERS ---
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
        name: '',
        isStop: true,
        pathFromPrev: []
      };
      setUndoStack(u => [...u, currentPoints]);
      setRedoStack([]);
      setDrawnPoints([firstPt]);
      
      // Immediately trigger naming modal for first stop
      setTimeout(() => {
        setNamingStopIdx(0);
        setNamingValue('');
      }, 100);
      return;
    }

    // 2. Subsequent points (limit distance <= 5km)
    const lastPt = currentPoints[currentPoints.length - 1];
    const p1 = new AMap.LngLat(lastPt.lng, lastPt.lat);
    const p2 = new AMap.LngLat(clickedLngLat.lng, clickedLngLat.lat);
    const dist = AMap.GeometryUtil.distance(p1, p2);

    if (dist > 5000) {
      alert('两点之间的距离不能超过 5 千米！当前距离: ' + (dist / 1000).toFixed(2) + ' km');
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
            lng: snappedEnd.lng,
            lat: snappedEnd.lat,
            name: '',
            isStop: false,
            pathFromPrev: pathStepCoordinates
          };

          const currentSnapshot = drawnPointsRef.current;
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
    setNamingStopIdx(selectedPointIdx);
    setNamingValue(drawnPoints[selectedPointIdx].name || '');
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
        const success = await submitLineToFirebase(submissionData);
        setLoading(false);
        if (success) {
          alert('您的自绘线路已成功通过云端数据库（Firebase）提交至审核列表中！后续可在“查看历史提交”中跟踪动态审核结果。');
          setDrawnPoints([]);
          setUndoStack([]);
          setRedoStack([]);
          setSelectedPointIdx(null);
          setIsDrawingMode(false);
          setShowSubmitModal(false);
          setSubmitLineName('');
          checkSubmissionStatuses(updatedHistory);
        } else {
          alert('提交失败：无法上传该路线到 Firebase，请检查网络后重试。');
        }
      } else {
        const res = await fetch('/api/submissions/submit', {
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
        } else {
          alert('提交失败: ' + (resData.error || '未知错误'));
        }
      }
    } catch (err: any) {
      setLoading(false);
      console.warn('Backend unavailable, falling back to local storage approval:', err);
      
      // Auto-approve locally
      const localSaved = localStorage.getItem('client_approved_user_lines');
      let localList = [];
      if (localSaved) {
        try {
          localList = JSON.parse(localSaved);
        } catch (e) {
          console.error(e);
        }
      }
      
      const approvedLocalData = {
        ...submissionData,
        status: 'approved' // Auto-approve locally
      };
      
      localList.unshift(approvedLocalData);
      localStorage.setItem('client_approved_user_lines', JSON.stringify(localList));
      
      // Also update history item to show as approved locally
      const updatedHistoryApproved = updatedHistory.map(h => h.id === submissionId ? approvedLocalData : h);
      setHistoricalSubmissions(updatedHistoryApproved);
      localStorage.setItem('user_drawn_lines_history', JSON.stringify(updatedHistoryApproved));
      
      // Refresh approved lines array and cache in memory immediately
      fetchApprovedLines();
      
      alert('【提示：检测到当前为 GitHub Pages/静态网站托管环境且尚未配置 Cloud API】\n\n自绘线路已为您进行「本地免审发布」！若想实现多端同步和线上管理员审核，请按照提示在项目设置中配置 Firebase 凭据。\n\n您现在可以无需审核，直接检索、过滤并在地图上查看此路线啦！');
      
      setDrawnPoints([]);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedPointIdx(null);
      setIsDrawingMode(false);
      setShowSubmitModal(false);
      setSubmitLineName('');
    }
  };

  const handleFooterClick = () => {
    const now = Date.now();
    if (now - lastFooterClickTime < 800) {
      const nextCount = footerClickCount + 1;
      if (nextCount >= 3) {
        if (isAdminVerified) {
          setIsAdminVerified(false);
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
    const trimmed = adminPassword.trim();
    const hashed = await sha256(trimmed);
    // faedebd79ac7e61e058a5f36e6b5a3746bd7a13dff63daceece4bd0135d97fbd matches SHA-256 for 'buslineadmin'
    if (hashed === 'faedebd79ac7e61e058a5f36e6b5a3746bd7a13dff63daceece4bd0135d97fbd' || trimmed === 'buslineadmin') {
      setIsAdminVerified(true);
      setShowAdminLogin(false);
      setAdminPassword('');
      fetchPendingSubmissions();
      alert('密码验证成功！管理员模式已激活。');
    } else {
      alert('密码验证失败！请确定输入正确的安全私钥凭据。');
    }
  };

  const fetchPendingSubmissions = async () => {
    try {
      if (isFirebaseEnabled()) {
        const data = await getPendingSubmissionsFromFirebase();
        setPendingSubmissions(data || []);
      } else {
        const res = await fetch('/api/admin/pending');
        const data = await res.json();
        setPendingSubmissions(data || []);
      }
    } catch (err) {
      console.error('Failed to query pending registrations:', err);
    }
  };

  const handleAdminAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      setLoading(true);
      if (isFirebaseEnabled()) {
        const success = await updateSubmissionStatusInFirebase(id, action === 'approve' ? 'approved' : 'rejected');
        setLoading(false);
        if (success) {
          alert(action === 'approve' ? '审核通过，已将该线路设置为正式发布状态！所有人现在都可以实时看到了！' : '线路已被拒绝并已从数据库中成功删除。');
          fetchPendingSubmissions();
          fetchApprovedLines();
          checkSubmissionStatuses(historicalSubmissions);
        } else {
          alert('管理员执行操作发生 Firebase 数据库错误，请检查规则配置后重试。');
        }
      } else {
        const pathUrl = action === 'approve' ? '/api/admin/approve' : '/api/admin/reject';
        const res = await fetch(pathUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        setLoading(false);

        if (data.success) {
          alert(action === 'approve' ? '审核通过，已将该线路从“审核”文件夹移至正式发布的“用户提交”文件夹！' : '线路已被拒绝并已自动删除服务器文件数据。');
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
        const success = await editApprovedLineInFirebase(id, newName.trim());
        setLoading(false);
        if (success) {
          alert('线路名称在云数据库中更新成功！');
          setEditingLineId(null);
          fetchApprovedLines();
        } else {
          alert('修改名称失败：云数据库写入异常。');
        }
      } else {
        const res = await fetch('/api/admin/edit-approved', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        const success = await deleteApprovedLineInFirebase(id);
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
        const res = await fetch('/api/admin/delete-approved', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

  const toggleCityWideSearch = () => {
    if (!enableCityWideSearch) {
      setShowCityWideConfirm(true);
    } else {
      setEnableCityWideSearch(false);
      localStorage.setItem('app_experimental_citywide', 'false');
    }
  };

  const confirmCityWideSearch = () => {
    setEnableCityWideSearch(true);
    localStorage.setItem('app_experimental_citywide', 'true');
    setShowCityWideConfirm(false);
  };

  const cancelCityWideSearch = () => {
    setShowCityWideConfirm(false);
  };

  const handleManualSearch = async (item: any) => {
    const map = mapRef.current;
    if (!map) return;
    const AMap = (window as any).AMap;
    setShowSuggestions(false);
    setSearchQuery(item.name);

    // Intercept search for approved user custom lines
    const isFilteredOut = localStorage.getItem('app_filter_user_submissions') === 'true';
    const userLine = !isFilteredOut ? approvedUserLines.find(ul => ul.name === item.name || ul.id === item.id) : null;
    if (userLine) {
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
      if (item.lineData) {
        renderBusLine(item.lineData, AMap, map);
        return;
      }

      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: item.adcode || currentCity || '全国',
        pageSize: 1,
        extensions: 'all'
      });
      
      setLoading(true);
      const { name: shortName } = parseLineInfo(item.name);
      
      const timeout = setTimeout(() => setLoading(false), 10000);
      
      lineSearch.search(shortName, (status: string, result: any) => {
        clearTimeout(timeout);
        setLoading(false);
        if (result.lineInfo && filterAirportBusRef.current) {
          result.lineInfo = result.lineInfo.filter((l: any) => !/机场(巴士|大巴|专线|快线)/.test(l.name));
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
          renderBusLine(targetLine, AMap, map);
        }
      });
    } else if (item.location) {
      map.setCenter([item.location.lng, item.location.lat]);
      map.setZoom(17);
      setSelectionPos([item.location.lng, item.location.lat]);
      
      const cleanItemName = item.name.replace(/\(.*?\)|（.*?）/g, '').replace(/\s*-\s*\d+$/, '').trim();

      setSelectedStop({
        name: cleanItemName,
        address: t('loadingDetails'),
        lines: [],
        city: currentCity
      });

      // Try to fetch more details (lines)
      const details = await fetchStopDetails(cleanItemName, [item.location.lng, item.location.lat], AMap, currentCity);
      if (details) {
        setSelectedStop({ ...details, city: currentCity });
      } else {
        const isTransitPOI = item.type && (item.type.includes('公交') || item.type.includes('车站') || item.type.includes('交通设施') || item.type.includes('地铁'));
        let lines: string[] = [];
        
        if (isTransitPOI) {
           lines = (item.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => 
             s.length > 0 && !s.includes('区间') && (!filterAirportBusRef.current || !/机场(巴士|大巴|专线|快线)/.test(s))
           ).filter((s: string) => /\d+路|\d+线|专线|临线|快速公交/.test(s));
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
        city: item.adcode || currentCity || '全国',
        pageSize: 1
      });
      ps.search(item.name, (status: string, result: any) => {
        if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
          handleManualSearch(result.poiList.pois[0]);
        }
      });
    }
  };

  const searchIdRef = useRef(0);

  const onSearchInputChange = (val: string) => {
    setSearchQuery(val);
    if (!val || val.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const AMap = (window as any).AMap;
    if (!AMap || !AMap.AutoComplete) return;

    const currentSearchId = ++searchIdRef.current;

    if (!autoCompleteRef.current) {
      autoCompleteRef.current = new AMap.AutoComplete({
        city: currentCity || '全国',
        citylimit: false
      });
    }
    
    // Parallel search for better results
    const fetchTips = new Promise<any[]>((resolve) => {
      autoCompleteRef.current.search(val, (status: string, result: any) => {
        if (status === 'complete' && result.tips) {
          resolve(result.tips);
        } else {
          resolve([]);
        }
      });
    });

    const isLineQuery = checkIsLineQuery(val);
    const fetchLines = isLineQuery ? new Promise<any[]>((resolve) => {
      if (!AMap.LineSearch) { resolve([]); return; }
      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: currentCity || '全国',
        pageSize: 10,
        extensions: 'all'
      });
      lineSearch.search(val, (status: string, result: any) => {
        if (result.lineInfo && filterAirportBusRef.current) {
          result.lineInfo = result.lineInfo.filter((l: any) => !/机场(巴士|大巴|专线|快线)/.test(l.name));
        }
        if (status === 'complete' && result.lineInfo) {
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
      if (currentSearchId !== searchIdRef.current) return;
 
      // Prioritize exact line matches, then other lines, then POIs with locations
      const combined = [...lines];
      
      const stationGroups = new Map<string, any[]>();
      const otherTips: any[] = [];
      
      tips.forEach((tip: any) => {
        // High fidelity station detection
        const isStation = tip.typecode === '150700' || 
                         tip.name.includes('站') || 
                         tip.name.includes('口') || 
                         tip.name.includes('枢纽');
                         
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
           stationGroups.get(cleanName)!.push(tip);
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
      if (q.length > 0 && !isFilteredOut) {
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

      setSuggestions(combined.slice(0, 12));
      setShowSuggestions(true);
    });
  };

  const performFullSearch = async (query: string) => {
    if (!query) return;
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
          if (result.lineInfo && filterAirportBusRef.current) {
            result.lineInfo = result.lineInfo.filter((l: any) => !/机场(巴士|大巴|专线|快线)/.test(l.name));
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
      if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
        handleManualSearch(result.poiList.pois[0]);
      }
    });
  };

  const fetchedLinesCache = useRef<Map<string, BusLine>>(new Map());
  const markerGroupRef = useRef<any>(null);
  const lineGroupRef = useRef<any>(null);
  const selectionMarkerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

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

    const amapLang = language === 'zh-TW' ? 'zh_tw' : (language === 'en' ? 'en' : 'zh_cn');

    AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.PlaceSearch', 'AMap.LineSearch', 'AMap.StationSearch', 'AMap.Scale', 'AMap.ToolBar', 'AMap.Geocoder', 'AMap.AutoComplete', 'AMap.Geolocation', 'AMap.Driving', 'AMap.Walking'],
    }).then((AMap) => {
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
        lang: amapLang
      });

      mapRef.current = map;
      setMapInstance(map);
      
      map.getCity((res: any) => {
        if (res.city || res.province) {
          setCurrentCity(res.city || res.province);
        }
      });
      // Initialize groups for high performance clearing/adding
      markerGroupRef.current = new AMap.OverlayGroup();
      lineGroupRef.current = new AMap.OverlayGroup();
      map.add([markerGroupRef.current, lineGroupRef.current]);

      setLoading(false);

      const saveMapState = () => {
        if (!map) return;
        const center = map.getCenter();
        const zoom = map.getZoom();
        localStorage.setItem('map_center', JSON.stringify([center.lng, center.lat]));
        localStorage.setItem('map_zoom', zoom.toString());
      };

      map.on('moveend', () => {
        map.getCity((res: any) => {
          if (res.city || res.province) {
            setCurrentCity(res.city || res.province);
          }
        });
        saveMapState();
      });

      map.on('zoomend', () => {
        const newZoom = map.getZoom();
        setZoomLevel((prevZoom) => {
          return newZoom;
        });
        saveMapState();
      });

      mapClickHandlerRef.current = (e: any) => {
        if (isDrawingModeRef.current) {
          handleDrawingMapClick(e);
          return;
        }
        if (map.getZoom() < 14) return;
        const [lng, lat] = [e.lnglat.getLng(), e.lnglat.getLat()];
        
        const geocoder = new AMap.Geocoder();
        geocoder.getAddress([lng, lat], (status: string, result: any) => {
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
              setSelectionPos([busStop.location.lng, busStop.location.lat]);
              setSelectedSegmentName(null);
              setSelectedSegmentLines(null);
              setSelectedStop({
                name: busStop.name,
                location: busStop.location,
                address: preciseLocation || busStop.address,
                lines: (busStop.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => 
                  s.length > 0 && !s.includes('区间') && (!filterAirportBusRef.current || !/机场(巴士|大巴|专线|快线)/.test(s))
                ).filter((s: string) => /\d+路|\d+线|专线|临线|快速公交/.test(s)),
                city: currentCity,
                isBusStop: true
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
      
      map.on('click', mapClickHandlerRef.current);
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });

    return () => {
      if (map) {
        if (mapClickHandlerRef.current) map.off('click', mapClickHandlerRef.current);
        map.destroy();
      }
    };
  }, [language]);

  // Controlling visibility of station markers
  useEffect(() => {
    if (markerGroupRef.current) {
      if (showStations) {
        markerGroupRef.current.show();
      } else {
        markerGroupRef.current.hide();
      }
    }
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

  // Handle Base Map Visibility using AMap features
  useEffect(() => {
    if (!mapInstance) return;
    try {
      const layers = mapInstance.getLayers();
      if (showBaseMap) {
        if (layers[0]) layers[0].setOpacity(1);
        mapInstance.setFeatures(['bg', 'point', 'road', 'building']);
        mapInstance.setMapStyle('amap://styles/light');
      } else {
        // Completely hidden features and tile layer for "blank" effect
        if (layers[0]) layers[0].setOpacity(0);
        mapInstance.setFeatures([]);
        mapInstance.setMapStyle('amap://styles/whitesmoke');
      }
    } catch (e) {
      // Ignore errors if map is being destroyed
    }
  }, [showBaseMap, mapInstance]);

  const handleSearch = async () => {
    const map = mapRef.current;
    if (!map) return;

    const currentZoom = map.getZoom();
    if (!enableCityWideSearch && currentZoom < 12) {
      return;
    }

    setShowLargeAreaWarning(false);

    setIsSearching(true);
    try {
      const AMap = (window as any).AMap;
      
      const center = map.getCenter();
      let currentCity = '北京';
      
      try {
        const geocoder = new AMap.Geocoder();
        const addressResult: any = await new Promise((resolve) => {
          geocoder.getAddress(center, (status: string, result: any) => {
            resolve(status === 'complete' ? result : null);
          });
        });
        if (addressResult && addressResult.regeocode.addressComponent.city) {
          currentCity = addressResult.regeocode.addressComponent.city;
        } else if (addressResult && addressResult.regeocode.addressComponent.province) {
          currentCity = addressResult.regeocode.addressComponent.province;
        }
      } catch (e) {
        console.warn('City detection failed', e);
      }

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
      
      const placeSearch = new AMap.PlaceSearch({
        type: '公交车站',
        pageSize: 100, 
        city: currentCity,
        pageIndex: 1,
        extensions: 'all',
      });

      const allPois: any[] = [];
      let pageIndex = 1;
      const MAX_PAGES = enableCityWideSearch ? 100 : 30; // Increased when city wide
      const fetchPage = async (page: number): Promise<boolean> => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 10000);
          placeSearch.setPageIndex(page);
          
          const callback = (status: string, result: any) => {
            clearTimeout(timeout);
            if (status === 'complete' && result.poiList && result.poiList.pois.length > 0) {
              allPois.push(...result.poiList.pois);
              const totalCount = result.poiList.count || 0;
              const fetchedCount = page * 100;
              if (fetchedCount < totalCount && page < MAX_PAGES) {
                resolve(true); 
              } else {
                resolve(false);
              }
            } else {
              resolve(false);
            }
          };

          if (enableCityWideSearch) {
             placeSearch.search('', callback);
          } else {
             placeSearch.searchInBounds('', expandedBounds, callback);
          }
        });
      };

      let hasMore = true;
      while (hasMore) {
        hasMore = await fetchPage(pageIndex);
        if (hasMore) pageIndex++;
      }

      if (allPois.length > 0) {
        const pois = allPois;
        setStats(prev => ({ ...prev, stops: pois.length }));
        
        // High performance clear
        markerGroupRef.current.clearOverlays();

        const markers: any[] = [];
        pois.forEach((poi: any) => {
          const linesAr = (poi.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0 && !s.includes('区间'));
          const key = `${poi.location.lng},${poi.location.lat}`;
          stopCountCacheRef.current.set(key, linesAr.length);
          
          const marker = new AMap.CircleMarker({
            center: [poi.location.lng, poi.location.lat],
            radius: 8,
            fillColor: getStopColor(linesAr.length, '#3b82f6'),
            strokeColor: '#fff',
            strokeWeight: 2,
            bubble: false,
            zIndex: 30,
            cursor: 'pointer',
            extData: { key }
          });

          marker.on('click', () => {
            setSelectionPos([poi.location.lng, poi.location.lat]);
            setSelectedSegmentLines(null);
            setSelectedSegmentName(null);
            setSelectedStop({
              name: poi.name,
              address: poi.address,
              lines: (poi.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0 && !s.includes('区间')),
              city: currentCity
            });
          });
          markers.push(marker);
        });

        markerGroupRef.current.addOverlays(markers);

        const lineNamesSet = new Set<string>();
        pois.forEach((poi: any) => {
          const linesString = poi.address || '';
          const lines = linesString.split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0 && !s.includes('区间'));
          lines.forEach((l: string) => lineNamesSet.add(l));
        });

        await fetchAndDrawLines(Array.from(lineNamesSet), map, AMap, currentCity);

        // Fetch all exact physical platforms from the fetched bus lines
        const trueStopsMap = new Map<string, any>();
        
        Array.from(lineNamesSet).forEach(lineName => {
          const cacheKeys = Array.from(fetchedLinesCache.current.keys()).filter((k: any) => k === lineName || k.startsWith(`${lineName}(`) || k.startsWith(`${lineName}#`));

          cacheKeys.forEach((k: any) => {
            const line = fetchedLinesCache.current.get(k);
            if (line && line.via_stops) {
              line.via_stops.forEach((stop: any) => {
                if (expandedBounds.contains([stop.location.lng, stop.location.lat])) {
                  let foundKey = null;
                  for (const [existingKey, existingStop] of trueStopsMap.entries()) {
                    if (existingStop.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '') === stop.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '')) {
                      const dx = existingStop.location.lng - stop.location.lng;
                      const dy = existingStop.location.lat - stop.location.lat;
                      if (dx*dx + dy*dy < 0.000000002) { // Same platform radius (approx 4m)
                        foundKey = existingKey;
                        break;
                      }
                    }
                  }

                  if (foundKey) {
                    trueStopsMap.get(foundKey).lines.add(k);
                  } else {
                    const key = `${stop.location.lng},${stop.location.lat}`;
                    trueStopsMap.set(key, { ...stop, lines: new Set([k]) });
                  }
                }
              });
            }
          });
        });

        // Add any original POIs that might not have been covered by fetched lines
        pois.forEach((poi: any) => {
          const key = `${poi.location.lng},${poi.location.lat}`;
          if (!trueStopsMap.has(key)) {
            let addIt = true;
            for (const [k, v] of trueStopsMap.entries()) {
              if (v.name && poi.name && v.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '') === poi.name.replace(/\(.*?\)|（.*?）/g, '').replace('公交站', '')) {
                 const dx = v.location.lng - poi.location.lng;
                 const dy = v.location.lat - poi.location.lat;
                 if (dx*dx + dy*dy < 0.000000002) {
                   addIt = false; 
                   break; 
                 }
              }
            }
            if (addIt) {
              const lines = (poi.address || '').split(';').map((s: string) => s.trim()).filter((s: string) => s.length > 0 && !s.includes('区间'));
              trueStopsMap.set(key, { ...poi, lines: new Set(lines) });
            }
          }
        });

        // Redraw with precise platforms
        if (trueStopsMap.size > 0) {
          markerGroupRef.current.clearOverlays();
          const trueMarkers: any[] = [];
          trueStopsMap.forEach((poi: any, key: string) => {
            const linesArray = Array.from(poi.lines);
            stopCountCacheRef.current.set(key, linesArray.length);
            const marker = new AMap.CircleMarker({
              center: [poi.location.lng, poi.location.lat],
              radius: 8,
              fillColor: getStopColor(linesArray.length, '#3b82f6'),
              strokeColor: '#fff',
              strokeWeight: 2,
              bubble: false,
              zIndex: 30,
              cursor: 'pointer',
              extData: { key }
            });
            
            marker.on('click', () => {
              setSelectionPos([poi.location.lng, poi.location.lat]);
              setSelectedSegmentLines(null);
              setSelectedSegmentName(null);
              setSelectedStop({
                name: poi.name,
                address: Array.from(new Set(linesArray.map((l: string) => l.split('(')[0].split('#')[0]))).join('; '),
                lines: linesArray,
                city: currentCity
              });
            });
            trueMarkers.push(marker);
          });
          markerGroupRef.current.addOverlays(trueMarkers);
          setStats(prev => ({ ...prev, stops: trueMarkers.length }));
        }

      }
      setIsSearching(false);
    } catch (error) {
      console.error('Search error:', error);
      setIsSearching(false);
    }
  };

  const fetchAndDrawLines = async (lineNames: string[], map: any, AMap: any, city: string) => {
    const linesToFetch = lineNames.filter(name => !fetchedLinesCache.current.has(name));
    
    if (linesToFetch.length > 0) {
      const lineSearch = new AMap.LineSearch({
        pageIndex: 1,
        city: city || '全国',
        pageSize: 100,
        extensions: 'all'
      });

      const batchSize = 5;
      for (let i = 0; i < linesToFetch.length; i += batchSize) {
        const batch = linesToFetch.slice(i, i + batchSize);
        await Promise.all(batch.map(name => new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 8000);
          lineSearch.search(name, (status: string, result: any) => {
            clearTimeout(timeout);
            if (result.lineInfo && filterAirportBusRef.current) {
              result.lineInfo = result.lineInfo.filter((l: any) => !/机场(巴士|大巴|专线|快线)/.test(l.name));
            }
            if (status === 'complete' && result.lineInfo && result.lineInfo.length > 0) {
              result.lineInfo.forEach((info: any, index: number) => {
                const uniqueName = info.name || `${name}#${index}`;
                fetchedLinesCache.current.set(uniqueName, {
                  id: info.id,
                  name: uniqueName,
                  path: info.path.map((p: any) => [p.lng, p.lat]),
                  start_stop: info.start_stop,
                  end_stop: info.end_stop,
                  stops: [],
                  via_stops: info.via_stops || []
                });
              });
            }
            resolve();
          });
        })));
      }
    }

    aggregateAndVisualize(lineNames, map, AMap);
  };

  const handleClear = () => {
    if (markerGroupRef.current) markerGroupRef.current.clearOverlays();
    if (lineGroupRef.current) lineGroupRef.current.clearOverlays();
    
    setStats({ stops: 0, lines: 0 });
    setSelectedSegmentLines(null);
    setSelectedStop(null);
    setSelectionPos(null);
    setSelectedSegmentName(null);
    setSelectedSegmentAddress(null);
  };

  const aggregateAndVisualize = (activeLineSet: string[], map: any, AMap: any) => {
    const expandedLineNames: string[] = [];
    const cacheKeys = Array.from(fetchedLinesCache.current.keys()) as string[];
    
    activeLineSet.forEach(name => {
      const matches = cacheKeys.filter(key => key === name || key.startsWith(`${name}(`) || key.startsWith(`${name}#`));
      if (matches.length > 0) {
        expandedLineNames.push(...matches);
      }
    });

    // Add approved user-submitted lines if not filtered out
    const isFilteredOut = localStorage.getItem('app_filter_user_submissions') === 'true';
    if (!isFilteredOut) {
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

    const pointsGrid = new Map<string, [number, number][]>();
    const getGridKey = (lng: number, lat: number) => 
      `${(lng * 1000) | 0},${(lat * 1000) | 0}`; 

    expandedLineNames.forEach(name => {
      const line = fetchedLinesCache.current.get(name);
      if (line) {
        const cleanedPath: [number, number][] = [];
        const pathLen = line.path.length;
        for (let i = 0; i < pathLen; i++) {
          const p = line.path[i];
          if (cleanedPath.length > 0) {
            const last = cleanedPath[cleanedPath.length - 1];
            const dx = p[0] - last[0];
            const dy = p[1] - last[1];
            const distSq = dx*dx + dy*dy;
            if (distSq < 1e-10) continue; 

            if (i < pathLen - 1) {
              const next = line.path[i + 1];
              const nx = next[0] - p[0];
              const ny = next[1] - p[1];
              const d2Sq = nx*nx + ny*ny;
              
              const tx = next[0] - last[0];
              const ty = next[1] - last[1];
              const d3Sq = tx*tx + ty*ty;
              
              if (distSq > 1e-6 && d2Sq > 1e-6 && d3Sq < 1e-8) continue; 
            }
          }
          cleanedPath.push(p);
          
          const key = getGridKey(p[0], p[1]);
          let cell = pointsGrid.get(key);
          if (!cell) {
            cell = [];
            pointsGrid.set(key, cell);
          }
          cell.push(p);
        }
        line.path = cleanedPath;
      }
    });

    const processedLinesPaths = new Map<string, [number, number][]>();
    const offsetLinesPaths = new Map<string, [number, number][]>();
    
    const OFFSET_VAL = 0.000035; 

    expandedLineNames.forEach(name => {
      const line = fetchedLinesCache.current.get(name);
      if (!line || line.path.length < 2) return;
      
      const splitPath: [number, number][] = [];
      for (let i = 0; i < line.path.length - 1; i++) {
        const start = line.path[i];
        const end = line.path[i+1];
        splitPath.push(start);
        
        const mids: { p: [number, number], dist: number }[] = [];
        const minGX = Math.floor(Math.min(start[0], end[0]) * 1000);
        const maxGX = Math.floor(Math.max(start[0], end[0]) * 1000);
        const minGY = Math.floor(Math.min(start[1], end[1]) * 1000);
        const maxGY = Math.floor(Math.max(start[1], end[1]) * 1000);

        for (let gx = minGX - 1; gx <= maxGX + 1; gx++) {
          for (let gy = minGY - 1; gy <= maxGY + 1; gy++) {
            const cellPoints = pointsGrid.get(`${gx},${gy}`);
            if (!cellPoints) continue;

            cellPoints.forEach(p => {
              if ((Math.abs(p[0] - start[0]) < 0.00001 && Math.abs(p[1] - start[1]) < 0.00001) || 
                  (Math.abs(p[0] - end[0]) < 0.00001 && Math.abs(p[1] - end[1]) < 0.00001)) return;
              
              const dist = distToSegment(p, start, end);
              if (dist < 0.00008) { 
                const projected = getProjection(p, start, end);
                mids.push({ p: projected, dist: getDistSq(projected, start) });
              }
            });
          }
        }
        
        mids.sort((a, b) => a.dist - b.dist);
        mids.forEach(m => {
          const last = splitPath[splitPath.length - 1];
          if (getDistSq(last, m.p) > 1e-10) { 
            splitPath.push(m.p);
          }
        });
      }
      splitPath.push(line.path[line.path.length - 1]);
      processedLinesPaths.set(name, splitPath);

      const smoothedOffsetPath: [number, number][] = [];
      const segmentNormals: [number, number][] = [];
      
      for (let i = 0; i < splitPath.length - 1; i++) {
        const p1 = splitPath[i];
        const p2 = splitPath[i+1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > 0) {
          segmentNormals.push([dy / len, -dx / len]);
        } else {
          segmentNormals.push(segmentNormals[segmentNormals.length-1] || [0, 0]);
        }
      }

      for (let i = 0; i < splitPath.length; i++) {
        const p = splitPath[i];
        let nx = 0, ny = 0;
        const windowSize = 2;
        const startIdx = Math.max(0, i - windowSize);
        const endIdx = Math.min(segmentNormals.length - 1, i + windowSize);
        let count = 0;
        for (let j = startIdx; j <= endIdx; j++) {
           nx += segmentNormals[j][0];
           ny += segmentNormals[j][1];
           count++;
        }
        nx /= count;
        ny /= count;
        
        let nLen = Math.sqrt(nx*nx + ny*ny);
        if (nLen > 0.0001) {
          nx /= nLen;
          ny /= nLen;
          
          const dot = nx * (i < segmentNormals.length ? segmentNormals[i][0] : segmentNormals[segmentNormals.length-1][0]) + 
                      ny * (i < segmentNormals.length ? segmentNormals[i][1] : segmentNormals[segmentNormals.length-1][1]);
          let miterFactor = dot > 0.5 ? 1 / dot : 1.3; 
          if (miterFactor > 1.3) miterFactor = 1.3; 
          
          smoothedOffsetPath.push([
            p[0] + nx * OFFSET_VAL * miterFactor,
            p[1] + ny * OFFSET_VAL * miterFactor
          ]);
        } else {
          smoothedOffsetPath.push([p[0] + segmentNormals[Math.min(i, segmentNormals.length-1)][0] * OFFSET_VAL, 
                                   p[1] + segmentNormals[Math.min(i, segmentNormals.length-1)][1] * OFFSET_VAL]);
        }
      }
      offsetLinesPaths.set(name, smoothedOffsetPath);
    });

    const segmentCounts = new Map<string, { start: [number, number], end: [number, number], offsetStart: [number, number], offsetEnd: [number, number], lines: Set<string> }>();
    
    expandedLineNames.forEach(name => {
      const path = processedLinesPaths.get(name);
      const oPath = offsetLinesPaths.get(name);
      if (!path || !oPath) return;

      for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i+1];
        const op1 = oPath[i];
        const op2 = oPath[i+1];
        if (p1[0] === p2[0] && p1[1] === p2[1]) continue;

        const x1 = (p1[0] * 100000) | 0;
        const y1 = (p1[1] * 100000) | 0;
        const x2 = (p2[0] * 100000) | 0;
        const y2 = (p2[1] * 100000) | 0;
        const coordKey = `${x1}${y1}${x2}${y2}`;

        let seg = segmentCounts.get(coordKey);
        if (!seg) {
          seg = { 
            start: p1, end: p2, 
            offsetStart: op1, offsetEnd: op2,
            lines: new Set() 
          };
          segmentCounts.set(coordKey, seg);
        }
        seg.lines.add(name);
      }
    });

    const finalSegments: { start: [number, number], end: [number, number], offsetStart: [number, number], offsetEnd: [number, number], lines: Set<string> }[] = [];
    const handledKeys = new Set<string>();
    
    const segmentGrid = new Map<string, string[]>();
    const GRID_SIZE = 1000; 
    const getSegGridKey = (lng: number, lat: number) => `${(lng * GRID_SIZE) | 0},${(lat * GRID_SIZE) | 0}`;

    const allKeys = Array.from(segmentCounts.keys());
    allKeys.forEach(key => {
      const s = segmentCounts.get(key)!;
      const gKey = getSegGridKey((s.start[0] + s.end[0]) * 0.5, (s.start[1] + s.end[1]) * 0.5);
      if (!segmentGrid.has(gKey)) segmentGrid.set(gKey, []);
      segmentGrid.get(gKey)!.push(key);
    });
    
    const DIST_MERGE_THRESHOLD_SQ = 0.0000000009; 
    const PARALLEL_THRESHOLD = 0.995; 
    const getBaseName = (fullName: string) => fullName.split('(')[0];

    for (let i = 0; i < allKeys.length; i++) {
      const key1 = allKeys[i];
      if (handledKeys.has(key1)) continue;
      
      const s1 = segmentCounts.get(key1)!;
      handledKeys.add(key1);
      
      const mid1x = (s1.start[0] + s1.end[0]) * 0.5;
      const mid1y = (s1.start[1] + s1.end[1]) * 0.5;
      const v1x = s1.end[0] - s1.start[0];
      const v1y = s1.end[1] - s1.start[1];
      const l1 = Math.sqrt(v1x * v1x + v1y * v1y);
      
      const mergedLines = new Set(s1.lines);
      const currentBaseNames = new Set<string>();
      mergedLines.forEach(l => currentBaseNames.add(getBaseName(l)));
      
      const gX = (mid1x * GRID_SIZE) | 0;
      const gY = (mid1y * GRID_SIZE) | 0;
      
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKeys = segmentGrid.get(`${gX + dx},${gY + dy}`);
          if (!neighborKeys) continue;
          
          for (let k = 0; k < neighborKeys.length; k++) {
            const key2 = neighborKeys[k];
            if (handledKeys.has(key2)) continue;
            
            const s2 = segmentCounts.get(key2)!;
            const mid2x = (s2.start[0] + s2.end[0]) * 0.5;
            const mid2y = (s2.start[1] + s2.end[1]) * 0.5;
            
            const diffX = mid1x - mid2x;
            const diffY = mid1y - mid2y;
            if (diffX * diffX + diffY * diffY < DIST_MERGE_THRESHOLD_SQ) {
              const v2x = s2.end[0] - s2.start[0];
              const v2y = s2.end[1] - s2.start[1];
              const l2 = Math.sqrt(v2x * v2x + v2y * v2y);
              if (l1 > 0 && l2 > 0 && Math.abs((v1x * v2x + v1y * v2y) / (l1 * l2)) > PARALLEL_THRESHOLD) {
                let hasCommonBus = false;
                for (const line of s2.lines) {
                  if (currentBaseNames.has(getBaseName(line))) {
                    hasCommonBus = true;
                    break;
                  }
                }
                
                if (!hasCommonBus) {
                  s2.lines.forEach(l => {
                    mergedLines.add(l);
                    currentBaseNames.add(getBaseName(l));
                  });
                  handledKeys.add(key2);
                }
              }
            }
          }
        }
      }
      finalSegments.push({ ...s1, lines: mergedLines });
    }

    setStats(prev => ({ ...prev, lines: activeLineSet.length }));

    const colorGroups = new Map<string, Array<[number, number][]>>();
    
    const isCityWide = localStorage.getItem('app_experimental_citywide') === 'true';
    
    finalSegments.forEach((data) => {
      // Helper to check if a line name is user-submitted
      const isLineUserSubmitted = (lineName: string) => {
        const cached = fetchedLinesCache.current.get(lineName);
        return cached?.isUserSubmitted === true;
      };

      const regularLines = Array.from(data.lines).filter(l => !isLineUserSubmitted(l));
      const regularCount = regularLines.length;

      let color = '';
      if (regularCount > 0) {
        if (isCityWide) {
          color = '#3b82f6';
        } else {
          if (regularCount < 4) color = '#22c55e';
          else if (regularCount >= 4 && regularCount <= 9) color = '#eab308';
          else color = '#ef4444';
        }
      } else if (data.lines.size > 0) {
        // Only user-submitted lines pass through here!
        color = '#BA55D3'; // Pale purple
      }

      if (color) {
        const displayPath: [number, number][] = [data.offsetStart, data.offsetEnd];
        if (!colorGroups.has(color)) colorGroups.set(color, []);
        colorGroups.get(color)!.push(displayPath);
      }
    });

    const joinSegments = (paths: Array<[number, number][]>) => {
      if (paths.length === 0) return [];
      const result: Array<[number, number][]> = [];
      const remaining = new Set<number>();
      for (let i = 0; i < paths.length; i++) remaining.add(i);
      
      while (remaining.size > 0) {
        let firstIdx = -1;
        for (const idx of remaining) { firstIdx = idx; break; }
        remaining.delete(firstIdx);
        const currentPath = [...paths[firstIdx]];
        
        let found = true;
        while (found) {
          found = false;
          const start = currentPath[0];
          const end = currentPath[currentPath.length - 1];
          
          for (const idx of remaining) {
            const p = paths[idx];
            const pStart = p[0];
            const pEnd = p[p.length - 1];
            
            const epsilon = 1e-7;
            if (Math.abs(pEnd[0] - start[0]) < epsilon && Math.abs(pEnd[1] - start[1]) < epsilon) {
              currentPath.unshift(...p.slice(0, -1));
              remaining.delete(idx);
              found = true;
              break;
            } else if (Math.abs(pStart[0] - end[0]) < epsilon && Math.abs(pStart[1] - end[1]) < epsilon) {
              currentPath.push(...p.slice(1));
              remaining.delete(idx);
              found = true;
              break;
            } else if (Math.abs(pStart[0] - start[0]) < epsilon && Math.abs(pStart[1] - start[1]) < epsilon) {
              currentPath.unshift(...[...p].reverse().slice(0, -1));
              remaining.delete(idx);
              found = true;
              break;
            } else if (Math.abs(pEnd[0] - end[0]) < epsilon && Math.abs(pEnd[1] - end[1]) < epsilon) {
              currentPath.push(...[...p].reverse().slice(1));
              remaining.delete(idx);
              found = true;
              break;
            }
          }
        }
        result.push(currentPath);
      }
      return result;
    };

    const allOverlays: any[] = [];
    colorGroups.forEach((paths, color) => {
      const joinedPaths = joinSegments(paths);
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
        zIndex: color === '#ef4444' ? 15 : (color === '#eab308' ? 12 : 10)
      });
      allOverlays.push(polyline);
    });

    lineGroupRef.current.clearOverlays();
    lineGroupRef.current.addOverlays(allOverlays);

    if (mapClickHandlerRef.current) {
      map.off('click', mapClickHandlerRef.current);
    }

    const onMapClick = (e: any) => {
      if (isDrawingModeRef.current) {
        handleDrawingMapClick(e);
        return;
      }
      const clickLngLat = [e.lnglat.lng, e.lnglat.lat] as [number, number];
      const gX = (clickLngLat[0] * GRID_SIZE) | 0;
      const gY = (clickLngLat[1] * GRID_SIZE) | 0;
      
      const foundSegments: { dist: number; lines: Set<string>; data: any }[] = [];
      const currentZoom = map.getZoom();
      const zoomFactor = Math.max(1, Math.pow(2, 16 - currentZoom));
      const SEARCH_DIST = 0.00018 * zoomFactor; 
      const gridRadius = Math.max(1, Math.ceil(SEARCH_DIST * GRID_SIZE));

      for (let dx = -gridRadius; dx <= gridRadius; dx++) {
        for (let dy = -gridRadius; dy <= gridRadius; dy++) {
          const neighborKeys = segmentGrid.get(`${gX + dx},${gY + dy}`);
          if (!neighborKeys) continue;
          
          neighborKeys.forEach(key => {
            const data = segmentCounts.get(key)!;
            const dist = distToSegment(clickLngLat, data.offsetStart, data.offsetEnd);
            if (dist < SEARCH_DIST) {
              foundSegments.push({ dist, lines: data.lines, data });
            }
          });
        }
      }

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
          setSelectedStop(null);
          setSelectedSegmentName("正在获取路段信息...");
          setSelectedSegmentLines(Array.from(linesSet));
          
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
    const userLine = approvedUserLines.find(ul => ul.name === lineStr);
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
    if (selectedStop && selectedStop.lines && selectedStop.lines.length > 0) {
      const missingLines = selectedStop.lines.filter(l => {
        const parsed = parseLineInfo(l);
        return parsed.start === '-' || parsed.end === '-';
      });

      if (missingLines.length > 0 && (window as any).AMap) {
        const lineSearch = new (window as any).AMap.LineSearch({
          pageIndex: 1,
          city: currentCity || '全国',
          pageSize: 10,
          extensions: 'all'
        });

        let updated = false;
        let checked = 0;
        missingLines.forEach(lineStr => {
          const {name: shortName} = parseLineInfo(lineStr);
          lineSearch.search(shortName, (status: string, result: any) => {
            checked++;
            if (status === 'complete' && result.lineInfo && result.lineInfo.length > 0) {
              result.lineInfo.forEach((info: any, index: number) => {
                const uniqueName = info.name || `${shortName}#${index}`;
                if (!fetchedLinesCache.current.has(uniqueName)) {
                  fetchedLinesCache.current.set(uniqueName, {
                    id: info.id,
                    name: uniqueName,
                    path: info.path.map((p: any) => [p.lng, p.lat]),
                    start_stop: info.start_stop,
                    end_stop: info.end_stop,
                    via_stops: info.via_stops || [],
                    stops: []
                  });
                  updated = true;
                }
              });
            }
            if (checked === missingLines.length && updated) {
              setCacheUpdateTick(v => v + 1);
            }
          });
        });
      }
    }
  }, [selectedStop, currentCity]);

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
    
    const runBatch = async () => {
      for (let i = 0; i < activeBusLine.via_stops.length; i++) {
        // Stop if map changes or we deactivate the line early
        if (!stationLineStatsRef.current || !mapRef.current) break;
        
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
                      lineCount = linesStr.filter((s: string) => s.length > 0 && !s.includes('区间') && (!filterAirportBusRef.current || !/机场(巴士|大巴|专线|快线)/.test(s))).length;
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

        // Trigger map marker colors update
        if (currentUpdateTick > 0 && (i % 3 === 0 || i === activeBusLine.via_stops.length - 1)) {
           setCacheUpdateTick(v => v + 1);
           currentUpdateTick = 0;
           
           // Manually update marker group colors for performance instead of full redraw
           if (markerGroupRef.current) {
             const overlays = markerGroupRef.current.getOverlays();
             overlays.forEach((o: any) => {
               const ext = o.getExtData ? o.getExtData() : null;
               if (ext && ext.key && ext.type === 'busLineStop') {
                 const newCount = stopCountCacheRef.current.get(ext.key) || 0;
                 const newColor = getStopColor(newCount, '#3b82f6');
                 // Only setOptions if color changed
                 if (o._opts && o._opts.fillColor !== newColor) {
                    o.setOptions({ fillColor: newColor });
                 }
               }
             });
           }
        }
      }
    };
    
    runBatch();
    
  }, [activeBusLine, currentCity]);

  return (
    <div className="flex flex-col h-screen w-full bg-[#f8f9fa] font-sans text-slate-900 overflow-hidden relative">
      <header className="fixed top-0 left-0 right-0 z-20 px-4 pt-6 pb-0 pointer-events-none">
        {!isDrawingMode && (
          <div className="flex items-start justify-between gap-4 w-full h-[52px]">
            {/* Combined Logo/Search Bar */}
            <div className={`backdrop-blur-xl bg-white border border-slate-200/50 shadow-xl flex items-center h-[52px] pointer-events-auto transition-all duration-300 ease-out overflow-visible ${isMobileSearchOpen ? 'absolute left-4 right-4 md:relative md:left-auto md:right-auto md:w-[340px] rounded-2xl z-30' : 'relative w-[104px] md:w-[340px] rounded-[26px] md:rounded-2xl'}`}>
              
              {/* Logo Area */}
              <div className="flex items-center justify-center pl-4 pr-2 shrink-0 h-full">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                  <path d="M4 17H20" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M17 4V20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
                  <path d="M8 20V13L13 8H22" stroke="#eab308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Separator - visible only when expanded or on desktop */}
              <div className={`w-[1px] h-6 bg-slate-200 shrink-0 transition-opacity duration-300 ${isMobileSearchOpen ? 'opacity-100' : 'opacity-0 md:opacity-100 hidden md:block'}`} />

              {/* Input Field Area */}
              <div className={`flex-1 flex items-center overflow-hidden transition-all duration-500 ease-out h-full ${isMobileSearchOpen ? 'opacity-100 pl-3 w-full' : 'opacity-0 pl-0 w-0 md:opacity-100 md:pl-3 md:w-full'}`}>
                <input 
                  type="text" 
                  placeholder={(!enableCityWideSearch && zoomLevel < 12) ? t('searchHint') : t('searchPlaceholder')} 
                  className="bg-transparent border-none outline-none text-sm font-black text-slate-700 w-full placeholder:text-slate-400 placeholder:font-medium h-full"
                  value={searchQuery}
                  onChange={(e) => onSearchInputChange(e.target.value)}
                  onFocus={() => searchQuery && suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => { setShowSuggestions(false); setIsMobileSearchOpen(false); }, 200)}
                  onKeyDown={(e) => {
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
                  <button onMouseDown={() => { setSearchQuery(''); setSuggestions([]); setShowSuggestions(false); }} className="px-2 shrink-0 h-full flex items-center">
                    <X className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                  </button>
                )}
              </div>

              {/* Search Button / Mobile Toggle Button */}
              <button 
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!isMobileSearchOpen && window.innerWidth < 768) {
                    setIsMobileSearchOpen(true);
                  } else {
                     performFullSearch(searchQuery);
                     setIsMobileSearchOpen(false);
                  }
                }}
                className={`w-[40px] h-[40px] shrink-0 mx-1.5 md:mr-1.5 md:ml-0 rounded-full flex items-center justify-center transition-colors ${searchQuery || !isMobileSearchOpen ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-transparent text-slate-600 hover:bg-slate-100'}`}
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Suggestions Dropdown */}
              <AnimatePresence>
                {showSuggestions && suggestions.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute top-[calc(100%+8px)] left-0 right-0 bg-white/95 backdrop-blur-xl border border-slate-100 rounded-2xl shadow-2xl overflow-hidden py-2 z-50 pointer-events-auto"
                  >
                    {suggestions.slice(0, 6).map((tip, idx) => (
                      <button
                        key={idx}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleManualSearch(tip);
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors flex flex-col gap-0.5 relative"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-800">{tip.name}</span>
                          {tip.isAggregated && (
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-50 text-[8px] font-black text-purple-600 tracking-tighter shadow-sm border border-purple-100">
                              汇总
                            </span>
                          )}
                          {tip.type === 'busline' && (
                            <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-[8px] font-black text-blue-600 uppercase tracking-tighter shadow-sm border border-blue-100">
                              {t('lineLabel')}
                            </span>
                          )}
                          {(tip.isUserSubmitted || tip.type === 'userLine') && (
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-50 text-[8px] font-black text-purple-400 tracking-tighter shadow-sm border border-purple-100 whitespace-nowrap">
                              用户
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-slate-400">{tip.district || tip.address}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Quick Actions Container */}
            <div className={`flex items-center gap-3 transition-opacity duration-300 ${isMobileSearchOpen ? 'opacity-0 md:opacity-100 pointer-events-none md:pointer-events-auto' : 'opacity-100'}`}>
              {/* Toggle Stations Button */}
              <div className="pointer-events-auto shrink-0 transition-opacity duration-300 opacity-100 mt-1">
                <button 
                  onClick={toggleStations}
                  className={`backdrop-blur-xl border border-white/50 w-[42px] h-[42px] rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all active:scale-95 group ${showStations ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white/90 text-slate-700 hover:text-blue-600 hover:bg-white'}`}
                  title={showStations ? "隐藏站点" : "显示站点"}
                >
                  <MapPin className={`w-5 h-5 transition-transform group-hover:scale-110 ${showStations ? 'text-white' : 'text-slate-700 group-hover:text-blue-600'}`} />
                </button>
              </div>

              {/* Toggle Base Map Button */}
              <div className="pointer-events-auto shrink-0 transition-opacity duration-300 opacity-100 mt-1">
                <button 
                  onClick={toggleBaseMap}
                  className={`backdrop-blur-xl border border-white/50 w-[42px] h-[42px] rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all active:scale-95 group ${showBaseMap ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white/90 text-slate-700 hover:text-indigo-600 hover:bg-white'}`}
                  title={showBaseMap ? "隐藏底图" : "显示底图"}
                >
                  <MapIcon className={`w-5 h-5 transition-transform group-hover:scale-110 ${showBaseMap ? 'text-white' : 'text-slate-700 group-hover:text-indigo-600'}`} />
                </button>
              </div>

              {/* Custom Draw Mode Paintbrush Button */}
              <div className="pointer-events-auto shrink-0 transition-opacity duration-300 opacity-100 mt-1">
                <button 
                  onClick={() => {
                    setIsDrawingMode(true);
                    setDrawnPoints([]);
                    setUndoStack([]);
                    setRedoStack([]);
                    setSelectedPointIdx(null);
                    setShowExitConfirm(false);
                  }}
                  className="backdrop-blur-xl bg-white/90 border border-white/50 w-[42px] h-[42px] rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center justify-center text-slate-700 hover:text-emerald-600 hover:bg-white transition-all active:scale-95 group"
                  title="进入线路自绘模式"
                >
                  <Paintbrush className="w-5 h-5 text-slate-700 group-hover:text-emerald-600 transition-transform group-hover:scale-110" />
                </button>
              </div>

              {/* Admin-only buttons if verified */}
              {isAdminVerified && (
                <>
                  <div className="pointer-events-auto shrink-0 transition-opacity duration-300 opacity-100 mt-1">
                    <button 
                      onClick={() => {
                        setShowAuditModal(p => !p);
                        setShowManageModal(false);
                        fetchPendingSubmissions();
                      }}
                      className={`backdrop-blur-xl border border-white/50 w-[42px] h-[42px] rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all active:scale-95 group ${showAuditModal ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-white/90 text-amber-600 hover:bg-white hover:text-amber-700'}`}
                      title="自绘线路待审核中心"
                    >
                      <ClipboardCheck className="w-5 h-5 transition-transform group-hover:scale-110" />
                    </button>
                  </div>

                  <div className="pointer-events-auto shrink-0 transition-opacity duration-300 opacity-100 mt-1">
                    <button 
                      onClick={() => {
                        setShowManageModal(p => !p);
                        setShowAuditModal(false);
                        fetchApprovedLines();
                      }}
                      className={`backdrop-blur-xl border border-white/50 w-[42px] h-[42px] rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all active:scale-95 group ${showManageModal ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-white/90 text-purple-600 hover:bg-white hover:text-purple-700'}`}
                      title="批量管理已发布的用户数据"
                    >
                      <Database className="w-5 h-5 transition-transform group-hover:scale-110" />
                    </button>
                  </div>
                </>
              )}

              {/* Settings Toggle button */}
              <div className="pointer-events-auto shrink-0 transition-opacity duration-300 opacity-100 mt-1">
                <button 
                  onClick={() => {
                    setSettingsTab('general');
                    setShowSettings(true);
                  }}
                  className="backdrop-blur-xl bg-white/90 border border-white/50 w-[42px] h-[42px] rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex items-center justify-center text-slate-700 hover:text-blue-600 hover:bg-white transition-all active:scale-90 group"
                >
                  <Settings className="w-5 h-5 transition-transform group-hover:rotate-90 duration-500" />
                </button>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence>
          {showLargeAreaWarning && isSearching && (
            <motion.div 
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              className="absolute top-24 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
            >
              <div className="backdrop-blur-xl bg-amber-50/90 border border-amber-200 px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 border-b-4 border-b-amber-500/50">
                <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
                </div>
                <h3 className="font-bold text-amber-800 text-[13px] whitespace-nowrap">{t('warning')}</h3>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="relative flex-1">
        <div ref={containerRef} className="w-full h-full bg-white shadow-inner" id="amap-container" />

        {loading && (
          <div className="absolute inset-0 bg-white/40 backdrop-blur-md z-30 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                <Bus className="w-5 h-5 text-blue-600 absolute inset-0 m-auto" />
              </div>
              <p className="font-bold text-slate-600 tracking-widest uppercase text-xs">{t('initializing')}</p>
            </div>
          </div>
        )}



        {!isDrawingMode && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            <AnimatePresence>
              {(!enableCityWideSearch && zoomLevel < 12 && !isSearching && !loading) && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="backdrop-blur-xl bg-orange-500/90 text-white text-xs font-black px-4 py-2 rounded-full shadow-lg whitespace-nowrap border border-orange-400 flex items-center gap-1.5 pointer-events-none mb-1 shadow-orange-500/20"
                >
                  <ZoomIn className="w-3.5 h-3.5 animate-bounce" />
                  <span>{t('searchHint')}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-4">
              <motion.button 
                layout
                onClick={handleSearch}
                disabled={isSearching || (!enableCityWideSearch && zoomLevel < 12)}
                initial={false}
                animate={{ 
                  scale: 1,
                  opacity: loading ? 0 : 1,
                  backgroundColor: isSearching ? 'rgba(245, 158, 11, 0.1)' : 
                    (enableCityWideSearch ? 'rgba(239, 68, 68, 1)' : (zoomLevel < 12 ? 'rgba(241, 245, 241, 0.5)' : 'rgba(37, 99, 235, 1)'))
                }}
                whileHover={!isSearching && (enableCityWideSearch || zoomLevel >= 12) ? { scale: 1.02, backgroundColor: enableCityWideSearch ? 'rgba(220, 38, 38, 1)' : 'rgba(29, 78, 216, 1)' } : {}}
                whileTap={!isSearching && (enableCityWideSearch || zoomLevel >= 12) ? { scale: 0.98 } : {}}
                className={`backdrop-blur-xl border w-14 h-14 shrink-0 rounded-3xl shadow-xl flex items-center justify-center transition-colors
                  ${isSearching ? 'border-amber-200 text-amber-600 cursor-wait' : 
                    enableCityWideSearch ? 'border-red-500 text-white shadow-red-500/20' :
                    (zoomLevel < 12 ? 'border-slate-200 text-slate-400 cursor-not-allowed' : 
                    'border-blue-500 text-white shadow-blue-500/20')}`}
                title={isSearching ? t('searching') : (enableCityWideSearch ? t('cityWideSearch') : (zoomLevel < 12 ? t('searchHint') : t('startSearch')))}
              >
                <AnimatePresence mode="wait">
                  {isSearching ? (
                    <motion.div
                      key="loader"
                      initial={{ rotate: 0, opacity: 0 }}
                      animate={{ rotate: 360, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ rotate: { repeat: Infinity, duration: 1, ease: 'linear' } }}
                    >
                      <Loader2 className="w-5 h-5" />
                    </motion.div>
                  ) : (!enableCityWideSearch && zoomLevel < 12) ? (
                    <motion.div
                      key="zoom"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                    >
                      <ZoomIn className="w-5 h-5" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="search"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                    >
                      <Search className="w-5 h-5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
              
              <AnimatePresence>
                {(stats.stops > 0 || stats.lines > 0) && (
                  <motion.button 
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    onClick={handleClear}
                    className="backdrop-blur-xl bg-white/80 border border-slate-200 h-14 w-14 rounded-3xl shadow-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-white transition-all active:scale-95"
                  >
                    <X className="w-6 h-6" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Custom Drawing Mode HUD Floating Toolbar Panel */}
        {isDrawingMode && (
          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-30 w-[95%] max-w-3xl backdrop-blur-2xl bg-slate-900/95 text-white border border-slate-700/80 rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col md:flex-row items-center justify-between gap-4 pointer-events-auto">
            {/* Left instructions or stats */}
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <button
                onClick={openNoticeManually}
                className="backdrop-blur-md bg-slate-800 hover:bg-slate-700/80 border border-slate-700/80 p-2 rounded-xl text-emerald-400 hover:text-emerald-300 transition-all active:scale-95 flex items-center justify-center shrink-0"
                title="查看绘制功能提示"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">自绘模式</span>
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
                <div className="flex items-center gap-1 bg-red-950/40 border border-red-500/20 p-1 rounded-xl shrink-0">
                  <span className="text-[9px] font-black text-red-400 px-1">确认退出?</span>
                  <button
                    onClick={() => {
                      setIsDrawingMode(false);
                      setDrawnPoints([]);
                      setUndoStack([]);
                      setRedoStack([]);
                      setSelectedPointIdx(null);
                      setShowExitConfirm(false);
                    }}
                    className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white font-black text-[9px] rounded-lg transition-all text-center leading-none"
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
                  className="p-2.5 rounded-xl bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 active:scale-95 transition-all shrink-0"
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
              <h3 className="text-base font-black tracking-tight text-center">添加新站</h3>
              <input
                type="text"
                placeholder="输入新站名"
                value={namingValue}
                onChange={e => setNamingValue(e.target.value)}
                className="px-4 py-3 bg-slate-800 text-white rounded-xl border border-slate-700 outline-none focus:border-blue-500 text-xs font-bold w-full"
                autoFocus
              />
              <div className="flex justify-end gap-3.5 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (namingStopIdx === 0) {
                      // Abort first point and exit naming modal smoothly
                      setDrawnPoints([]);
                      setNamingStopIdx(null);
                      setNamingValue('');
                      return;
                    }
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
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-white text-sm">{hist.name}</span>
                            <span className="text-[10px] text-slate-400">By {hist.creatorNickname}</span>
                          </div>
                          <span className="text-[10px] text-slate-300 font-medium">
                            途经: {hist.via_stops.map((vs: any) => vs.name).join(' → ')}
                          </span>
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
                            <span className="px-2.5 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/25 text-[10px] font-black">
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
                  <h3 className="text-sm font-black tracking-tight">自绘待审核中心</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={fetchPendingSubmissions}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-300 text-[10px] font-bold"
                  >
                    刷新
                  </button>
                  <button 
                    onClick={() => setShowAuditModal(false)}
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
                            sub.via_stops.map((vs: any) => vs.name).join(' → ')
                          ) : (
                            <span className="italic text-slate-500">仅有轨迹</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 justify-end shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAdminAction(sub.id, 'reject');
                          }}
                          className="px-2.5 py-1.5 border border-red-500/20 text-red-400 hover:bg-red-500/15 rounded-lg font-bold transition-all text-[10px]"
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
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Admin Data Management Dashboard Overlay Panel */}
        {showManageModal && (
          <div className="fixed top-20 right-4 z-[100] flex flex-col pointer-events-auto w-[420px] h-[550px] max-w-[calc(100vw-32px)]">
            <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 p-5 rounded-3xl shadow-2xl flex flex-col text-white h-full">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  <h3 className="text-sm font-black tracking-tight">自绘数据发布管理</h3>
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

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5">
                {approvedUserLines.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16 gap-2 text-xs">
                    <span>正式发布的线路列表为空</span>
                  </div>
                ) : (
                  approvedUserLines.map((line) => {
                    const isEditing = editingLineId === line.id;
                    return (
                      <div 
                        key={line.id} 
                        onClick={() => handlePreviewLineOnMap(line)}
                        className="p-3 bg-slate-850/80 border border-slate-850 hover:border-purple-500/50 rounded-xl flex flex-col gap-3 text-xs transition-all cursor-pointer hover:bg-slate-800 group relative"
                        title="点击进行地图预览"
                      >
                        <div className="flex flex-col gap-1.5">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="text"
                                value={editingLineName}
                                onChange={(e) => setEditingLineName(e.target.value)}
                                className="px-2 py-1 bg-slate-800 border border-slate-600 rounded text-xs text-white max-w-[150px] font-bold"
                                autoFocus
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditApprovedLine(line.id, editingLineName);
                                }}
                                className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[9px] font-black rounded"
                              >
                                保存
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLineId(null);
                                }}
                                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[9px] font-bold rounded"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-extrabold text-purple-400 text-sm truncate max-w-[180px]">{line.name}</span>
                              <span className="px-1.5 py-0.5 rounded-md bg-slate-700 text-[8px] font-black text-slate-300 shrink-0">
                                {line.city} • {line.district || '所有区'}
                              </span>
                            </div>
                          )}
                          <div className="text-slate-400 text-[9px]">
                            绘图者: {line.creatorNickname || '匿名'}
                          </div>
                          <div className="text-slate-300 text-[10px] line-clamp-2 leading-relaxed">
                            <span className="font-bold text-slate-400">途径车站: </span>
                            {line.via_stops && line.via_stops.length > 0 ? (
                              line.via_stops.map((vs: any) => vs.name).join(' → ')
                            ) : (
                              <span className="italic text-slate-500">（仅精细线路轨迹）</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 justify-end shrink-0" onClick={(e) => e.stopPropagation()}>
                          {!isEditing && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingLineId(line.id);
                                setEditingLineName(line.name);
                              }}
                              className="px-2 py-1 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 rounded font-bold transition-all text-[9px] flex items-center gap-0.5"
                            >
                              <Edit3 className="w-2.5 h-2.5" />
                              <span>修改名称</span>
                            </button>
                          )}
                          {deletingLineId === line.id ? (
                            <div className="flex items-center gap-1 shrink-0 bg-red-950/40 p-0.5 rounded border border-red-500/20">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteApprovedLine(line.id);
                                }}
                                className="px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-[9px] transition-colors"
                              >
                                确认删除
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingLineId(null);
                                }}
                                className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-[9px] transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingLineId(line.id);
                              }}
                              className="px-2 py-1 border border-red-500/20 text-red-400 hover:bg-red-500/15 rounded font-bold transition-all text-[9px] flex items-center gap-0.5"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              <span>删除</span>
                            </button>
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

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSettings(false)}
                className="fixed inset-0 z-[100] bg-slate-900/10 backdrop-blur-md pointer-events-auto"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[460px] max-w-[90vw] h-[340px] backdrop-blur-3xl bg-white/80 border border-white/50 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
              >
                <div className="flex h-full">
                  <div className="w-36 bg-slate-50/50 border-r border-slate-100 flex flex-col p-3 gap-1 relative overflow-hidden">
                    <div className="px-3 py-4 mb-2">
                       <h2 className="text-[10px] font-black text-slate-900 uppercase tracking-[0.2em]">{t('settings')}</h2>
                    </div>
                    <button 
                      onClick={() => setSettingsTab('general')}
                      className={`px-4 py-2.5 rounded-xl text-left text-xs font-bold transition-all ${settingsTab === 'general' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:bg-slate-200/50'}`}
                    >
                      {t('general')}
                    </button>
                    <button 
                      onClick={() => setSettingsTab('dataFilter')}
                      className={`px-4 py-2.5 rounded-xl text-left text-xs font-bold transition-all ${settingsTab === 'dataFilter' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:bg-slate-200/50'}`}
                    >
                      {t('dataFilter')}
                    </button>
                    <button 
                      onClick={() => setSettingsTab('experimental')}
                      className={`px-4 py-2.5 rounded-xl text-left text-xs font-bold transition-all ${settingsTab === 'experimental' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:bg-slate-200/50'}`}
                    >
                      {t('experimental')}
                    </button>
                    <button 
                      onClick={() => setSettingsTab('about')}
                      className={`px-4 py-2.5 rounded-xl text-left text-xs font-bold transition-all ${settingsTab === 'about' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:bg-slate-200/50'}`}
                    >
                      {t('about')}
                    </button>
                  </div>

                  <div className="flex-1 p-8 overflow-y-auto relative">
                    <button
                      onClick={() => setShowSettings(false)}
                      className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors z-10"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    {settingsTab === 'general' ? (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-1">
                            <span className="text-xs font-bold text-slate-700">{t('showStations')}</span>
                            <button 
                              onClick={toggleStations}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 ${showStations ? 'bg-blue-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: showStations ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between p-1">
                            <span className="text-xs font-bold text-slate-700">{t('showBaseMap')}</span>
                            <button 
                              onClick={toggleBaseMap}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 ${showBaseMap ? 'bg-blue-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: showBaseMap ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between p-1">
                            <span className="text-xs font-bold text-slate-700">{t('stationLineStats')}</span>
                            <button 
                              onClick={toggleStationLineStats}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 ${stationLineStats ? 'bg-blue-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: stationLineStats ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between p-1">
                            <span className="text-xs font-bold text-slate-700">{t('showMoreInfo')}</span>
                            <button 
                              onClick={toggleMoreInfo}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 ${showMoreInfo ? 'bg-blue-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: showMoreInfo ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>
                        </div>

                        <div className="h-px bg-slate-100 w-full" />

                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">{t('lineThickness')}</label>
                          <div className="flex bg-slate-100 p-1 rounded-2xl">
                            <button
                              onClick={() => setLineThickness('thick')}
                              className={`flex-1 py-2 text-xs font-bold transition-all rounded-xl ${lineThickness === 'thick' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                              {t('thick')}
                            </button>
                            <button
                              onClick={() => setLineThickness('thin')}
                              className={`flex-1 py-2 text-xs font-bold transition-all rounded-xl ${lineThickness === 'thin' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                              {t('thin')}
                            </button>
                          </div>
                        </div>

                        <div className="h-px bg-slate-100 w-full" />

                        <div>
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">{t('language')}</label>
                          <div className="flex flex-col gap-2">
                            {[
                              { label: '简体中文', value: 'zh-CN' },
                              { label: '繁體中文', value: 'zh-TW' },
                              { label: 'English', value: 'en' },
                            ].map((lang) => (
                              <button
                                key={lang.value}
                                onClick={() => setLanguage(lang.value)}
                                className={`w-full px-4 py-3 rounded-2xl border text-xs font-bold text-left transition-all flex items-center justify-between ${language === lang.value ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-100 text-slate-500 hover:border-slate-300'}`}
                              >
                                {lang.label}
                                {language === lang.value && <div className="w-1.5 h-1.5 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.6)]" />}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : settingsTab === 'dataFilter' ? (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-1">
                            <span className="text-xs font-bold text-slate-700">{t('filterAirportBus')}</span>
                            <button 
                              onClick={toggleFilterAirportBus}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 ${filterAirportBus ? 'bg-blue-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: filterAirportBus ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>

                          <div className="flex items-center justify-between p-1">
                            <span className="text-xs font-bold text-slate-700">{t('filterUserSubmissions')}</span>
                            <button 
                              onClick={toggleFilterUserSubmissions}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 ${filterUserSubmissions ? 'bg-blue-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: filterUserSubmissions ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : settingsTab === 'experimental' ? (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-1">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-700">{t('cityWideSearch')}</span>
                              <span className="text-[10px] text-slate-400 mt-1 max-w-[200px] leading-tight">实验性功能：可能导致设备极度卡顿</span>
                            </div>
                            <button 
                              onClick={toggleCityWideSearch}
                              className={`w-12 h-6 rounded-full transition-all relative flex items-center px-1 shrink-0 ${enableCityWideSearch ? 'bg-red-500' : 'bg-slate-300'}`}
                            >
                              <motion.div 
                                layout
                                animate={{ x: enableCityWideSearch ? 24 : 0 }}
                                className="w-4 h-4 bg-white rounded-full shadow-sm"
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center min-h-full py-4 gap-4">
                        <div className="w-20 h-20 bg-white border border-slate-100 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/10 mb-2">
                           <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 17H20" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
                            <path d="M17 4V20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
                            <path d="M8 20V13L13 8H22" stroke="#eab308" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <h3 className="text-xl font-black text-slate-900 tracking-tight">{t('title')}</h3>
                        <div className="px-4 py-1.5 bg-slate-100 rounded-full">
                           <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('version')} V3.0</span>
                        </div>
                        <div className="flex flex-col items-center mt-2 gap-3">
                           <span 
                             onClick={handleFooterClick}
                             className="text-[11px] font-bold text-slate-500 cursor-pointer hover:text-blue-500 select-none"
                           >
                             @TsFeng
                           </span>
                           <div className="flex items-center gap-3">
                              <a href="https://space.bilibili.com/24964342" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center rounded-full bg-[#fb7299] text-white hover:bg-[#ff8eb3] transition-colors shadow-sm">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.755 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386z"/></svg>
                              </a>
                              <a href="https://github.com/tsfeng6" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 text-white hover:bg-black transition-colors shadow-sm">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                              </a>
                           </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* City Wide Search Warning Modal */}
        <AnimatePresence>
          {showCityWideConfirm && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-sm pointer-events-auto"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[111] w-[340px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col pointer-events-auto border border-red-100"
              >
                <div className="p-6 pb-2">
                  <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-4">
                    <Info className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">{t('cityWideSearch')}</h3>
                  <p className="text-sm font-medium text-slate-500 leading-relaxed">
                    {t('cityWideSearchWarning')}
                  </p>
                </div>
                <div className="p-4 flex gap-3 mt-2">
                  <button
                    onClick={cancelCityWideSearch}
                    className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    onClick={confirmCityWideSearch}
                    className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all hover:scale-105 active:scale-95"
                  >
                    {t('confirmEnable')}
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Removed duplicate UI elements */}

        {showMoreInfo && (
          <div className="hidden md:block absolute bottom-4 left-4 z-10 pointer-events-none">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="backdrop-blur-2xl bg-white/95 border border-white p-3 rounded-[2rem] shadow-[0_12px_40px_rgba(0,0,0,0.12)] flex flex-col gap-3 pointer-events-auto min-w-[140px]"
            >
              {/* Legend Row */}
              <div className="hidden md:flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
                  <span className="text-[10px] font-black text-slate-400">1-3</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-yellow-500 shadow-sm" />
                  <span className="text-[10px] font-black text-slate-400">4-9</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-rose-500 shadow-sm" />
                  <span className="text-[10px] font-black text-slate-400">10+</span>
                </div>
              </div>

              {/* Separator */}
              <div className="hidden md:block h-px bg-slate-100 w-full" />
              
              {/* Stats row with pulsing indicator */}
              <div className="flex items-center justify-between px-1">
                <div className="flex gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-slate-900 leading-none">{stats.stops}</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{t('stops')}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-slate-900 leading-none">{stats.lines}</span>
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{t('lines')}</span>
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
              </div>
            </motion.div>
          </div>
        )}


        <AnimatePresence>
          {(selectedStop || selectedSegmentLines) && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className={`fixed bottom-[100px] left-4 right-4 md:top-[96px] md:bottom-auto md:left-4 md:right-auto z-50 pointer-events-auto transition-all duration-300`}
            >
              <div className="backdrop-blur-2xl bg-white/95 border border-white/50 p-3 md:p-6 rounded-3xl md:rounded-[2.5rem] shadow-2xl w-full md:w-[360px] md:max-h-[calc(100vh-220px)] overflow-hidden flex flex-col md:border-t-4 md:border-t-blue-500 relative">
                <button 
                  onClick={() => {
                    setSelectedStop(null);
                    setSelectedSegmentLines(null);
                    setSelectionPos(null);
                    setSelectedSegmentName(null);
                  }}
                  className="absolute top-3 right-3 md:top-5 md:right-5 p-1.5 md:p-2.5 hover:bg-slate-100 rounded-xl md:rounded-2xl transition-colors bg-white shadow-sm border border-slate-100 z-10"
                >
                  <X className="w-4 h-4 md:w-5 md:h-5 text-slate-400" />
                </button>

                <div className="mb-2 md:mb-6 pr-8">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base md:text-2xl font-black text-slate-800 tracking-tighter truncate">
                      {selectedStop ? selectedStop.name : (selectedSegmentName === "正在获取路段信息..." ? "当前位置" : (selectedSegmentName || "当前位置"))}
                    </h3>
                    {((selectedStop && selectedStop.lines && selectedStop.lines.length > 0) || (selectedSegmentLines && selectedSegmentLines.length > 0 && selectedStop === null)) && (
                      <div className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider shrink-0">
                        {new Set((selectedStop ? selectedStop.lines : selectedSegmentLines || []).map((l: string) => {
                          const info = parseLineInfo(l);
                          return info.name.replace('路', '') + '|' + info.start + '|' + info.end;
                        })).size} {t('lines')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    {(selectedStop?.address || selectedSegmentAddress) && (
                      <p className="text-[9px] md:text-[11px] font-medium text-slate-400 truncate max-w-[65%]">
                        {selectedStop?.address || selectedSegmentAddress}
                      </p>
                    )}
                    {selectedStop && selectedStop.lines && selectedStop.lines.length > 0 && selectedStop.isBusStop !== false && (
                      <button 
                        onClick={() => showStopConnectivity(selectedStop.lines)}
                        className="text-[9px] md:text-[10px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100 shadow-sm transition-all absolute right-12 top-3 md:relative md:top-auto md:right-auto"
                      >
                        {t('connectivity')}
                      </button>
                    )}
                  </div>
                  {selectedStop?.segmentName && (
                    <div className="mt-2 text-[12px] md:text-[14px] font-black text-slate-700 bg-slate-50 border border-slate-200 shadow-sm px-3 md:px-4 py-1.5 md:py-2 rounded-lg flex items-center justify-center truncate">
                      {selectedStop.segmentName}
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto md:overflow-y-auto custom-scrollbar flex-1 pb-1 md:pb-0 px-1 -mx-1 md:mx-0 md:pr-2 gap-1.5 md:gap-3 flex md:flex-col items-center md:items-stretch h-[32px] md:h-auto snap-x snap-mandatory">
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
                    return (
                      <div 
                        key={line + idx}
                        onClick={() => handleManualSearch({ name: line, type: 'busline' })}
                        className="md:bg-white md:border md:border-slate-100 md:rounded-2xl md:p-3 bg-slate-100 rounded p-1.5 px-2.5 flex md:gap-4 items-center md:hover:bg-slate-50 md:hover:border-blue-100 md:hover:shadow-lg transition-all group relative overflow-hidden shrink-0 cursor-pointer snap-center max-w-[120px] md:max-w-none md:w-auto md:h-[72px]"
                      >
                        <div className="hidden md:block absolute left-0 top-0 bottom-0 w-1 bg-blue-500/0 md:group-hover:bg-blue-500 transition-all" />
                        
                        <div className="flex flex-col items-center">
                          <div className="md:bg-slate-900 md:text-white text-slate-800 font-black text-[11px] md:text-[10px] md:w-12 md:h-12 md:rounded-2xl shrink-0 flex items-center justify-center md:shadow-md md:group-hover:bg-blue-600 transition-colors whitespace-nowrap">
                            {name.replace('路', '')}
                          </div>
                          {isUserSub && (
                            <span className="text-[8px] font-bold text-[#BA55D3] md:hidden mt-0.5 leading-none shrink-0 whitespace-nowrap">
                              用户添加
                            </span>
                          )}
                        </div>

                        <div className="hidden md:flex flex-col min-w-0 flex-1 justify-center h-full">
                          {isUserSub && (
                            <div className="mb-1 text-left">
                              <span className="px-1.5 py-0.5 rounded bg-purple-50 text-[9px] font-black text-[#BA55D3] border border-purple-100 whitespace-nowrap inline-block leading-none">
                                用户添加
                              </span>
                            </div>
                          )}
                          <div className="flex flex-col gap-1.5">
                            {start !== '-' ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                  <span className="text-[11px] font-black text-slate-700 truncate leading-none">{start}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                                  <span className="text-[11px] font-medium text-slate-400 truncate leading-none">{end}</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-[10px] font-bold text-slate-300 italic px-1">
                                {t('noDirection')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeBusLine && (
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className={`fixed ${selectedStop || selectedSegmentName ? 'bottom-[220px]' : 'bottom-[100px]'} md:bottom-auto left-4 right-4 md:top-24 md:left-4 z-40 md:w-64 pointer-events-auto transition-all duration-300 md:h-[calc(100vh-220px)]`}
            >
              <div className="backdrop-blur-2xl bg-white/95 border border-white/50 rounded-3xl md:rounded-[2rem] shadow-2xl h-[100px] md:h-full flex flex-col overflow-hidden relative md:border-t-4 md:border-t-blue-500">
                <button 
                  onClick={() => {
                    setActiveBusLine(null);
                    handleClear();
                  }}
                  className="absolute top-2.5 right-2.5 md:top-3 md:right-3 p-1.5 md:p-2 hover:bg-slate-100 rounded-xl transition-colors bg-white shadow-sm border border-slate-100 z-10"
                >
                  <X className="w-3 h-3 md:w-4 md:h-4 text-slate-400" />
                </button>
                <div className="p-2.5 px-4 md:p-4 md:py-4 border-b border-slate-100 shrink-0 flex flex-col items-start gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-black text-slate-800 text-sm md:text-lg whitespace-nowrap">
                      {parseLineInfo(activeBusLine.name).name.replace('路','')}
                    </span>
                    {activeBusLine.isUserSubmitted && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-50 text-[8px] font-black text-purple-400 border border-purple-100 whitespace-nowrap">
                        用户添加
                      </span>
                    )}
                  </div>
                  {activeBusLine.isUserSubmitted && activeBusLine.creatorNickname && (
                    <span className="text-[10px] text-purple-400 font-bold leading-none">
                      绘制者：{activeBusLine.creatorNickname}
                    </span>
                  )}
                  <span className="text-[10px] md:text-xs text-slate-400 font-medium truncate">
                    {parseLineInfo(activeBusLine.name).start !== '-' ? `${parseLineInfo(activeBusLine.name).start} - ${parseLineInfo(activeBusLine.name).end}` : '环线 / 方向未知'}
                  </span>
                </div>
                <div className="flex-1 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto custom-scrollbar p-0 md:p-4 md:pr-2 flex flex-row md:flex-col items-center md:items-stretch snap-x snap-mandatory mt-1 md:mt-0">
                  <div className="relative flex flex-row md:flex-col items-center md:items-stretch md:pl-1 h-full md:h-auto w-max md:w-auto px-4 md:px-0">
                    <div className="hidden md:block absolute left-[9px] top-4 bottom-4 w-0.5 bg-slate-200" />
                    <div className="md:hidden absolute top-[14px] left-8 right-8 h-0.5 bg-slate-200" />
                    {activeBusLine.via_stops.map((stop: any, idx: number) => {
                      const isSelected = selectedStop?.name === stop.name;
                      const count = stopCountCacheRef.current.get(`${stop.location.lng},${stop.location.lat}`) || 0;
                      const iconColor = getStopColor(count, '#3b82f6');
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
                            <div className="w-[12px] h-[12px] md:w-[14px] md:h-[14px] rounded-full border-2 md:border-4 border-white shadow-sm z-10" style={{ backgroundColor: iconColor, boxShadow: `0 0 0 1px ${iconColor}4D` }} />
                          </div>
                          <div className={`text-[10px] md:text-sm font-bold leading-tight md:pt-0.5 transition-colors w-full text-center md:text-left truncate px-1 md:px-0 ${isSelected ? 'text-blue-600' : 'text-slate-700 group-hover:text-blue-600'}`}>
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

      </main>

      <footer className="fixed bottom-4 right-4 z-20 pointer-events-none flex flex-col items-end gap-2">
        {!isDrawingMode && (
          <button 
            onClick={handleLocate}
            className="backdrop-blur-xl bg-white/80 border border-white/50 w-12 h-12 rounded-full shadow-2xl flex items-center justify-center text-blue-600 hover:bg-white transition-all active:scale-95 hover:shadow-blue-500/10 pointer-events-auto mb-1"
          >
            <Navigation className="w-5 h-5 fill-blue-600/10" />
          </button>
        )}
        <div className="mr-2 cursor-pointer pointer-events-auto" onClick={handleFooterClick}>
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
      </footer>
    </div>
  );
}
