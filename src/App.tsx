import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Camera,
  RotateCcw,
  Check,
  Image as ImageIcon,
  Grid,
  Zap,
  ZapOff,
  RotateCw,
  ArrowLeft,
  ScanLine,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Tag,
  Calendar,
  Hash,
  Layers,
  ShieldCheck,
  RefreshCw,
  Search,
  X,
  Package,
  Clock,
  Trash2,
  Plus,
  ArrowRight,
  AlertTriangle,
  Sun,
  Moon,
  Compass
} from 'lucide-react';
import { sendToGemini, ExtractionResult, EXTRACTION_PROMPT } from './services/gemini';
import {
  MaterialItem,
  saveMaterialToFirestore,
  subscribeMaterials,
  deleteMaterial,
  computeMaterialStatus,
  calculateExpiryDate
} from './services/materialService';
import {
  InventoryAlert,
  computeAlerts,
  syncAlertsWithFirestore,
  subscribeAlerts
} from './services/alertService';
import {
  PurchaseOrder,
  subscribeOrders,
  draftOrder,
  getCachedOrders,
} from './services/orderService';
import { AlertsScreen } from './components/AlertsScreen';
import { OrdersScreen } from './components/OrdersScreen';
import { DraftOrderModal } from './components/DraftOrderModal';
import { MaterialSettingsModal } from './components/MaterialSettingsModal';
import SenpaiScreen from './components/SenpaiScreen';
import BankaiTodayCard from './components/BankaiTodayCard';
import MaterialDetailsModal from './components/MaterialDetailsModal';
import { AppLanguage, SUPPORTED_LANGUAGES, speakText } from './services/speechService';
import { useLanguage } from './context/LanguageContext';
import { Mic, Flame, History, Sliders, ShoppingCart, ClipboardList } from 'lucide-react';

// Re-export for external consumer/tests
export { sendToGemini, EXTRACTION_PROMPT, computeAlerts, draftOrder };
export type { ExtractionResult, MaterialItem, InventoryAlert, PurchaseOrder };

// Attach to window for automated testing
if (typeof window !== 'undefined') {
  (window as any).sendToGemini = sendToGemini;
}

// Preset sample photos for desktop testing
const SAMPLE_PHOTOS = [
  {
    name: 'grocery_coffee.jpg',
    url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1200&q=80',
    type: 'Label: Coffee',
    size: '1.4 MB',
    mock: {
      name: 'Organic Fairtrade Coffee Beans',
      category: 'Groceries',
      batchNo: 'BATCH-CF-902',
      purchaseDate: '2026-10-14',
      quantity: 2,
      unit: 'bags',
      confidence: 0.97,
    },
    shelfLifeDays: 180,
  },
  {
    name: 'medicine_box.jpg',
    url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=80',
    type: 'Label: Medicine',
    size: '1.8 MB',
    mock: {
      name: 'Amoxicillin 500mg Capsules',
      category: 'Pharmaceuticals',
      batchNo: 'LOT-AMX-2026',
      purchaseDate: '2026-10-10',
      quantity: 5,
      unit: 'boxes',
      confidence: 0.98,
    },
    shelfLifeDays: 30,
  },
  {
    name: 'chemical_reagent.jpg',
    url: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=1200&q=80',
    type: 'Label: Chemical',
    size: '980 KB',
    mock: {
      name: 'Sodium Chloride Analytical Grade',
      category: 'Raw Materials',
      batchNo: 'LOT-SC-551',
      purchaseDate: '2026-08-01',
      quantity: 10,
      unit: 'kg',
      confidence: 0.95,
    },
    shelfLifeDays: 60,
  },
  {
    name: 'random_photo.jpg',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    type: 'Non-Label (Beach)',
    size: '1.1 MB',
    mock: {
      name: 'No label detected',
      category: null,
      batchNo: null,
      purchaseDate: null,
      quantity: null,
      unit: null,
      confidence: 0,
    },
    shelfLifeDays: 90,
  },
];

type ActiveTab = 'scan' | 'inventory' | 'alerts' | 'orders' | 'senpai';
type ScanMode = 'document' | 'photo' | 'id_card';
type StatusFilter = 'all' | 'ok' | 'expiring' | 'expired';
type ThemeMode = 'dark' | 'light';

interface CapturedPhotoData {
  dataUrl: string;
  name: string;
  sizeFormatted: string;
  timestamp: string;
  dimensions?: { width: number; height: number };
  sampleMock?: ExtractionResult;
  defaultShelfLife?: number;
}

