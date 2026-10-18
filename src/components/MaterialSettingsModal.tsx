import React, { useState, useEffect } from 'react';
import { X, Sliders, AlertCircle, CheckCircle2, ShieldCheck, Building2 } from 'lucide-react';
import { MaterialItem, updateMaterialSettings } from '../services/materialService';
import { getSuppliers } from '../services/supplierService';

interface MaterialSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: MaterialItem | null;
  onSettingsSaved?: () => void;
}

export const MaterialSettingsModal: React.FC<MaterialSettingsModalProps> = ({
  isOpen,
  onClose,
  material,
  onSettingsSaved,
}) => {
  const [minThreshold, setMinThreshold] = useState<string>('');
  const [targetStockLevel, setTargetStockLevel] = useState<string>('');
  const [dailyUsageRate, setDailyUsageRate] = useState<string>('');
  const [supplierLeadDays, setSupplierLeadDays] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const suppliers = getSuppliers();

  useEffect(() => {
    if (!material) return;
    setMinThreshold(material.minThreshold !== undefined ? String(material.minThreshold) : '');
    setTargetStockLevel(material.targetStockLevel !== undefined ? String(material.targetStockLevel) : '');
    setDailyUsageRate(material.dailyUsageRate !== undefined ? String(material.dailyUsageRate) : '');
    setSupplierLeadDays(material.supplierLeadDays !== undefined ? String(material.supplierLeadDays) : '');
    setUnitPrice(material.unitPrice !== undefined ? String(material.unitPrice) : '');
    setSupplierId(material.supplierId || suppliers[0].id);
    setErrorMsg(null);
  }, [material, suppliers]);

  if (!isOpen || !material) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!material.id) return;

    setIsSaving(true);
    setErrorMsg(null);

    const parseNum = (val: string): number | undefined => {
      const trimmed = val.trim();
      if (trimmed === '') return undefined;
      const num = Number(trimmed);
      return !isNaN(num) ? num : undefined;
    };

    try {
      await updateMaterialSettings(material.id, {
        minThreshold: parseNum(minThreshold),
        targetStockLevel: parseNum(targetStockLevel),
        dailyUsageRate: parseNum(dailyUsageRate),
        supplierLeadDays: parseNum(supplierLeadDays),
        unitPrice: parseNum(unitPrice),
        supplierId: supplierId || undefined,
      });

      if (onSettingsSaved) {
        onSettingsSaved();
      }
      onClose();
    } catch (err: any) {
      console.error('Error saving material settings:', err);
      setErrorMsg(err?.message || 'Failed to update material settings in Firestore.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-[420px] bg-white rounded-[20px] shadow-2xl border border-[#e2e8f0] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#e8f0fe] text-[#1a73e8] flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1f2733] font-['Google_Sans',sans-serif]">
                Stock & Reorder Settings
              </h2>
              <p className="text-xs text-[#5a6675]">Configure deterministic alert thresholds</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-[#f4f6f9] flex items-center justify-center text-[#5a6675] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-[#fce8e6] text-[#c5221f] rounded-[12px] border border-[#fad2cf] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Current Material Details */}
          <div className="bg-[#f4f6f9] p-3 rounded-[14px] border border-[#e2e8f0]">
            <div className="text-[10px] uppercase font-bold text-[#5a6675] tracking-wider">Item Under Configuration</div>
            <div className="font-bold text-sm text-[#1f2733] mt-0.5">{material.name}</div>
            <div className="flex justify-between text-[#5a6675] mt-1">
              <span>Batch: {material.batchNo || 'N/A'}</span>
              <span>Current Stock: <strong className="text-[#1a73e8]">{material.quantity} {material.unit}</strong></span>
            </div>
          </div>

          {/* 1. Low Stock Safety Threshold (minThreshold) */}
          <div className="space-y-1">
            <label className="font-semibold text-[#1f2733] flex items-center justify-between">
              <span>Minimum Safety Threshold (minThreshold)</span>
              <span className="text-[10px] text-[#5a6675] font-normal">Optional</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 5"
                value={minThreshold}
                onChange={(e) => setMinThreshold(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-[#e2e8f0] rounded-[12px] text-xs text-[#1f2733] focus:border-[#1a73e8] focus:outline-none"
              />
              <span className="text-xs font-semibold text-[#5a6675] min-w-[36px]">{material.unit}</span>
            </div>
            <p className="text-[11px] text-[#5a6675]">
              Generates a <strong>Low Stock</strong> alert when current quantity ≤ this threshold. If left empty, no low stock alerts are fabricated.
            </p>
          </div>

          {/* 2. Target Stock Level */}
          <div className="space-y-1">
            <label className="font-semibold text-[#1f2733] flex items-center justify-between">
              <span>Target Stock Level (targetStockLevel)</span>
              <span className="text-[10px] text-[#5a6675] font-normal">Optional</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 25"
                value={targetStockLevel}
                onChange={(e) => setTargetStockLevel(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-[#e2e8f0] rounded-[12px] text-xs text-[#1f2733] focus:border-[#1a73e8] focus:outline-none"
              />
              <span className="text-xs font-semibold text-[#5a6675] min-w-[36px]">{material.unit}</span>
            </div>
            <p className="text-[11px] text-[#5a6675]">
              Used to calculate suggested reorder quantity: <code className="bg-[#e8f0fe] px-1 rounded text-[#1a73e8]">max(0, target - quantity)</code>.
            </p>
          </div>

          {/* 3. Daily Usage Rate & Lead Time */}
          <div className="p-3 bg-white rounded-[14px] border border-[#e2e8f0] space-y-3">
            <div className="font-bold text-[#1f2733] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#1a73e8]" />
              Stock-out Risk Forecasting
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[#1f2733]">
                  Daily Usage ({material.unit}/day)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="e.g. 1.5"
                  value={dailyUsageRate}
                  onChange={(e) => setDailyUsageRate(e.target.value)}
                  className="w-full h-10 px-2.5 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[#1f2733]">
                  Supplier Lead Time (days)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 7"
                  value={supplierLeadDays}
                  onChange={(e) => setSupplierLeadDays(e.target.value)}
                  className="w-full h-10 px-2.5 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none"
                />
              </div>
            </div>
            <p className="text-[10px] text-[#5a6675]">
              When both are configured, flags a <strong>Stock-out Risk</strong> if <code className="bg-[#f4f6f9] px-1 rounded">quantity / dailyUsageRate ≤ leadDays</code>.
            </p>
          </div>

          {/* 4. Unit Price & Supplier */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="font-semibold text-[#1f2733]">Unit Price ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 12.50"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="w-full h-10 px-2.5 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-[#1f2733]">Assigned Supplier</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full h-10 px-2 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none truncate"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 h-12 rounded-[14px] bg-white border border-[#e2e8f0] text-[#5a6675] font-semibold hover:bg-[#f4f6f9] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 h-12 rounded-[14px] bg-[#1a73e8] hover:bg-[#1557b0] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
