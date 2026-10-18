import React, { useState, useEffect } from 'react';
import { X, ShoppingCart, AlertCircle, Building2, Calculator, Info } from 'lucide-react';
import { MaterialItem } from '../services/materialService';
import { getSuppliers, Supplier } from '../services/supplierService';
import { PurchaseOrder, draftOrder, saveOrderToFirestore } from '../services/orderService';

interface DraftOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: MaterialItem | null;
  orderType?: 'reorder' | 'replacement' | 'manual';
  onOrderSaved?: (orderId: string) => void;
}

export const DraftOrderModal: React.FC<DraftOrderModalProps> = ({
  isOpen,
  onClose,
  material,
  orderType = 'reorder',
  onOrderSaved,
}) => {
  const [suppliers] = useState<Supplier[]>(getSuppliers());
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [deficitText, setDeficitText] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!material) return;

    let initialQty = 1;
    let defText = '';

    if (typeof material.targetStockLevel === 'number' && material.targetStockLevel > 0) {
      initialQty = Math.max(1, material.targetStockLevel - (material.quantity ?? 0));
      defText = `Target stock level: ${material.targetStockLevel} ${material.unit} (Current: ${(material.quantity ?? 0)} ${material.unit})`;
    } else if (typeof material.minThreshold === 'number' && material.minThreshold > 0) {
      const deficit = Math.max(0, material.minThreshold - (material.quantity ?? 0));
      initialQty = deficit > 0 ? deficit : 1;
      defText = `Minimum safety threshold deficit: ${deficit} ${material.unit} (Safety min: ${material.minThreshold} ${material.unit})`;
    } else {
      initialQty = 1;
      defText = 'Stock threshold not configured; standard default 1 unit suggested.';
    }

    setQuantity(initialQty);
    setDeficitText(defText);

    // Supplier resolution
    const preferredSup = suppliers.find((s) => s.id === material.supplierId) || suppliers[0];
    setSelectedSupplierId(preferredSup.id);

    // Unit price
    if (typeof material.unitPrice === 'number' && material.unitPrice >= 0) {
      setUnitPrice(material.unitPrice.toString());
    } else {
      setUnitPrice('');
    }

    setNotes(
      orderType === 'replacement'
        ? `Replacement batch for expired/expiring lot ${material.batchNo || 'N/A'}.`
        : `Replenishment order for ${material.name}.`
    );
    setErrorMsg(null);
  }, [material, orderType, suppliers]);

  if (!isOpen || !material) return null;

  const parsedPrice = unitPrice.trim() !== '' && !isNaN(Number(unitPrice)) ? Number(unitPrice) : null;
  const estimatedCost = parsedPrice !== null && quantity > 0 ? Number((quantity * parsedPrice).toFixed(2)) : null;
  const currentSupplier = suppliers.find((s) => s.id === selectedSupplierId) || suppliers[0];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (quantity <= 0) {
      setErrorMsg('Please specify a quantity greater than 0.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      const draft = await draftOrder(material, {
        customQuantity: quantity,
        customSupplierId: selectedSupplierId,
        customUnitPrice: parsedPrice ?? undefined,
        orderType,
        notes: notes.trim(),
      });

      const orderId = await saveOrderToFirestore(draft);
      if (onOrderSaved) {
        onOrderSaved(orderId);
      }
      onClose();
    } catch (err: any) {
      console.error('Failed to create draft order:', err);
      setErrorMsg(err?.message || 'Failed to persist draft order.');
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
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1f2733] font-['Google_Sans',sans-serif]">
                {orderType === 'replacement' ? 'Draft Replacement Order' : 'Draft Purchase Requisition'}
              </h2>
              <p className="text-xs text-[#5a6675]">Initial status: Pending Approval</p>
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

        {/* Expiry Replacement Disclaimer if applicable */}
        {orderType === 'replacement' && (
          <div className="px-5 py-2.5 bg-[#fef7e0] border-b border-[#feefc3] text-xs text-[#b06000] flex items-start gap-2 flex-shrink-0">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Safety Note:</span> Replenishing inventory does not make expired batches safe.
              This will create a purchase draft for fresh replacement stock.
            </div>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-[#fce8e6] text-[#c5221f] rounded-[12px] border border-[#fad2cf] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Material Snapshot */}
          <div className="bg-[#f4f6f9] p-3 rounded-[14px] border border-[#e2e8f0] space-y-1">
            <div className="text-[10px] uppercase font-bold text-[#5a6675] tracking-wider">Item Details</div>
            <div className="font-bold text-sm text-[#1f2733]">{material.name}</div>
            <div className="flex justify-between text-[#5a6675]">
              <span>Category: {material.category || 'General'}</span>
              <span>In Stock: <strong className="text-[#1f2733]">{material.quantity} {material.unit}</strong></span>
            </div>
            {deficitText && (
              <div className="text-[11px] text-[#1a73e8] bg-[#e8f0fe] p-1.5 rounded-[8px] mt-1 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{deficitText}</span>
              </div>
            )}
          </div>

          {/* Supplier Selection (Synthetic dataset clearly marked) */}
          <div className="space-y-1.5">
            <label className="font-semibold text-[#1f2733] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#1a73e8]" />
                Supplier
              </span>
              <span className="text-[10px] text-[#b06000] font-normal bg-[#fef7e0] px-1.5 py-0.5 rounded">
                Synthetic Demo Supplier
              </span>
            </label>
            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="w-full h-11 px-3 bg-white border border-[#e2e8f0] rounded-[12px] text-xs text-[#1f2733] focus:border-[#1a73e8] focus:outline-none"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.leadDays}d lead time)
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[#5a6675]">
              Est. Lead Time: {currentSupplier.leadDays} days. Note: synthetic demo data for testing.
            </p>
          </div>

          {/* Quantity & Unit Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-[#1f2733]">
                Order Quantity ({material.unit})
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseFloat(e.target.value) || 1))}
                className="w-full h-11 px-3 bg-white border border-[#e2e8f0] rounded-[12px] text-xs text-[#1f2733] font-semibold focus:border-[#1a73e8] focus:outline-none"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-[#1f2733]">
                Unit Price ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unavailable"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-[#e2e8f0] rounded-[12px] text-xs text-[#1f2733] focus:border-[#1a73e8] focus:outline-none"
              />
            </div>
          </div>

          {/* Cost Calculation Preview */}
          <div className="p-3 bg-[#f4f6f9] rounded-[12px] border border-[#e2e8f0] flex items-center justify-between">
            <span className="font-medium text-[#5a6675] flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5 text-[#1a73e8]" />
              Estimated Total:
            </span>
            <span className="font-bold text-sm text-[#1f2733]">
              {estimatedCost !== null ? `$${estimatedCost.toFixed(2)} USD` : 'Unavailable (enter price)'}
            </span>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="font-semibold text-[#1f2733]">Requisition Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add justification or special dispatch notes..."
              className="w-full p-2.5 bg-white border border-[#e2e8f0] rounded-[12px] text-xs text-[#1f2733] focus:border-[#1a73e8] focus:outline-none"
            />
          </div>

          {/* Human approval safety reminder */}
          <div className="text-[11px] text-[#5a6675] bg-white p-2.5 rounded-[12px] border border-[#e2e8f0] space-y-1">
            <div className="font-semibold text-[#1f2733]">Safety Guarantee:</div>
            <div>
              • Order is created with status <strong className="text-[#b06000]">pending_approval</strong>.
            </div>
            <div>• Requires explicit human review and approval in the Orders screen.</div>
            <div>• Never automatically placed or dispatched to third parties.</div>
          </div>

          {/* Form Actions */}
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
              {isSaving ? 'Saving Draft...' : 'Create Draft PO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
