import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Flame,
  Clock,
  Package,
  Layers,
  ArrowRight,
  Filter,
  CheckCircle2,
  RefreshCw,
  ShoppingCart,
  Sliders,
  Calendar,
  ShieldAlert,
  Eye,
  Truck,
  RotateCcw,
} from 'lucide-react';
import { InventoryAlert, AlertType, AlertSeverity } from '../services/alertService';
import { MaterialItem } from '../services/materialService';

interface AlertsScreenProps {
  alerts: InventoryAlert[];
  materials: MaterialItem[];
  isLoading: boolean;
  onRefreshAlerts: () => void;
  onDraftReorder: (material: MaterialItem, orderType: 'reorder' | 'replacement') => void;
  onOpenSettings: (material: MaterialItem) => void;
  onViewOrder?: (orderId: string) => void;
}

type FilterType = 'all' | 'expiry' | 'low_stock' | 'stockout_risk';

export const AlertsScreen: React.FC<AlertsScreenProps> = ({
  alerts,
  materials,
  isLoading,
  onRefreshAlerts,
  onDraftReorder,
  onOpenSettings,
  onViewOrder,
}) => {
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'med' | 'low'>('all');

  // Map material ID to MaterialItem
  const materialsMap = useMemo(() => {
    const map = new Map<string, MaterialItem>();
    materials.forEach((m) => {
      if (m.id) map.set(m.id, m);
    });
    return map;
  }, [materials]);

  // Materials needing threshold configuration
  const materialsNeedingConfig = useMemo(() => {
    return materials.filter(
      (m) => m.minThreshold === undefined || m.minThreshold === null
    );
  }, [materials]);

  // Filtered alerts
  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      // Type filter
      if (filterType === 'expiry') {
        if (alert.type !== 'expired' && alert.type !== 'expiring_soon') return false;
      } else if (filterType === 'low_stock') {
        if (alert.type !== 'low_stock') return false;
      } else if (filterType === 'stockout_risk') {
        if (alert.type !== 'stockout_risk') return false;
      }

      // Severity filter
      if (severityFilter !== 'all' && alert.severity !== severityFilter) {
        return false;
      }

      return true;
    });
  }, [alerts, filterType, severityFilter]);

  // Alert counts by type
  const counts = useMemo(() => {
    let expiry = 0;
    let lowStock = 0;
    let stockout = 0;
    let high = 0;

    alerts.forEach((a) => {
      if (a.type === 'expired' || a.type === 'expiring_soon') expiry++;
      if (a.type === 'low_stock') lowStock++;
      if (a.type === 'stockout_risk') stockout++;
      if (a.severity === 'high') high++;
    });

    return { all: alerts.length, expiry, lowStock, stockout, high };
  }, [alerts]);

  return (
    <div className="flex-1 flex flex-col justify-between bg-[#f4f6f9] h-full overflow-hidden">
      {/* Top Header */}
      <header className="h-16 px-4 flex items-center justify-between bg-white border-b border-[#e2e8f0] z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#fef7e0] flex items-center justify-center text-[#b06000]">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#1f2733] font-['Google_Sans',sans-serif]">
              Inventory Alerts
            </h1>
            <p className="text-xs text-[#5a6675]">
              {alerts.length} active alert{alerts.length === 1 ? '' : 's'} ({counts.high} high severity)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefreshAlerts}
          className="h-9 px-3 rounded-[14px] bg-[#f4f6f9] hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#e2e8f0] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
          title="Recompute alerts"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Recompute</span>
        </button>
      </header>

      {/* Filter Tabs & Severity Chips */}
      <div className="px-4 pt-3 pb-2.5 bg-white border-b border-[#e2e8f0] flex-shrink-0 space-y-2">
        {/* Main Type Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
              filterType === 'all'
                ? 'bg-[#1a73e8] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#5a6675] border border-[#e2e8f0] hover:bg-[#f4f6f9]'
            }`}
          >
            All Alerts ({counts.all})
          </button>

          <button
            type="button"
            onClick={() => setFilterType('expiry')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
              filterType === 'expiry'
                ? 'bg-[#c5221f] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#c5221f] border border-[#fad2cf] hover:bg-[#fce8e6]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Expiry ({counts.expiry})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('low_stock')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
              filterType === 'low_stock'
                ? 'bg-[#b06000] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#b06000] border border-[#feefc3] hover:bg-[#fef7e0]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Low Stock ({counts.lowStock})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterType('stockout_risk')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
              filterType === 'stockout_risk'
                ? 'bg-[#7c3aed] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#7c3aed] border border-[#ede9fe] hover:bg-[#f5f3ff]'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Stockout Risk ({counts.stockout})</span>
          </button>
        </div>

        {/* Severity Sub-filter */}
        <div className="flex items-center gap-2 text-[11px] text-[#5a6675] pt-0.5">
          <span className="font-semibold">Severity:</span>
          <div className="flex items-center gap-1">
            {(['all', 'high', 'med', 'low'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`px-2 py-0.5 rounded-[10px] uppercase font-bold transition-colors cursor-pointer ${
                  severityFilter === sev
                    ? 'bg-[#1f2733] text-white'
                    : 'bg-[#f4f6f9] text-[#5a6675] hover:bg-[#e2e8f0]'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts List */}
      <div className="flex-1 px-4 py-3 overflow-y-auto space-y-3 bg-[#f4f6f9]">
        {/* Banner: Materials needing threshold configuration */}
        {materialsNeedingConfig.length > 0 && filterType !== 'expiry' && (
          <div className="p-3 bg-[#fff8e1] border border-[#ffe082] rounded-[16px] text-xs space-y-1.5 m3-elevation-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#b06000] flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-[#b06000]" />
                Thresholds Needed ({materialsNeedingConfig.length})
              </span>
              <span className="text-[10px] text-[#b06000] font-semibold bg-white/70 px-2 py-0.5 rounded-full">
                Setup Stock Levels
              </span>
            </div>
            <p className="text-[11px] text-[#795548]">
              {materialsNeedingConfig.length} material{materialsNeedingConfig.length === 1 ? '' : 's'} lack configured minimum safety thresholds. We do not invent thresholds without your input.
            </p>
            <div className="flex gap-1.5 overflow-x-auto pt-1 no-scrollbar">
              {materialsNeedingConfig.slice(0, 3).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenSettings(m)}
                  className="flex-shrink-0 bg-white hover:bg-[#fef7e0] border border-[#ffd54f] px-2.5 py-1 rounded-[10px] font-semibold text-[11px] text-[#b06000] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Configure {m.name.slice(0, 16)}...</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="p-4 bg-white rounded-[16px] border border-[#e2e8f0] space-y-2.5 animate-pulse m3-elevation-1"
              >
                <div className="h-5 w-40 bg-[#e2e8f0] rounded-[6px]"></div>
                <div className="h-3 w-3/4 bg-[#e2e8f0] rounded-[4px]"></div>
                <div className="h-8 w-24 bg-[#e2e8f0] rounded-[12px]"></div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredAlerts.length === 0 && (
          <div className="text-center py-12 px-4 bg-white rounded-[16px] border border-[#e2e8f0] m3-elevation-1 my-4">
            <div className="w-16 h-16 rounded-full bg-[#e6f4ea] text-[#188038] flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-[#1f2733] mb-1 font-['Google_Sans',sans-serif]">
              {filterType === 'all'
                ? 'No Active Inventory Alerts'
                : `No active ${filterType.replace('_', ' ')} alerts`}
            </h3>
            <p className="text-xs text-[#5a6675] max-w-[260px] mx-auto">
              All materials are within healthy shelf-life and safety stock boundaries.
            </p>
          </div>
        )}

        {/* Alert Cards */}
        {!isLoading &&
          filteredAlerts.map((alert) => {
            const material = materialsMap.get(alert.materialId);

            // Severity styling
            let sevBadgeClass = 'bg-[#fce8e6] text-[#c5221f] border-[#fad2cf]';
            let SevIcon = Flame;
            if (alert.severity === 'med') {
              sevBadgeClass = 'bg-[#fef7e0] text-[#b06000] border-[#feefc3]';
              SevIcon = AlertTriangle;
            } else if (alert.severity === 'low') {
              sevBadgeClass = 'bg-[#e8f0fe] text-[#1a73e8] border-[#d2e3fc]';
              SevIcon = AlertCircle;
            }

            // Type styling
            let typeBadgeClass = 'bg-[#fce8e6] text-[#c5221f]';
            let typeLabel = 'Expired';
            if (alert.type === 'expiring_soon') {
              typeBadgeClass = 'bg-[#fef7e0] text-[#b06000]';
              typeLabel = 'Expiring Soon';
            } else if (alert.type === 'low_stock') {
              typeBadgeClass = 'bg-[#fff3e0] text-[#e65100]';
              typeLabel = 'Low Stock';
            } else if (alert.type === 'stockout_risk') {
              typeBadgeClass = 'bg-[#f3e8ff] text-[#7e22ce]';
              typeLabel = 'Stockout Risk';
            }

            const isExpiryAlert = alert.type === 'expired' || alert.type === 'expiring_soon';
            const hasCoveringPO = alert.linkedOrderId && alert.reorderStatus && alert.reorderStatus !== 'none' && alert.reorderStatus !== 'cancelled';

            return (
              <div
                key={alert.id}
                className="p-4 bg-white rounded-[16px] border border-[#e2e8f0] m3-elevation-1 hover:m3-elevation-2 transition-all space-y-2.5"
              >
                {/* Header: Material Name + Severity Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${typeBadgeClass}`}>
                        {typeLabel}
                      </span>
                      <span className="text-[11px] text-[#5a6675] truncate">
                        {alert.category || 'General'}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-[#1f2733] mt-1 line-clamp-1 font-['Google_Sans',sans-serif]">
                      {alert.materialName}
                    </h3>
                  </div>

                  <div
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-[14px] text-xs font-bold border capitalize ${sevBadgeClass}`}
                  >
                    <SevIcon className="w-3.5 h-3.5" />
                    <span>{alert.severity}</span>
                  </div>
                </div>

                {/* Primary Message */}
                <div className="text-xs font-bold text-[#1f2733] bg-[#f4f6f9] px-3 py-2 rounded-[12px] border border-[#e2e8f0]">
                  {alert.message}
                </div>

                {/* Linked Order Status Pill if active */}
                {hasCoveringPO && (
                  <div className="flex items-center gap-2 p-2 rounded-[10px] text-xs font-medium bg-[#e8f0fe] border border-[#d2e3fc] text-[#1a73e8]">
                    {alert.reorderStatus === 'approved' && <Truck className="w-4 h-4 flex-shrink-0 text-[#1a73e8]" />}
                    {alert.reorderStatus === 'pending_approval' && <Clock className="w-4 h-4 flex-shrink-0 text-[#b06000]" />}
                    {alert.reorderStatus === 'partially_received' && <RotateCcw className="w-4 h-4 flex-shrink-0 text-[#7e22ce]" />}
                    <div className="flex-1">
                      {alert.reorderStatus === 'approved' && (
                        <span>Reorder Approved — Awaiting Delivery ({alert.linkedOrderNumber})</span>
                      )}
                      {alert.reorderStatus === 'pending_approval' && (
                        <span className="text-[#b06000]">Reorder Draft Pending Approval ({alert.linkedOrderNumber})</span>
                      )}
                      {alert.reorderStatus === 'partially_received' && (
                        <span className="text-[#7e22ce]">Partially Received — Delivery In Progress ({alert.linkedOrderNumber})</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Plain-Language Reason backed by actual data */}
                <p className="text-xs text-[#5a6675] leading-relaxed">
                  {alert.reason}
                </p>

                {/* Evidence Strip */}
                <div className="grid grid-cols-2 gap-2 pt-0.5 text-[11px]">
                  {alert.evidence.expiryDate && (
                    <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] flex items-center justify-between">
                      <span className="text-[#5a6675] flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-[#1a73e8]" /> Expiry:
                      </span>
                      <span className="font-bold text-[#1f2733]">{alert.evidence.expiryDate}</span>
                    </div>
                  )}

                  {alert.evidence.quantity !== undefined && (
                    <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] flex items-center justify-between">
                      <span className="text-[#5a6675] flex items-center gap-1">
                        <Package className="w-3 h-3 text-[#1a73e8]" /> Batch Stock:
                      </span>
                      <span className="font-bold text-[#1a73e8]">
                        {alert.evidence.quantity} {alert.evidence.unit || 'pcs'}
                      </span>
                    </div>
                  )}

                  {alert.evidence.usableStock !== undefined && (
                    <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] flex items-center justify-between">
                      <span className="text-[#5a6675]">Usable Stock:</span>
                      <span className="font-bold text-[#1f2733]">
                        {alert.evidence.usableStock} {alert.evidence.unit || 'pcs'}
                      </span>
                    </div>
                  )}

                  {alert.evidence.minThreshold !== undefined && (
                    <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] flex items-center justify-between">
                      <span className="text-[#5a6675]">Min Threshold:</span>
                      <span className="font-bold text-[#1f2733]">
                        {alert.evidence.minThreshold} {alert.evidence.unit || 'pcs'}
                      </span>
                    </div>
                  )}

                  {alert.evidence.daysOfStock !== undefined && (
                    <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] flex items-center justify-between">
                      <span className="text-[#5a6675]">Days of Stock:</span>
                      <span className="font-bold text-[#c5221f]">
                        ~{alert.evidence.daysOfStock} days
                      </span>
                    </div>
                  )}
                </div>

                {/* Action Row */}
                <div className="pt-2 border-t border-[#e2e8f0] flex items-center justify-between gap-2 flex-wrap">
                  {material && (
                    <button
                      type="button"
                      onClick={() => onOpenSettings(material)}
                      className="h-9 px-3 rounded-[12px] bg-[#f4f6f9] hover:bg-[#e8f0fe] text-[#5a6675] hover:text-[#1a73e8] border border-[#e2e8f0] text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                      title="Adjust safety threshold and usage rate"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Configure Settings</span>
                    </button>
                  )}

                  {/* If active PO covers this alert: View PO button (prevents duplicates) */}
                  {hasCoveringPO ? (
                    <button
                      type="button"
                      onClick={() => onViewOrder && alert.linkedOrderId && onViewOrder(alert.linkedOrderId)}
                      className="h-9 px-3.5 rounded-[12px] bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] border border-[#d2e3fc] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer m3-elevation-1 ml-auto"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Active PO</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  ) : (
                    /* Otherwise: Allow drafting reorder / replacement */
                    material && alert.actionable && (
                      <button
                        type="button"
                        onClick={() =>
                          onDraftReorder(
                            material,
                            isExpiryAlert ? 'replacement' : 'reorder'
                          )
                        }
                        className={`h-9 px-3.5 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer m3-elevation-1 ml-auto ${
                          isExpiryAlert
                            ? 'bg-[#b06000] hover:bg-[#8d4c00] text-white'
                            : 'bg-[#1a73e8] hover:bg-[#1557b0] text-white'
                        }`}
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>{isExpiryAlert ? 'Draft Replacement' : 'Draft Reorder'}</span>
                        <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};