export default function App() {
  const { currentLang, setLanguage, t } = useLanguage();

  // Theme state: defaults to dark (looks more premium)
  const [theme, setTheme] = useState<ThemeMode>('dark');

  // Navigation tabs: 'scan', 'inventory', 'alerts', 'orders', or 'senpai'
  const [activeTab, setActiveTab] = useState<ActiveTab>('scan');
  const [senpaiInitialPrompt, setSenpaiInitialPrompt] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(true);

  // 3D Card Flip Transition state
  const [isCardFlipped, setIsCardFlipped] = useState<boolean>(false);
  const [isSheenActive, setIsSheenActive] = useState<boolean>(false);
  const [isGeminiLoading, setIsGeminiLoading] = useState<boolean>(false);

  // Captured image
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhotoData | null>(null);

  // Extracted item details
  const [extractedData, setExtractedData] = useState<ExtractionResult | null>(null);
  const [shelfLifeDays, setShelfLifeDays] = useState<number>(90);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  // Inventory state from Firestore
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedMaterialForDetails, setSelectedMaterialForDetails] = useState<MaterialItem | null>(null);

  // Alerts state
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState<boolean>(false);

  // Orders state
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(true);

  // Reorder / threshold modals state
  const [selectedMaterialForSettings, setSelectedMaterialForSettings] = useState<MaterialItem | null>(null);
  const [selectedMaterialForDraft, setSelectedMaterialForDraft] = useState<MaterialItem | null>(null);
  const [draftOrderType, setDraftOrderType] = useState<'reorder' | 'replacement' | 'manual'>('reorder');

  // Camera UI controls
  const [selectedMode, setSelectedMode] = useState<ScanMode>('document');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [flashOn, setFlashOn] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Hidden camera and gallery inputs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const triggerNotice = (msg: string) => {
    setFeedbackNotice(msg);
    setTimeout(() => {
      setFeedbackNotice(null);
    }, 3200);
  };

  // Stable refs for materials and orders to break circular dependency loops
  const materialsRef = useRef<MaterialItem[]>([]);
  const ordersRef = useRef<PurchaseOrder[]>([]);
  const isSyncingAlertsRef = useRef<boolean>(false);

  // Keep refs in sync
  materialsRef.current = materials;
  ordersRef.current = orders;

  // Compute and sync alerts helper with stable reference (no re-renders, no loop)
  const recomputeAllAlerts = useCallback(
    async (currentMaterials?: MaterialItem[], currentOrders?: PurchaseOrder[]) => {
      const mats = currentMaterials ?? materialsRef.current;
      const ords = currentOrders ?? (ordersRef.current.length > 0 ? ordersRef.current : getCachedOrders());

      const computed = computeAlerts(mats, ords);
      setAlerts(computed);

      // Persist alerts to Firestore in background without re-entrant sync storms
      if (!isSyncingAlertsRef.current && mats.length > 0) {
        isSyncingAlertsRef.current = true;
        try {
          await syncAlertsWithFirestore(computed, mats);
        } catch (err) {
          console.warn('syncAlertsWithFirestore notice:', err);
        } finally {
          isSyncingAlertsRef.current = false;
        }
      }
    },
    []
  );

  // Subscribe to real-time Firestore materials collection
  useEffect(() => {
    const unsubscribe = subscribeMaterials(
      (items) => {
        setMaterials(items);
        materialsRef.current = items;
        setIsLoadingMaterials(false);
        // Automatically recompute alerts whenever materials change
        recomputeAllAlerts(items, ordersRef.current);
      },
      (err) => {
        console.warn('Firestore subscription warning:', err);
        setIsLoadingMaterials(false);
      }
    );

    return () => unsubscribe();
  }, [recomputeAllAlerts]);

  // Subscribe to real-time Firestore alerts collection
  useEffect(() => {
    const unsubscribe = subscribeAlerts(
      (items) => {
        if (items && items.length > 0) {
          setAlerts(items);
        }
      },
      (err) => {
        console.warn('Alerts subscription notice:', err);
      }
    );

    return () => unsubscribe();
  }, []);

  // Subscribe to real-time Firestore orders collection
  useEffect(() => {
    const unsubscribe = subscribeOrders(
      (items) => {
        setOrders(items);
        ordersRef.current = items;
        setIsLoadingOrders(false);
        recomputeAllAlerts(materialsRef.current, items);
      },
      (err) => {
        console.warn('Orders subscription notice:', err);
        setIsLoadingOrders(false);
      }
    );

    return () => unsubscribe();
  }, [recomputeAllAlerts]);

  const handleOpenDeviceCamera = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
      cameraInputRef.current.click();
    }
  };

  const handleOpenGallery = () => {
    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
      galleryInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    processFile(file);
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const photoInfo: CapturedPhotoData = {
          dataUrl,
          name: file.name || `scan_${new Date().toISOString().slice(0, 10)}.jpg`,
          sizeFormatted: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          dimensions: { width: img.naturalWidth, height: img.naturalHeight },
        };
        setCapturedPhoto(photoInfo);
        setRotation(0);
        setShelfLifeDays(90);
        setIsCameraActive(false);
        setIsCardFlipped(false);
        setIsSheenActive(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    setExtractedData(null);
    setExtractionError(null);
    setRotation(0);
    setIsCameraActive(true);
    setIsCardFlipped(false);
    setIsSheenActive(false);
    setTimeout(() => {
      handleOpenDeviceCamera();
    }, 150);
  };

  /**
   * Signature 3D Card Flip Transition on "Use photo":
   * 1. FRONT face (captured photo) flips to BACK face (result card) via rotateY 0 -> 180deg over ~700ms.
   * 2. Sheen light-sweep activates across surface.
   * 3. Calls sendToGemini and saves to Firestore.
   */
  const handleUsePhoto = async () => {
    if (!capturedPhoto?.dataUrl) return;

    // Trigger the 3D flip immediately!
    setIsCardFlipped(true);
    setIsSheenActive(true);
    setIsGeminiLoading(true);
    setExtractionError(null);

    // Reset sheen trigger after 1s animation
    setTimeout(() => {
      setIsSheenActive(false);
    }, 1100);

    let extracted: ExtractionResult | null = null;

    try {
      extracted = await sendToGemini(capturedPhoto.dataUrl);
    } catch (err: any) {
      console.warn('sendToGemini error, fallback evaluation:', err);
      if (capturedPhoto.sampleMock) {
        extracted = capturedPhoto.sampleMock;
      } else {
        extracted = {
          name: 'No label detected',
          category: null,
          batchNo: null,
          purchaseDate: null,
          quantity: null,
          unit: null,
          confidence: 0,
        };
      }
    }

    setExtractedData(extracted);
    setIsGeminiLoading(false);

    try {
      if (extracted.name && extracted.name !== 'No label detected') {
        await saveMaterialToFirestore(extracted, shelfLifeDays);
        triggerNotice('Saved to Firestore collection "materials" with status "ok"!');
      } else {
        triggerNotice('Analyzed: No product label detected.');
      }
    } catch (dbErr: any) {
      console.error('Failed to save to Firestore:', dbErr);
      setExtractionError(dbErr?.message || 'Failed to save to Firestore.');
    }
  };

  const handleLoadSample = (sample: (typeof SAMPLE_PHOTOS)[0]) => {
    setCapturedPhoto({
      dataUrl: sample.url,
      name: sample.name,
      sizeFormatted: sample.size,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dimensions: { width: 1920, height: 1080 },
      sampleMock: sample.mock,
      defaultShelfLife: sample.shelfLifeDays,
    });
    setShelfLifeDays(sample.shelfLifeDays || 90);
    setRotation(0);
    setIsCameraActive(false);
    setIsCardFlipped(false);
    setIsSheenActive(false);
  };

  const handleDeleteMaterial = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setDeletingId(id);
      await deleteMaterial(id);
      triggerNotice('Material removed from inventory.');
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredMaterials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return materials.filter((item) => {
      const currentStatus = computeMaterialStatus(item.expiryDate);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'ok' && currentStatus === 'ok') ||
        (statusFilter === 'expiring' && currentStatus === 'expiring') ||
        (statusFilter === 'expired' && currentStatus === 'expired');

      if (!matchesStatus) return false;
      if (!q) return true;

      const nameMatch = (item.name || '').toLowerCase().includes(q);
      const batchMatch = (item.batchNo || '').toLowerCase().includes(q);
      const categoryMatch = (item.category || '').toLowerCase().includes(q);

      return nameMatch || batchMatch || categoryMatch;
    });
  }, [materials, searchQuery, statusFilter]);

  const statusCounts = useMemo(() => {
    let ok = 0;
    let expiring = 0;
    let expired = 0;

    materials.forEach((m) => {
      const st = computeMaterialStatus(m.expiryDate);
      if (st === 'ok') ok++;
      else if (st === 'expiring') expiring++;
      else if (st === 'expired') expired++;
    });

    return { all: materials.length, ok, expiring, expired };
  }, [materials]);

  const isDark = theme === 'dark';

  return (
    <div
      className={`min-h-screen relative overflow-hidden transition-colors duration-500 flex flex-col justify-between items-center ${
        isDark ? 'bg-[#0b0d12] text-white selection:bg-[#4285F4]/30' : 'bg-[#f8fafc] text-[#1f2733] selection:bg-[#4285F4]/20'
      }`}
    >
      {/* ------------------------------------------------------------- */}
      {/* BACKGROUND: SOFT, DRIFTING GOOGLE-COLOURED AURORA GRADIENT MESH */}
      {/* ------------------------------------------------------------- */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Google Blue Blob */}
        <div
          className={`absolute top-[-10%] left-[-15%] w-[420px] h-[420px] rounded-full blur-[90px] aurora-blob-blue transition-opacity duration-700 ${
            isDark ? 'bg-[#4285F4]/16' : 'bg-[#4285F4]/10'
          }`}
        />
        {/* Google Red Blob */}
        <div
          className={`absolute top-[35%] right-[-15%] w-[380px] h-[380px] rounded-full blur-[100px] aurora-blob-red transition-opacity duration-700 ${
            isDark ? 'bg-[#EA4335]/14' : 'bg-[#EA4335]/8'
          }`}
        />
        {/* Google Green Blob */}
        <div
          className={`absolute bottom-[-10%] left-[10%] w-[400px] h-[400px] rounded-full blur-[95px] aurora-blob-green transition-opacity duration-700 ${
            isDark ? 'bg-[#34A853]/15' : 'bg-[#34A853]/9'
          }`}
        />
        {/* Google Yellow Blob */}
        <div
          className={`absolute top-[15%] right-[25%] w-[320px] h-[320px] rounded-full blur-[85px] aurora-blob-yellow transition-opacity duration-700 ${
            isDark ? 'bg-[#FBBC04]/12' : 'bg-[#FBBC04]/8'
          }`}
        />
      </div>

      {/* Hidden camera and gallery inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Camera Capture Input"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        aria-label="File Upload Input"
      />

      {/* Main Mobile-First Shell (440px max width) */}
      <div
        className={`w-full max-w-[440px] min-h-screen sm:my-4 sm:min-h-[844px] sm:max-h-[920px] sm:rounded-[28px] flex flex-col relative z-10 overflow-hidden transition-all duration-300 shadow-[0_24px_60px_rgba(0,0,0,0.5)] border ${
          isDark
            ? 'bg-[#10131b]/80 border-white/10 backdrop-blur-2xl'
            : 'bg-white/85 border-slate-200/90 backdrop-blur-2xl'
        }`}
      >
        {/* Toast Notice */}
        {feedbackNotice && (
          <div className="absolute top-16 left-4 right-4 z-50 bg-[#161a24]/95 text-white px-4 py-3 rounded-[20px] text-xs font-medium flex items-center justify-between border border-white/15 shadow-2xl backdrop-blur-xl animate-bounce">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#FBBC04] flex-shrink-0" />
              <span className="line-clamp-2">{feedbackNotice}</span>
            </span>
          </div>
        )}

        {/* Global Header */}
        <header
          className={`h-16 px-4 flex items-center justify-between z-20 flex-shrink-0 border-b transition-colors ${
            isDark ? 'bg-[#10131b]/60 border-white/10' : 'bg-white/60 border-slate-200/70'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {/* Signature Rainbow Sparkle Logo */}
            <div className="w-10 h-10 rounded-[14px] ai-rainbow-gradient p-[1.5px] flex items-center justify-center shadow-lg">
              <div
                className={`w-full h-full rounded-[13px] flex items-center justify-center ${
                  isDark ? 'bg-[#0e1118]' : 'bg-white'
                }`}
              >
                <Sparkles className="w-5 h-5 text-[#4285F4]" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-lg font-bold tracking-tight font-['Google_Sans',sans-serif]">
                  {t.appName}
                </h1>
                <span className="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded-[6px] ai-rainbow-gradient text-white shadow-sm">
                  {t.appYear}
                </span>
              </div>
              <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {activeTab === 'scan'
                  ? t.headerScanSubtitle
                  : activeTab === 'inventory'
                  ? t.headerInventorySubtitle
                  : activeTab === 'alerts'
                  ? t.alertsTab
                  : activeTab === 'orders'
                  ? t.ordersTab
                  : t.headerSenpaiSubtitle}
              </p>
            </div>
          </div>

          {/* Right Header Actions: Language Chips + Theme Toggle */}
          <div className="flex items-center gap-2">
            {/* Unified Small Language Chips: EN / HI / KN */}
            <div className={`flex items-center rounded-full p-0.5 border ${isDark ? 'bg-black/30 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
              {(['EN', 'HI', 'KN'] as AppLanguage[]).map((lang) => {
                const isSelected = currentLang === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'ai-rainbow-gradient text-white shadow-sm'
                        : isDark
                        ? 'text-slate-400 hover:text-white'
                        : 'text-slate-600 hover:text-black'
                    }`}
                    title={`Switch language to ${lang}`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>

            {/* Theme Toggle (Dark / Light) */}
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className={`w-9 h-9 rounded-[12px] flex items-center justify-center transition-all cursor-pointer border ${
                isDark
                  ? 'bg-white/[0.06] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.12]'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
              title={isDark ? t.switchThemeLight : t.switchThemeDark}
              aria-label="Toggle Theme"
            >
              {isDark ? <Sun className="w-4 h-4 text-[#FBBC04]" /> : <Moon className="w-4 h-4 text-[#4285F4]" />}
            </button>
          </div>
        </header>

        {/* ============================================================= */}
        {/* TAB 1: SCAN SCREEN (HOME)                                     */}
        {/* ============================================================= */}
        {activeTab === 'scan' && (
          <div className="flex-1 flex flex-col justify-between h-full overflow-hidden">
            {/* VIEW A: CAMERA VIEWFINDER & BANKAI BRIEFING */}
            {isCameraActive && (
              <div className="flex-1 flex flex-col justify-between h-full overflow-y-auto">
                {/* BANKAI — TODAY CARD (Open alerts & pending tasks briefing) */}
                <div className="w-full flex-shrink-0">
                  <BankaiTodayCard
                    isDark={isDark}
                    materials={materials}
                    onNavigateToInventory={(filter) => {
                      setActiveTab('inventory');
                      if (filter) setStatusFilter(filter);
                    }}
                    onNavigateToScan={(item) => {
                      setActiveTab('scan');
                      setIsCameraActive(true);
                      setIsCardFlipped(false);
                      if (item) triggerNotice(`${t.toastTargeting} ${item}`);
                    }}
                    onNavigateToSenpai={(prompt) => {
                      setActiveTab('senpai');
                      if (prompt) setSenpaiInitialPrompt(prompt);
                    }}
                  />
                </div>

                {/* Mode Selector Chips: Frosted Glass */}
                <div
                  className={`px-4 py-2.5 flex items-center justify-center gap-2 border-b transition-colors ${
                    isDark ? 'bg-black/20 border-white/5' : 'bg-slate-50/50 border-slate-200/50'
                  }`}
                >
                  {(
                    [
                      { id: 'document', label: t.modeMaterialLabel, icon: Tag },
                      { id: 'photo', label: t.modeProductBox, icon: Camera },
                      { id: 'id_card', label: t.modeBatchTag, icon: Hash },
                    ] as const
                  ).map((mode) => {
                    const isSelected = selectedMode === mode.id;
                    const IconComponent = mode.icon;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setSelectedMode(mode.id)}
                        className={`h-9 px-3.5 rounded-[20px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                          isSelected
                            ? 'ai-rainbow-gradient text-white border-transparent shadow-[0_4px_16px_rgba(66,133,244,0.35)]'
                            : isDark
                            ? 'bg-white/[0.05] border-white/10 text-slate-300 hover:bg-white/[0.1]'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>

                {/* Viewfinder: Signature Rainbow Reticle & Dark Lens */}
                <div className="flex-1 px-4 py-2 flex flex-col justify-center">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={handleOpenDeviceCamera}
                    className="relative w-full aspect-[3/4] max-h-[400px] mx-auto rounded-[24px] overflow-hidden bg-gradient-to-b from-[#0f121a] to-[#07080c] text-white flex flex-col items-center justify-between p-4 cursor-pointer shadow-2xl transition-all group border border-white/10 hover:border-white/20"
                  >
                    {/* Viewfinder Grid */}
                    {showGrid && (
                      <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-15">
                        <div className="border-r border-b border-white"></div>
                        <div className="border-r border-b border-white"></div>
                        <div className="border-b border-white"></div>
                        <div className="border-r border-b border-white"></div>
                        <div className="border-r border-b border-white"></div>
                        <div className="border-b border-white"></div>
                        <div className="border-r border-white"></div>
                        <div className="border-r border-white"></div>
                        <div></div>
                      </div>
                    )}

                    {/* SIGNATURE RAINBOW RETICLE BRACKETS */}
                    <div className="absolute inset-5 pointer-events-none">
                      {/* Top-Left */}
                      <div className="absolute top-0 left-0 w-8 h-8 rounded-tl-[10px] border-t-[3.5px] border-l-[3.5px] border-[#4285F4] drop-shadow-[0_0_8px_rgba(66,133,244,0.7)]" />
                      {/* Top-Right */}
                      <div className="absolute top-0 right-0 w-8 h-8 rounded-tr-[10px] border-t-[3.5px] border-r-[3.5px] border-[#EA4335] drop-shadow-[0_0_8px_rgba(234,67,53,0.7)]" />
                      {/* Bottom-Left */}
                      <div className="absolute bottom-0 left-0 w-8 h-8 rounded-bl-[10px] border-b-[3.5px] border-l-[3.5px] border-[#34A853] drop-shadow-[0_0_8px_rgba(52,168,83,0.7)]" />
                      {/* Bottom-Right */}
                      <div className="absolute bottom-0 right-0 w-8 h-8 rounded-br-[10px] border-b-[3.5px] border-r-[3.5px] border-[#FBBC04] drop-shadow-[0_0_8px_rgba(251,188,4,0.7)]" />
                    </div>

                    {/* Top status bar in lens */}
                    <div className="w-full flex items-center justify-between z-10">
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white/90 border border-white/15 flex items-center gap-1.5 shadow-lg">
                        <span className="w-2 h-2 rounded-full bg-[#34A853] animate-pulse"></span>
                        {currentLang === 'KN' ? 'ಜೆಮಿನಿ ಲೆನ್ಸ್ ಸಕ್ರಿಯವಾಗಿದೆ' : currentLang === 'HI' ? 'जेमिनी लेंस सक्रिय' : 'Gemini Lens Active'}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowGrid(!showGrid);
                        }}
                        className="p-1.5 rounded-full bg-black/40 text-white/80 hover:text-white border border-white/10"
                        title={t.grid}
                      >
                        <Grid className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Center prompt */}
                    <div className="z-10 text-center flex flex-col items-center px-4">
                      <div className="w-16 h-16 rounded-full ai-rainbow-gradient p-[2px] shadow-[0_0_24px_rgba(66,133,244,0.4)] mb-3 group-hover:scale-105 transition-transform">
                        <div className="w-full h-full rounded-full bg-black/75 backdrop-blur-md flex items-center justify-center">
                          <Camera className="w-7 h-7 text-white" />
                        </div>
                      </div>
                      <p className="text-sm font-bold text-white drop-shadow">
                        {t.tapToCapture}
                      </p>
                      <p className="text-xs text-slate-300 mt-1 max-w-[220px]">
                        {t.alignWithinFrame}
                      </p>
                    </div>

                    {/* Bottom pill in lens */}
                    <div className="z-10 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/15 text-[11px] font-medium text-white/90 flex items-center gap-2 shadow-lg">
                      <Sparkles className="w-3.5 h-3.5 text-[#FBBC04]" />
                      <span>{t.flipToDetails}</span>
                    </div>
                  </div>
                </div>

                {/* Quick samples bar: Frosted glass chips */}
                <div className="px-4 py-2">
                  <div className="flex items-center justify-between text-[11px] font-medium mb-1.5">
                    <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>
                      {t.samplePhotosTitle}:
                    </span>
                    <span className="text-[#4285F4] font-semibold">{t.dragDropPrompt}</span>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {SAMPLE_PHOTOS.map((sample, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleLoadSample(sample)}
                        className={`flex-shrink-0 text-left rounded-[16px] px-2.5 py-1.5 transition-all flex items-center gap-2 border cursor-pointer ${
                          isDark
                            ? 'bg-white/[0.05] border-white/10 hover:border-[#4285F4]/60 hover:bg-white/[0.08]'
                            : 'bg-white border-slate-200 hover:border-[#4285F4] hover:bg-slate-50'
                        }`}
                      >
                        <img
                          src={sample.url}
                          alt={sample.name}
                          className="w-7 h-7 rounded-[8px] object-cover"
                        />
                        <div>
                          <div
                            className={`text-[11px] font-bold truncate max-w-[100px] ${
                              isDark ? 'text-white' : 'text-slate-800'
                            }`}
                          >
                            {sample.mock.name}
                          </div>
                          <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                            {sample.type}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bottom Capture Deck: Frosted Glass with Rainbow Shutter */}
                <div
                  className={`px-6 pt-3 pb-4 flex items-center justify-between border-t transition-colors ${
                    isDark ? 'bg-[#10131b]/90 border-white/10' : 'bg-white/90 border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={handleOpenGallery}
                    className={`min-h-[56px] min-w-[56px] h-14 w-14 rounded-[20px] flex flex-col items-center justify-center transition-all cursor-pointer border ${
                      isDark
                        ? 'bg-white/[0.05] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.1]'
                        : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                    }`}
                    title={t.uploadImage}
                  >
                    <ImageIcon className="w-5 h-5" />
                    <span className="text-[9px] font-semibold mt-0.5">{t.uploadImage}</span>
                  </button>

                  {/* Primary Circular Capture Button with Rainbow Glow */}
                  <div className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={handleOpenDeviceCamera}
                      className="group relative min-w-[78px] min-h-[78px] w-[78px] h-[78px] rounded-full p-[2.5px] ai-rainbow-gradient flex items-center justify-center transition-all transform active:scale-90 shadow-[0_0_28px_rgba(66,133,244,0.45)] cursor-pointer"
                      title={t.scanTab}
                    >
                      <span className="relative w-full h-full rounded-full bg-[#0b0d12] flex items-center justify-center text-white transition-all group-hover:bg-[#161a24]">
                        <Camera className="w-7 h-7 text-white drop-shadow" />
                      </span>
                    </button>
                    <span className="text-[11px] font-bold text-[#4285F4] mt-1 font-['Google_Sans',sans-serif]">
                      {t.scanTab}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    className={`min-h-[56px] min-w-[56px] h-14 w-14 rounded-[20px] flex flex-col items-center justify-center transition-all relative cursor-pointer border ${
                      isDark
                        ? 'bg-white/[0.05] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.1]'
                        : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                    }`}
                    title={t.inventoryTab}
                  >
                    <Package className="w-5 h-5" />
                    <span className="text-[9px] font-semibold mt-0.5">{t.inventoryTab}</span>
                    {materials.length > 0 && (
                      <span className="absolute -top-1 -right-1 ai-rainbow-gradient text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold shadow-md">
                        {materials.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ========================================================= */}
            {/* VIEW B: SIGNATURE TWO-SIDED 3D CARD FLIP (FRONT & BACK)   */}
            {/* ========================================================= */}
            {!isCameraActive && capturedPhoto && (
              <div className="flex-1 flex flex-col justify-between h-full overflow-hidden">
                <header
                  className={`h-14 px-4 flex items-center justify-between border-b flex-shrink-0 transition-colors ${
                    isDark ? 'bg-[#10131b]/60 border-white/10' : 'bg-white/60 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCameraActive(true);
                        setIsCardFlipped(false);
                      }}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label="Back to camera"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                      <h2 className="text-sm font-bold tracking-tight font-['Google_Sans',sans-serif]">
                        {isCardFlipped ? 'Extracted Material Result' : 'Captured Photo Preview'}
                      </h2>
                      <p className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {isCardFlipped
                          ? 'Back face: Firestore & Gemini data'
                          : 'Front face: Ready to flip 3D on Use photo'}
                      </p>
                    </div>
                  </div>

                  {!isCardFlipped && (
                    <button
                      type="button"
                      onClick={() => setRotation((prev) => (prev + 90) % 360)}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title="Rotate 90°"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>
                  )}
                </header>

                {/* 3D FLIP CONTAINER (perspective ~1200px) */}
                <div className="flex-1 px-4 py-3 flex flex-col items-center justify-center overflow-y-auto perspective-1200">
                  <div
                    className={`relative w-full max-w-[390px] h-[460px] rounded-[28px] card-flip-flipper ${
                      isCardFlipped ? 'is-flipped' : ''
                    }`}
                  >
                    {/* SHEEN HIGHLIGHT OVERLAY (Diagonal sheen sweep during flip) */}
                    {isSheenActive && (
                      <div className="absolute inset-0 z-50 pointer-events-none rounded-[28px] overflow-hidden">
                        <div
                          className="w-[200%] h-[200%] halo-sheen-active"
                          style={{
                            background:
                              'linear-gradient(110deg, transparent 20%, rgba(255,255,255,0.7) 48%, rgba(66,133,244,0.5) 52%, transparent 75%)',
                          }}
                        />
                      </div>
                    )}

                    {/* ------------------------------------------------------- */}
                    {/* FRONT FACE OF CARD: THE CAPTURED PHOTO                   */}
                    {/* ------------------------------------------------------- */}
                    <div
                      className={`card-face-front rounded-[28px] overflow-hidden border p-3 flex flex-col justify-between shadow-[0_20px_50px_rgba(0,0,0,0.5)] ${
                        isDark
                          ? 'bg-[#121622]/90 border-white/15 backdrop-blur-2xl'
                          : 'bg-white/95 border-slate-200 backdrop-blur-2xl'
                      }`}
                    >
                      <div className="relative w-full h-[320px] rounded-[20px] overflow-hidden bg-black/40 shadow-inner">
                        <img
                          src={capturedPhoto.dataUrl}
                          alt="Captured photo front"
                          style={{ transform: `rotate(${rotation}deg)` }}
                          className="w-full h-full object-cover"
                        />

                        {/* Glossy Front Details Pill */}
                        <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md text-white text-[11px] font-semibold px-3 py-1 rounded-full border border-white/20 flex items-center gap-2 shadow-lg">
                          <span className="w-2 h-2 rounded-full bg-[#4285F4] animate-pulse"></span>
                          <span>{capturedPhoto.sizeFormatted}</span>
                          <span className="text-white/40">•</span>
                          <span>Front Face</span>
                        </div>
                      </div>

                      {/* Shelf life selector */}
                      <div
                        className={`p-2.5 rounded-[18px] border flex items-center justify-between text-xs mt-2 ${
                          isDark ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <span className="font-semibold flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#4285F4]" />
                          Shelf Life:
                        </span>
                        <div className="flex gap-1.5">
                          {[30, 90, 180].map((days) => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => setShelfLifeDays(days)}
                              className={`px-2.5 py-1 rounded-[12px] text-[11px] font-bold transition-all cursor-pointer ${
                                shelfLifeDays === days
                                  ? 'ai-rainbow-gradient text-white shadow-sm'
                                  : isDark
                                  ? 'bg-white/[0.06] text-slate-400'
                                  : 'bg-white text-slate-600 border border-slate-200'
                              }`}
                            >
                              {days}d
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ------------------------------------------------------- */}
                    {/* BACK FACE OF CARD: EXTRACTED DATA RESULT CARD            */}
                    {/* ------------------------------------------------------- */}
                    <div
                      className={`card-face-back rounded-[28px] overflow-hidden border p-4 flex flex-col justify-between shadow-[0_20px_50px_rgba(0,0,0,0.6)] ${
                        isDark
                          ? 'bg-[#121622]/95 border-white/15 backdrop-blur-2xl text-white'
                          : 'bg-white/95 border-slate-200 backdrop-blur-2xl text-[#1f2733]'
                      }`}
                    >
                      {/* Top banner of back face: Morph thumbnail + Status chip */}
                      <div className="flex items-center justify-between pb-3 border-b border-white/10">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={capturedPhoto.dataUrl}
                            alt="Morphed scan thumb"
                            className="w-12 h-12 rounded-[14px] object-cover border border-white/20 shadow-md"
                          />
                          <div>
                            <span className="text-[10px] uppercase font-bold tracking-wider ai-rainbow-text">
                              Gemini 3.8 Flash Vision
                            </span>
                            <h3 className="text-xs font-bold leading-tight line-clamp-1">
                              {extractedData?.name || 'Reading label...'}
                            </h3>
                          </div>
                        </div>

                        {/* STAMP BOUNCE STATUS CHIP (stamps in after flip!) */}
                        {!isGeminiLoading && extractedData?.name !== 'No label detected' && (
                          <div className="stamp-bounce-in">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-[#34A853]/15 text-[#34A853] border border-[#34A853]/40 shadow-md">
                              <span className="w-2 h-2 rounded-full bg-[#34A853]"></span>
                              <span>ok</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Content Area of Back Face */}
                      <div className="flex-1 py-3 flex flex-col justify-center overflow-y-auto">
                        {isGeminiLoading ? (
                          /* Skeleton shimmer while reading */
                          <div className="space-y-3">
                            <div className="h-4 w-28 rounded-[8px] bg-white/10 skeleton-shimmer-sweep relative overflow-hidden" />
                            <div className="h-7 w-3/4 rounded-[12px] bg-white/10 skeleton-shimmer-sweep relative overflow-hidden" />
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <div className="h-14 rounded-[16px] bg-white/10 skeleton-shimmer-sweep relative overflow-hidden" />
                              <div className="h-14 rounded-[16px] bg-white/10 skeleton-shimmer-sweep relative overflow-hidden" />
                            </div>
                            <div className="h-10 rounded-[14px] bg-white/10 skeleton-shimmer-sweep relative overflow-hidden" />
                          </div>
                        ) : extractedData?.name === 'No label detected' ? (
                          /* No label detected state */
                          <div className="p-4 rounded-[20px] bg-[#EA4335]/15 border border-[#EA4335]/30 text-center space-y-2 cascade-field-1">
                            <div className="w-10 h-10 rounded-full bg-[#EA4335]/25 text-[#EA4335] flex items-center justify-center mx-auto">
                              <AlertTriangle className="w-5 h-5" />
                            </div>
                            <h4 className="text-sm font-bold text-[#EA4335]">
                              No label detected
                            </h4>
                            <p className="text-xs text-slate-300">
                              Image is not recognized as a printed product/material label. Confidence: 0
                            </p>
                          </div>
                        ) : (
                          /* Extracted Data cascading in */
                          <div className="space-y-2.5">
                            {/* Cascade 1: Category & Name */}
                            <div className="cascade-field-1">
                              {extractedData?.category && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full ai-rainbow-gradient text-white shadow-sm mb-1">
                                  <Tag className="w-3 h-3" />
                                  {extractedData.category}
                                </span>
                              )}
                              <h3 className="text-base font-extrabold leading-snug line-clamp-2">
                                {extractedData?.name}
                              </h3>
                            </div>

                            {/* Cascade 2: Batch & Quantity */}
                            <div className="grid grid-cols-2 gap-2 cascade-field-2">
                              <div
                                className={`p-2.5 rounded-[16px] border ${
                                  isDark ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'
                                }`}
                              >
                                <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                                  <Hash className="w-3 h-3 text-[#4285F4]" /> Batch / LOT:
                                </span>
                                <span className="text-xs font-bold block truncate mt-0.5">
                                  {extractedData?.batchNo || '—'}
                                </span>
                              </div>

                              <div
                                className={`p-2.5 rounded-[16px] border ${
                                  isDark ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'
                                }`}
                              >
                                <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                                  <Layers className="w-3 h-3 text-[#34A853]" /> Quantity:
                                </span>
                                <span className="text-xs font-bold text-[#4285F4] block truncate mt-0.5">
                                  {extractedData?.quantity !== null
                                    ? `${extractedData?.quantity} ${extractedData?.unit || ''}`.trim()
                                    : '—'}
                                </span>
                              </div>
                            </div>

                            {/* Cascade 3: Dates */}
                            <div
                              className={`p-2.5 rounded-[16px] border space-y-1.5 text-xs cascade-field-3 ${
                                isDark ? 'bg-white/[0.04] border-white/10' : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-400 flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Purchased:
                                </span>
                                <span className="font-semibold">{extractedData?.purchaseDate || '—'}</span>
                              </div>

                              {extractedData?.purchaseDate && (
                                <div className="flex justify-between items-center pt-1 border-t border-white/10 text-[11px]">
                                  <span className="text-slate-400 flex items-center gap-1 font-medium">
                                    <Clock className="w-3.5 h-3.5 text-[#4285F4]" /> Expires:
                                  </span>
                                  <span className="font-extrabold text-[#34A853] bg-[#34A853]/15 px-2 py-0.5 rounded-[8px] border border-[#34A853]/30">
                                    {calculateExpiryDate(extractedData?.purchaseDate, shelfLifeDays) || '—'}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Cascade 4: Verification Score */}
                            <div className="cascade-field-4 p-2 rounded-[14px] bg-[#4285F4]/15 border border-[#4285F4]/30 flex items-center justify-between text-xs">
                              <span className="text-[#4285F4] font-semibold flex items-center gap-1.5">
                                <ShieldCheck className="w-4 h-4" />
                                Label Verified
                              </span>
                              <span className="text-xs font-bold text-[#4285F4]">
                                Confidence: {((extractedData?.confidence || 0) * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Back Card Bottom Actions */}
                      <div className="pt-2 border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => setActiveTab('inventory')}
                          className="w-full h-11 rounded-[16px] ai-rainbow-gradient text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-transform cursor-pointer"
                        >
                          <Package className="w-4 h-4" />
                          <span>View in Inventory</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BOTTOM ACTION BAR */}
                <div
                  className={`px-4 py-4 border-t flex-shrink-0 transition-colors ${
                    isDark ? 'bg-[#10131b]/95 border-white/10' : 'bg-white/95 border-slate-200'
                  }`}
                >
                  {!isCardFlipped ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={handleRetake}
                        className={`min-h-[56px] h-14 w-full rounded-[20px] font-semibold text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                          isDark
                            ? 'bg-white/[0.05] border-white/15 text-slate-200 hover:bg-white/10'
                            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Retake</span>
                      </button>

                      {/* "Use photo" button with signature rainbow gradient & 3D flip trigger */}
                      <button
                        type="button"
                        onClick={handleUsePhoto}
                        className="min-h-[56px] h-14 w-full rounded-[20px] ai-rainbow-gradient ai-rainbow-gradient-hover text-white font-['Google_Sans',sans-serif] font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-[0_4px_24px_rgba(66,133,244,0.4)] cursor-pointer"
                      >
                        <Check className="w-5 h-5 stroke-[2.5]" />
                        <span>Use photo (3D Flip)</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCapturedPhoto(null);
                          setExtractedData(null);
                          setIsCameraActive(true);
                          setIsCardFlipped(false);
                        }}
                        className={`min-h-[56px] h-14 w-full rounded-[20px] font-bold text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                          isDark
                            ? 'bg-white/[0.06] border-white/15 text-white hover:bg-white/10'
                            : 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                        }`}
                      >
                        <ScanLine className="w-4 h-4 text-[#4285F4]" />
                        <span>Scan Another Material</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 2: INVENTORY SCREEN                                       */}
        {/* ============================================================= */}
        {activeTab === 'inventory' && (
          <div className="flex-1 flex flex-col justify-between h-full overflow-hidden">
            {/* Search Field on Top: Frosted Glass */}
            <div
              className={`px-4 pt-3 pb-2.5 border-b flex-shrink-0 transition-colors ${
                isDark ? 'bg-black/20 border-white/10' : 'bg-slate-50/60 border-slate-200'
              }`}
            >
              <div className="relative flex items-center">
                <Search className="w-5 h-5 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search materials, batch #, category..."
                  className={`w-full h-12 pl-11 pr-10 rounded-[20px] text-sm placeholder-slate-400 border transition-all ${
                    isDark
                      ? 'bg-white/[0.06] border-white/10 focus:border-[#4285F4] focus:bg-[#161a26] text-white'
                      : 'bg-white border-slate-200 focus:border-[#4285F4] text-slate-900'
                  }`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="w-8 h-8 rounded-full hover:bg-white/10 absolute right-2 flex items-center justify-center text-slate-400"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Status Filter Chips: Green #34A853, Amber #FBBC04, Red #EA4335 */}
              <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 no-scrollbar text-xs">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`h-8 px-3 rounded-[16px] font-bold transition-all flex items-center gap-1 cursor-pointer border ${
                    statusFilter === 'all'
                      ? 'ai-rainbow-gradient text-white border-transparent shadow-md'
                      : isDark
                      ? 'bg-white/[0.05] border-white/10 text-slate-300 hover:bg-white/10'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All ({statusCounts.all})
                </button>

                {/* OK: #34A853 */}
                <button
                  type="button"
                  onClick={() => setStatusFilter('ok')}
                  className={`h-8 px-3 rounded-[16px] font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                    statusFilter === 'ok'
                      ? 'bg-[#34A853] text-white border-transparent shadow-md'
                      : 'bg-[#34A853]/10 text-[#34A853] border-[#34A853]/30 hover:bg-[#34A853]/20'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusFilter === 'ok' ? 'bg-white' : 'bg-[#34A853]'}`} />
                  <span>OK ({statusCounts.ok})</span>
                </button>

                {/* Expiring: #FBBC04 / #f29900 */}
                <button
                  type="button"
                  onClick={() => setStatusFilter('expiring')}
                  className={`h-8 px-3 rounded-[16px] font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                    statusFilter === 'expiring'
                      ? 'bg-[#f29900] text-white border-transparent shadow-md'
                      : 'bg-[#f29900]/10 text-[#f29900] border-[#f29900]/30 hover:bg-[#f29900]/20'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusFilter === 'expiring' ? 'bg-white' : 'bg-[#f29900]'}`} />
                  <span>Expiring ({statusCounts.expiring})</span>
                </button>

                {/* Expired: #EA4335 */}
                <button
                  type="button"
                  onClick={() => setStatusFilter('expired')}
                  className={`h-8 px-3 rounded-[16px] font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                    statusFilter === 'expired'
                      ? 'bg-[#EA4335] text-white border-transparent shadow-md'
                      : 'bg-[#EA4335]/10 text-[#EA4335] border-[#EA4335]/30 hover:bg-[#EA4335]/20'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusFilter === 'expired' ? 'bg-white' : 'bg-[#EA4335]'}`} />
                  <span>Expired ({statusCounts.expired})</span>
                </button>
              </div>
            </div>

            {/* Material Cards List: Frosted Glass floating panels */}
            <div className="flex-1 px-4 py-3 overflow-y-auto space-y-3">
              {isLoadingMaterials && (
                <div className="space-y-3 pt-2">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className={`p-4 rounded-[20px] border space-y-2.5 animate-pulse ${
                        isDark ? 'bg-white/[0.04] border-white/10' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="h-5 w-44 rounded-[8px] bg-white/10" />
                        <div className="h-6 w-16 rounded-full bg-white/10" />
                      </div>
                      <div className="h-3 w-28 rounded-[6px] bg-white/10" />
                      <div className="flex justify-between pt-1">
                        <div className="h-3 w-20 rounded-[6px] bg-white/10" />
                        <div className="h-3 w-24 rounded-[6px] bg-white/10" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!isLoadingMaterials && filteredMaterials.length === 0 && (
                <div
                  className={`text-center py-12 px-4 rounded-[24px] border my-4 shadow-xl ${
                    isDark ? 'bg-white/[0.03] border-white/10' : 'bg-white/80 border-slate-200'
                  }`}
                >
                  <div className="w-16 h-16 rounded-full ai-rainbow-gradient p-[2px] mx-auto mb-3 shadow-lg">
                    <div
                      className={`w-full h-full rounded-full flex items-center justify-center ${
                        isDark ? 'bg-[#0f121a]' : 'bg-white'
                      }`}
                    >
                      <Package className="w-7 h-7 text-[#4285F4]" />
                    </div>
                  </div>
                  <h3 className="text-base font-bold mb-1 font-['Google_Sans',sans-serif]">
                    {searchQuery ? t.emptySearchTitle : t.emptyInventoryTitle}
                  </h3>
                  <p className={`text-xs mb-4 max-w-[260px] mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {searchQuery ? t.emptySearchSubtitle : t.emptyInventorySubtitle}
                  </p>

                  <div className="flex flex-col gap-2 max-w-[240px] mx-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('scan');
                        setIsCameraActive(true);
                        setIsCardFlipped(false);
                      }}
                      className="h-12 w-full rounded-[20px] ai-rainbow-gradient text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>{t.scanTab}</span>
                    </button>

                    {!searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          SAMPLE_PHOTOS.filter((s) => s.mock.name !== 'No label detected').forEach((s) => {
                            saveMaterialToFirestore(s.mock, s.shelfLifeDays);
                          });
                          triggerNotice(t.toastSaved);
                        }}
                        className={`h-10 w-full rounded-[20px] text-xs font-medium border cursor-pointer ${
                          isDark
                            ? 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {currentLang === 'KN' ? 'ಡೆಮೊ ವಸ್ತುಗಳನ್ನು ಸೇರಿಸಿ' : currentLang === 'HI' ? 'डेमो सामग्री जोड़ें' : 'Seed Demo Materials'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Material Cards: Frosted Glass Panels (20px corners, faint glowing border) */}
              {!isLoadingMaterials &&
                filteredMaterials.map((item) => {
                  const dynamicStatus = computeMaterialStatus(item.expiryDate);

                  let chipClasses = 'bg-[#34A853]/15 text-[#34A853] border-[#34A853]/40';
                  let chipLabel = t.statusOk;
                  let chipDot = 'bg-[#34A853]';

                  if (dynamicStatus === 'expiring') {
                    chipClasses = 'bg-[#f29900]/15 text-[#f29900] border-[#f29900]/40';
                    chipLabel = t.statusExpiring;
                    chipDot = 'bg-[#f29900]';
                  } else if (dynamicStatus === 'expired') {
                    chipClasses = 'bg-[#EA4335]/15 text-[#EA4335] border-[#EA4335]/40';
                    chipLabel = t.statusExpired;
                    chipDot = 'bg-[#EA4335]';
                  }

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedMaterialForDetails(item)}
                      className={`p-4 rounded-[20px] border transition-all space-y-2 relative shadow-lg hover:shadow-xl cursor-pointer ${
                        isDark
                          ? 'bg-[#131622]/75 border-white/10 hover:border-[#4285F4]/40 hover:bg-[#151928]'
                          : 'bg-white/80 border-slate-200 hover:border-[#4285F4]/40 hover:bg-white'
                      }`}
                    >
                      {/* Top Row: Name and Status Chip */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-extrabold leading-snug line-clamp-1 font-['Google_Sans',sans-serif]">
                            {item.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[11px] truncate max-w-[160px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                              {item.category || t.category}
                            </span>
                          </div>
                        </div>

                        {/* Status Chip */}
                        <div
                          className={`flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-extrabold border capitalize ${chipClasses}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${chipDot}`} />
                          <span>{chipLabel}</span>
                        </div>
                      </div>

                      {/* Middle Attributes: Batch, Quantity */}
                      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                        <div
                          className={`px-3 py-2 rounded-[14px] border ${
                            isDark ? 'bg-white/[0.03] border-white/5' : 'bg-slate-50 border-slate-100'
                          }`}
                        >
                          <span className="text-[10px] text-slate-400 block font-medium">{t.batchNo}:</span>
                          <span className="font-bold truncate block mt-0.5 font-mono text-[#4285F4]">
                            {item.batchNo ? item.batchNo : '—'}
                          </span>
                        </div>

                        <div
                          className={`px-3 py-2 rounded-[14px] border ${
                            isDark ? 'bg-white/[0.03] border-white/5' : 'bg-slate-50 border-slate-100'
                          }`}
                        >
                          <span className="text-[10px] text-slate-400 block font-medium">{t.quantity}:</span>
                          <span className="font-extrabold text-[#34A853] block mt-0.5">
                            {item.quantity !== null ? `${item.quantity} ${item.unit || ''}`.trim() : '—'}
                          </span>
                        </div>
                      </div>

                      {/* Stock thresholds & reorder actions */}
                      <div className="flex items-center justify-between gap-1.5 pt-1 text-[11px]">
                        {typeof item.minThreshold === 'number' ? (
                          <span
                            className={`px-2 py-0.5 rounded-[8px] border ${
                              isDark ? 'bg-white/[0.03] border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'
                            }`}
                          >
                            Min: <strong className={isDark ? 'text-white' : 'text-slate-900'}>{item.minThreshold} {item.unit || ''}</strong>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMaterialForSettings(item);
                            }}
                            className="px-2 py-0.5 rounded-[8px] bg-[#FBBC05]/15 hover:bg-[#FBBC05]/25 text-[#FBBC05] border border-[#FBBC05]/30 font-bold flex items-center gap-1 transition-all cursor-pointer"
                            title="Click to set minimum threshold"
                          >
                            <Sliders className="w-3 h-3" />
                            <span>Min threshold needed</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMaterialForSettings(item);
                            }}
                            className={`h-7 px-2.5 rounded-[10px] text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer border ${
                              isDark
                                ? 'bg-white/[0.04] hover:bg-white/10 text-slate-300 border-white/10'
                                : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                            title="Configure safety thresholds & suppliers"
                          >
                            <Sliders className="w-3 h-3" />
                            <span>{t.stockSettings}</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMaterialForDraft(item);
                              setDraftOrderType('reorder');
                            }}
                            className="h-7 px-2.5 rounded-[10px] bg-[#9B72CB]/15 hover:bg-[#9B72CB]/25 text-[#9B72CB] text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer border border-[#9B72CB]/30"
                            title="Create Draft Purchase Order"
                          >
                            <ShoppingCart className="w-3 h-3" />
                            <span>{t.draftPo}</span>
                          </button>
                        </div>
                      </div>

                      {/* Dates, Batch History Action & Delete */}
                      <div className="flex items-center justify-between pt-1 text-[11px]">
                        <span className={`flex items-center gap-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          <Calendar className="w-3.5 h-3.5" />
                          {item.purchaseDate || '—'}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMaterialForDetails(item);
                          }}
                          className="h-7 px-2.5 rounded-[10px] bg-[#4285F4]/15 hover:bg-[#4285F4]/25 text-[#4285F4] text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer border border-[#4285F4]/30"
                        >
                          <History className="w-3 h-3" />
                          <span>{t.viewBatchHistory}</span>
                        </button>

                        {item.id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMaterial(item.id!, e);
                            }}
                            disabled={deletingId === item.id}
                            className="p-1 rounded-full text-slate-400 hover:text-[#EA4335] hover:bg-[#EA4335]/10 transition-colors cursor-pointer"
                            title={t.deleteItem}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Bottom Bar: Frosted Glass */}
            <div
              className={`px-4 py-3 flex items-center justify-between border-t flex-shrink-0 transition-colors ${
                isDark ? 'bg-[#10131b]/95 border-white/10' : 'bg-white/95 border-slate-200'
              }`}
            >
              <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                {currentLang === 'KN' ? (
                  <>ಒಟ್ಟು {materials.length} ರಲ್ಲಿ <span className="font-bold">{filteredMaterials.length}</span> ಸಾಮಗ್ರಿಗಳು</>
                ) : currentLang === 'HI' ? (
                  <>{materials.length} में से <span className="font-bold">{filteredMaterials.length}</span> सामग्री प्रदर्शित</>
                ) : (
                  <>Showing <span className="font-bold">{filteredMaterials.length}</span> of {materials.length} items</>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('scan');
                  setIsCameraActive(true);
                  setIsCardFlipped(false);
                }}
                className="min-h-[56px] h-14 px-5 rounded-[20px] ai-rainbow-gradient text-white font-['Google_Sans',sans-serif] font-bold text-xs flex items-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>{currentLang === 'KN' ? 'ಇನ್ನೊಂದನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ' : currentLang === 'HI' ? 'अन्य स्कैन करें' : 'Scan Another'}</span>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* INVENTORY ALERTS SCREEN (predict-alerts)                      */}
        {/* ============================================================= */}
        {activeTab === 'alerts' && (
          <AlertsScreen
            alerts={alerts}
            materials={materials}
            isLoading={isLoadingAlerts}
            onRefreshAlerts={() => recomputeAllAlerts(materials, getCachedOrders())}
            onDraftReorder={(mat, type) => {
              setSelectedMaterialForDraft(mat);
              setDraftOrderType(type);
            }}
            onOpenSettings={(mat) => setSelectedMaterialForSettings(mat)}
            onViewOrder={(_orderId) => setActiveTab('orders')}
          />
        )}

        {/* ============================================================= */}
        {/* PURCHASE ORDERS SCREEN (draft-reorder)                        */}
        {/* ============================================================= */}
        {activeTab === 'orders' && (
          <OrdersScreen
            orders={orders}
            materials={materials}
            isLoading={isLoadingOrders}
            onOpenDraftModal={(mat) => {
              setSelectedMaterialForDraft(mat);
              setDraftOrderType('reorder');
            }}
            triggerNotice={triggerNotice}
            onOrderUpdated={() => recomputeAllAlerts(materials, getCachedOrders())}
          />
        )}

        {/* ============================================================= */}
        {/* TAB 3: SENPAI VOICE AGENT SCREEN                              */}
        {/* ============================================================= */}
        {activeTab === 'senpai' && (
          <SenpaiScreen
            isDark={isDark}
            materials={materials}
            initialPrompt={senpaiInitialPrompt}
            onNavigateToScan={(presetItem) => {
              setActiveTab('scan');
              setIsCameraActive(true);
              setIsCardFlipped(false);
              if (presetItem) triggerNotice(`Targeting material: ${presetItem}`);
            }}
            onNavigateToInventory={(filter) => {
              setActiveTab('inventory');
              if (filter) setStatusFilter(filter);
            }}
          />
        )}

        {/* ============================================================= */}
        {/* GLOBAL BOTTOM NAVIGATION (Frosted Glass)                      */}
        {/* ============================================================= */}
        <nav
          className={`h-16 border-t flex items-center justify-around px-1 z-20 flex-shrink-0 transition-colors ${
            isDark ? 'bg-[#10131b]/95 border-white/10' : 'bg-white/95 border-slate-200'
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('scan')}
            className={`min-h-[56px] flex-1 flex flex-col items-center justify-center transition-colors cursor-pointer ${
              activeTab === 'scan' ? 'text-[#4285F4]' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div
              className={`px-4 py-1 rounded-[16px] flex items-center justify-center transition-colors ${
                activeTab === 'scan' ? (isDark ? 'bg-[#4285F4]/15' : 'bg-[#4285F4]/10') : ''
              }`}
            >
              <Camera className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-bold mt-0.5">{t.scanTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`min-h-[56px] flex-1 flex flex-col items-center justify-center transition-colors relative cursor-pointer ${
              activeTab === 'inventory' ? 'text-[#4285F4]' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div
              className={`px-4 py-1 rounded-[16px] flex items-center justify-center transition-colors relative ${
                activeTab === 'inventory' ? (isDark ? 'bg-[#4285F4]/15' : 'bg-[#4285F4]/10') : ''
              }`}
            >
              <Package className="w-5 h-5" />
              {materials.length > 0 && (
                <span className="absolute -top-1 right-2 ai-rainbow-gradient text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-extrabold shadow-sm">
                  {materials.length}
                </span>
              )}
            </div>
            <span className="text-[11px] font-bold mt-0.5">{t.inventoryTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('alerts')}
            className={`min-h-[56px] flex-1 flex flex-col items-center justify-center transition-colors relative cursor-pointer ${
              activeTab === 'alerts' ? 'text-[#4285F4]' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div
              className={`px-4 py-1 rounded-[16px] flex items-center justify-center transition-colors relative ${
                activeTab === 'alerts' ? (isDark ? 'bg-[#4285F4]/15' : 'bg-[#4285F4]/10') : ''
              }`}
            >
              <AlertTriangle className="w-5 h-5" />
              {alerts.length > 0 && (
                <span className="absolute -top-1 right-2 ai-rainbow-gradient text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-extrabold shadow-sm">
                  {alerts.length}
                </span>
              )}
            </div>
            <span className="text-[11px] font-bold mt-0.5">{t.alertsTab}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`min-h-[56px] flex-1 flex flex-col items-center justify-center transition-colors relative cursor-pointer ${
              activeTab === 'orders' ? 'text-[#4285F4]' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div
              className={`px-4 py-1 rounded-[16px] flex items-center justify-center transition-colors relative ${
                activeTab === 'orders' ? (isDark ? 'bg-[#4285F4]/15' : 'bg-[#4285F4]/10') : ''
              }`}
            >
              <ClipboardList className="w-5 h-5" />
              {orders.filter((o) => o.status === 'pending_approval').length > 0 && (
                <span className="absolute -top-1 right-2 ai-rainbow-gradient text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-extrabold shadow-sm">
                  {orders.filter((o) => o.status === 'pending_approval').length}
                </span>
              )}
            </div>
            <span className="text-[11px] font-bold mt-0.5">{t.ordersTab}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSenpaiInitialPrompt(null);
              setActiveTab('senpai');
            }}
            className={`min-h-[56px] flex-1 flex flex-col items-center justify-center transition-colors relative cursor-pointer ${
              activeTab === 'senpai' ? 'text-[#9B72CB]' : isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div
              className={`px-4 py-1 rounded-[16px] flex items-center justify-center transition-colors relative ${
                activeTab === 'senpai' ? (isDark ? 'bg-[#9B72CB]/20' : 'bg-[#9B72CB]/10') : ''
              }`}
            >
              <Mic className="w-5 h-5 text-[#9B72CB]" />
              <span className="absolute -top-1 right-2 ai-rainbow-gradient text-white text-[8px] font-black px-1 rounded-full shadow-sm">
                AI
              </span>
            </div>
            <span className="text-[11px] font-bold mt-0.5">{t.senpaiTab}</span>
          </button>
        </nav>

        {/* ============================================================= */}
        {/* MATERIAL ITEM DETAILS & BATCH HISTORY MODAL                   */}
        {/* ============================================================= */}
        <MaterialDetailsModal
          material={selectedMaterialForDetails}
          isOpen={!!selectedMaterialForDetails}
          onClose={() => setSelectedMaterialForDetails(null)}
          isDark={isDark}
          onMaterialUpdated={() => {
            // Materials list will auto-update via onSnapshot subscription
          }}
        />

        {/* ============================================================= */}
        {/* MODALS: REORDER DRAFT & MATERIAL STOCK SETTINGS               */}
        {/* ============================================================= */}
        <DraftOrderModal
          isOpen={!!selectedMaterialForDraft}
          onClose={() => setSelectedMaterialForDraft(null)}
          material={selectedMaterialForDraft}
          orderType={draftOrderType}
          onOrderSaved={(_orderId) => {
            triggerNotice('Purchase Requisition saved with "pending_approval" status.');
            recomputeAllAlerts(materials, getCachedOrders());
            setActiveTab('orders');
          }}
        />

        <MaterialSettingsModal
          isOpen={!!selectedMaterialForSettings}
          onClose={() => setSelectedMaterialForSettings(null)}
          material={selectedMaterialForSettings}
          onSettingsSaved={() => {
            triggerNotice('Material stock settings updated.');
            recomputeAllAlerts(materials, getCachedOrders());
          }}
        />
      </div>
    </div>
  );
}
