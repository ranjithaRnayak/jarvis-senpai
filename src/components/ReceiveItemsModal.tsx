import React, { useState, useEffect, useRef } from 'react';
import { X, PackageCheck, AlertCircle, ShieldAlert, CheckCircle2, Calendar, Hash, Clock, FileText } from 'lucide-react';
import { PurchaseOrder, receiveOrderItems, ReceiveItemsResult } from '../services/orderService';
import { MaterialItem, computeMaterialStatus, calculateExpiryDate } from '../services/materialService';

interface ReceiveItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: PurchaseOrder | null;
  materials: MaterialItem[];
  onReceived: (result: ReceiveItemsResult) => void;
}

export const ReceiveItemsModal: React.FC<ReceiveItemsModalProps> = ({
  isOpen,
  onClose,
  order,
  materials,
  onReceived,
}) => {
  const [receivedQty, setReceivedQty] = useState<number>(1);
  const [batchNo, setBatchNo] = useState<string>('');
  const [receiptDate, setReceiptDate] = useState<string>('');
  const [shelfLifeDays, setShelfLifeDays] = useState<number>(90);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [isNewBatch, setIsNewBatch] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Guard ref to ensure form is initialized only ONCE per modal open
  const initializedOrderKeyRef = useRef<string | null>(null);

  // Find target material
  const targetMat = order ? materials.find((m) => m.id === order.materialId) : null;
  const isTargetExpired = targetMat ? computeMaterialStatus(targetMat.expiryDate) === 'expired' : false;

  useEffect(() => {
    if (!isOpen || !order) {
      initializedOrderKeyRef.current = null;
      return;
    }

    // Only run initialization ONCE per open for this specific order
    const orderKey = `${order.id}-${order.receivedQuantity || 0}`;
    if (initializedOrderKeyRef.current === orderKey) {
      return;
    }
    initializedOrderKeyRef.current = orderKey;

    const remaining = typeof order.remainingQuantity === 'number'
      ? order.remainingQuantity
      : Math.max(0, order.quantity - (order.receivedQuantity || 0));

    setReceivedQty(remaining > 0 ? remaining : 1);

    const todayStr = new Date().toISOString().split('T')[0];
    setReceiptDate(todayStr);

    const defaultShelfLife = targetMat?.shelfLifeDays || 90;
    setShelfLifeDays(defaultShelfLife);
    setExpiryDate(calculateExpiryDate(todayStr, defaultShelfLife) ?? '');

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    setBatchNo(`LOT-${new Date().getFullYear()}-${randomSuffix}`);

    // If target material is expired, MUST be a new batch
    if (isTargetExpired) {
      setIsNewBatch(true);
    } else {
      setIsNewBatch(true); // Default to new batch for delivery safety
    }

    setNotes('');
    setErrorMsg(null);
  }, [isOpen, order?.id, order?.receivedQuantity]);

  // Recalculate expiry date if receiptDate or shelfLifeDays changes
  const handleShelfLifeChange = (days: number) => {
    setShelfLifeDays(days);
    if (receiptDate) {
      setExpiryDate(calculateExpiryDate(receiptDate, days) ?? '');
    }
  };

  const handleReceiptDateChange = (dateStr: string) => {
    setReceiptDate(dateStr);
    if (dateStr) {
      setExpiryDate(calculateExpiryDate(dateStr, shelfLifeDays) ?? '');
    }
  };

  if (!isOpen || !order) return null;

  const currentRemaining = typeof order.remainingQuantity === 'number'
    ? order.remainingQuantity
    : Math.max(0, order.quantity - (order.receivedQuantity || 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order.id) return;

    if (receivedQty <= 0) {
      setErrorMsg('Please specify a valid quantity greater than 0.');
      return;
    }

    if (receivedQty > currentRemaining) {
      setErrorMsg(`Cannot receive more than the outstanding quantity of ${currentRemaining} ${order.unit}.`);
      return;
    }

    if (isNewBatch && !batchNo.trim()) {
      setErrorMsg('Please enter a batch/lot identifier for the incoming stock.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await receiveOrderItems(order.id, {
        receivedQuantity: receivedQty,
        batchNo: isNewBatch ? batchNo.trim() : (targetMat?.batchNo || batchNo.trim()),
        receiptDate: receiptDate || new Date().toISOString().split('T')[0],
        shelfLifeDays,
        expiryDate,
        notes: notes.trim(),
        isNewBatch,
        receivedBy: 'Inventory Specialist',
      });

      onReceived(result);
      onClose();
    } catch (err: any) {
      console.error('Receive order error:', err);
      setErrorMsg(err?.message || 'Failed to persist inventory receipt.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-[420px] bg-white rounded-[20px] shadow-2xl border border-[#e2e8f0] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between bg-white flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-[#e6f4ea] text-[#188038] flex items-center justify-center">
              <PackageCheck className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1f2733] font-['Google_Sans',sans-serif]">
                Receive Items
              </h2>
              <p className="text-xs text-[#5a6675]">PO: {order.orderNumber}</p>
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-[#fce8e6] text-[#c5221f] rounded-[12px] border border-[#fad2cf] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Order Summary Snapshot */}
          <div className="bg-[#f4f6f9] p-3 rounded-[14px] border border-[#e2e8f0] space-y-1.5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-[#5a6675] uppercase font-bold tracking-wider">Item</span>
                <div className="font-bold text-sm text-[#1f2733]">{order.materialName}</div>
              </div>
              <span className="text-[10px] bg-[#e8f0fe] text-[#1a73e8] font-bold px-2 py-0.5 rounded-full">
                {order.supplierName}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#e2e8f0] text-center">
              <div>
                <span className="text-[10px] text-[#5a6675] block">Total PO:</span>
                <span className="font-semibold text-[#1f2733]">{order.quantity} {order.unit}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#5a6675] block">Received:</span>
                <span className="font-semibold text-[#188038]">{order.receivedQuantity || 0} {order.unit}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#5a6675] block">Outstanding:</span>
                <span className="font-bold text-[#b06000]">{currentRemaining} {order.unit}</span>
              </div>
            </div>
          </div>

          {/* Expired Batch Warning Notice */}
          {isTargetExpired && (
            <div className="p-3 bg-[#fce8e6] border border-[#fad2cf] rounded-[12px] text-xs text-[#c5221f] space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-[#c5221f]" />
                Batch & Expiry Safety Rule
              </div>
              <p className="text-[11px] leading-relaxed">
                Existing batch <strong>{targetMat?.batchNo}</strong> has expired. To maintain batch integrity, incoming stock cannot be added to this expired record and will be created as a new fresh batch.
              </p>
            </div>
          )}

          {/* Quantity to Receive Now */}
          <div className="space-y-1.5">
            <label className="font-semibold text-[#1f2733] flex justify-between">
              <span>Quantity Received Now ({order.unit})</span>
              <span className="text-[11px] text-[#5a6675]">Max: {currentRemaining} {order.unit}</span>
            </label>
            <input
              type="number"
              min="1"
              max={currentRemaining}
              step="any"
              value={receivedQty}
              onChange={(e) => setReceivedQty(parseFloat(e.target.value) || 0)}
              className="w-full h-11 px-3 bg-white border border-[#e2e8f0] rounded-[12px] text-xs font-bold text-[#1f2733] focus:border-[#1a73e8] focus:outline-none"
              required
            />
            {receivedQty < currentRemaining && receivedQty > 0 && (
              <p className="text-[11px] text-[#b06000] font-medium">
                ⚠️ Partial delivery: {(currentRemaining - receivedQty).toFixed(1)} {order.unit} will remain outstanding.
              </p>
            )}
          </div>

          {/* Batch Destination Selection */}
          <div className="space-y-1.5">
            <label className="font-semibold text-[#1f2733]">Batch Allocation</label>
            <div className="space-y-1.5">
              <label
                className={`p-2.5 rounded-[12px] border flex items-center gap-2 cursor-pointer transition-colors ${
                  isNewBatch ? 'bg-[#e8f0fe] border-[#1a73e8]' : 'bg-white border-[#e2e8f0]'
                }`}
              >
                <input
                  type="radio"
                  name="batchOption"
                  checked={isNewBatch}
                  onChange={() => setIsNewBatch(true)}
                  className="text-[#1a73e8]"
                />
                <div>
                  <div className="font-bold text-[#1f2733]">Create as New Batch (Recommended)</div>
                  <div className="text-[10px] text-[#5a6675]">
                    Safeguards batch traceability and creates distinct expiry metadata.
                  </div>
                </div>
              </label>

              <label
                className={`p-2.5 rounded-[12px] border flex items-center gap-2 transition-colors ${
                  isTargetExpired
                    ? 'opacity-50 cursor-not-allowed bg-[#f4f6f9] border-[#e2e8f0]'
                    : !isNewBatch
                    ? 'bg-[#e8f0fe] border-[#1a73e8] cursor-pointer'
                    : 'bg-white border-[#e2e8f0] cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name="batchOption"
                  disabled={isTargetExpired}
                  checked={!isNewBatch}
                  onChange={() => !isTargetExpired && setIsNewBatch(false)}
                  className="text-[#1a73e8]"
                />
                <div>
                  <div className="font-bold text-[#1f2733]">
                    Add to Existing Batch {targetMat ? `(${targetMat.batchNo})` : ''}
                  </div>
                  <div className="text-[10px] text-[#5a6675]">
                    {isTargetExpired
                      ? 'Disabled: Existing batch is expired'
                      : 'Only use if the incoming items are genuinely the same batch and expiry.'}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Batch & Date Details (Shown for new batch) */}
          {isNewBatch && (
            <div className="space-y-3 p-3 bg-[#f4f6f9] rounded-[14px] border border-[#e2e8f0]">
              <div className="space-y-1">
                <label className="font-semibold text-[#1f2733] flex items-center gap-1">
                  <Hash className="w-3.5 h-3.5 text-[#1a73e8]" />
                  Incoming Batch / LOT Number
                </label>
                <input
                  type="text"
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  placeholder="e.g. LOT-2026-X88"
                  className="w-full h-10 px-3 bg-white border border-[#e2e8f0] rounded-[10px] text-xs font-semibold focus:border-[#1a73e8] focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-semibold text-[#1f2733] flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#5a6675]" />
                    Receipt Date
                  </label>
                  <input
                    type="date"
                    value={receiptDate}
                    onChange={(e) => handleReceiptDateChange(e.target.value)}
                    className="w-full h-10 px-2.5 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-[#1f2733] flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#5a6675]" />
                    Shelf Life (Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={shelfLifeDays}
                    onChange={(e) => handleShelfLifeChange(parseInt(e.target.value, 10) || 90)}
                    className="w-full h-10 px-2.5 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] bg-white p-2 rounded-[8px] border border-[#e2e8f0]">
                <span className="text-[#5a6675]">Computed Expiry Date:</span>
                <span className="font-bold text-[#188038]">{expiryDate || 'N/A'}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-semibold text-[#1f2733] flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-[#5a6675]" />
              Delivery / Receipt Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Carrier delivery, carton undamaged, inspected by QA"
              className="w-full h-10 px-3 bg-white border border-[#e2e8f0] rounded-[10px] text-xs focus:border-[#1a73e8] focus:outline-none"
            />
          </div>

          {/* Form Actions */}
          <div className="pt-2 flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-12 rounded-[14px] bg-white border border-[#e2e8f0] text-[#5a6675] font-semibold hover:bg-[#f4f6f9] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-12 rounded-[14px] bg-[#188038] hover:bg-[#137333] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              {isSubmitting ? 'Receiving...' : 'Confirm Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
