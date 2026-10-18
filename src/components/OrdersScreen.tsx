import React, { useState, useMemo } from 'react';
import {
  ShoppingCart,
  CheckCircle2,
  Clock,
  Building2,
  DollarSign,
  AlertCircle,
  Edit2,
  Check,
  Package,
  Layers,
  Info,
  ShieldCheck,
  Plus,
  PackageCheck,
  Ban,
  Truck,
  RotateCcw,
} from 'lucide-react';
import {
  PurchaseOrder,
  OrderStatus,
  updateOrderInFirestore,
  approveOrderInFirestore,
  cancelOrderInFirestore,
  ReceiveItemsResult,
} from '../services/orderService';
import { MaterialItem } from '../services/materialService';
import { getSuppliers } from '../services/supplierService';
import { ReceiveItemsModal } from './ReceiveItemsModal';

interface OrdersScreenProps {
  orders: PurchaseOrder[];
  materials: MaterialItem[];
  isLoading: boolean;
  onOpenDraftModal: (material: MaterialItem) => void;
  triggerNotice: (msg: string) => void;
  onOrderUpdated?: () => void;
}

type OrderFilter = 'all' | 'pending_approval' | 'awaiting_receipt' | 'received' | 'cancelled';

export const OrdersScreen: React.FC<OrdersScreenProps> = ({
  orders,
  materials,
  isLoading,
  onOpenDraftModal,
  triggerNotice,
  onOrderUpdated,
}) => {
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [orderToCancel, setOrderToCancel] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);

  // Edit form state
  const [editQty, setEditQty] = useState<number>(1);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editSupplierId, setEditSupplierId] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState<boolean>(false);
  const [selectMaterialModalOpen, setSelectMaterialModalOpen] = useState<boolean>(false);

  const suppliers = getSuppliers();

  // Filter orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (filter === 'pending_approval') return o.status === 'pending_approval';
      if (filter === 'awaiting_receipt') return o.status === 'approved' || o.status === 'partially_received';
      if (filter === 'received') return o.status === 'received';
      if (filter === 'cancelled') return o.status === 'cancelled';
      return true;
    });
  }, [orders, filter]);

  // Order counts
  const counts = useMemo(() => {
    let pending = 0;
    let awaiting = 0;
    let received = 0;
    let cancelled = 0;

    orders.forEach((o) => {
      if (o.status === 'pending_approval') pending++;
      if (o.status === 'approved' || o.status === 'partially_received') awaiting++;
      if (o.status === 'received') received++;
      if (o.status === 'cancelled') cancelled++;
    });

    return { all: orders.length, pending, awaiting, received, cancelled };
  }, [orders]);

  // Approve action requiring explicit human confirmation
  const handleApprove = async (order: PurchaseOrder) => {
    if (!order.id) return;
    try {
      setApprovingOrderId(order.id);
      await approveOrderInFirestore(order.id, 'Inventory Specialist');
      triggerNotice(`PO ${order.orderNumber} approved — awaiting stock receipt.`);
      if (onOrderUpdated) onOrderUpdated();
    } catch (err: any) {
      console.error('Approve failed:', err);
      triggerNotice(`Failed to approve order: ${err?.message || 'Error'}`);
    } finally {
      setApprovingOrderId(null);
    }
  };

  // Open cancel confirmation modal (safe in-app modal instead of blocked window.confirm)
  const handleCancelClick = (order: PurchaseOrder) => {
    setOrderToCancel(order);
  };

  // Confirm cancel order action
  const handleConfirmCancel = async (order: PurchaseOrder) => {
    if (!order.id) return;

    try {
      setCancellingOrderId(order.id);
      await cancelOrderInFirestore(order.id, 'Cancelled by inventory manager');
      triggerNotice(`PO ${order.orderNumber} has been cancelled.`);
      setOrderToCancel(null);
      if (onOrderUpdated) onOrderUpdated();
    } catch (err: any) {
      console.error('Cancel failed:', err);
      triggerNotice(`Failed to cancel order: ${err?.message || 'Error'}`);
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Open edit modal
  const handleOpenEdit = (order: PurchaseOrder) => {
    setEditingOrder(order);
    setEditQty(order.quantity);
    setEditPrice(order.unitPrice !== null && order.unitPrice !== undefined ? String(order.unitPrice) : '');
    setEditSupplierId(order.supplierId || suppliers[0].id);
    setEditNotes(order.notes || '');
  };

  // Save edit
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder?.id) return;

    setIsSubmittingEdit(true);
    const parsedPrice = editPrice.trim() !== '' && !isNaN(Number(editPrice)) ? Number(editPrice) : null;
    const estimatedCost = parsedPrice !== null && editQty > 0 ? Number((editQty * parsedPrice).toFixed(2)) : null;
    const sup = suppliers.find((s) => s.id === editSupplierId) || suppliers[0];

    try {
      await updateOrderInFirestore(editingOrder.id, {
        quantity: editQty,
        remainingQuantity: Math.max(0, editQty - (editingOrder.receivedQuantity || 0)),
        supplierId: sup.id,
        supplierName: sup.name,
        unitPrice: parsedPrice,
        estimatedCost,
        notes: editNotes.trim(),
      });
      triggerNotice(`Updated PO ${editingOrder.orderNumber}`);
      setEditingOrder(null);
      if (onOrderUpdated) onOrderUpdated();
    } catch (err) {
      console.error('Update order error:', err);
      triggerNotice('Failed to update order.');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Handle receipt confirmation
  const handleReceiptComplete = (result: ReceiveItemsResult) => {
    triggerNotice(
      `Received ${result.inventoryQuantityAdded} ${result.updatedOrder.unit} for ${result.updatedOrder.materialName}. Inventory successfully updated!`
    );
    if (onOrderUpdated) onOrderUpdated();
  };

  return (
    <div className="flex-1 flex flex-col justify-between bg-[#f4f6f9] h-full overflow-hidden">
      {/* Top Header */}
      <header className="h-16 px-4 flex items-center justify-between bg-white border-b border-[#e2e8f0] z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#e8f0fe] flex items-center justify-center text-[#1a73e8]">
            <ShoppingCart className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#1f2733] font-['Google_Sans',sans-serif]">
              Purchase Orders
            </h1>
            <p className="text-xs text-[#5a6675]">
              {counts.pending} pending · {counts.awaiting} awaiting receipt
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSelectMaterialModalOpen(true)}
          className="h-10 px-3.5 rounded-[16px] bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold flex items-center gap-1.5 m3-elevation-1 transition-all active:scale-95 cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>New PO</span>
        </button>
      </header>

      {/* Filter Tabs */}
      <div className="px-4 pt-3 pb-2.5 bg-white border-b border-[#e2e8f0] flex-shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1 cursor-pointer flex-shrink-0 ${
              filter === 'all'
                ? 'bg-[#1a73e8] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#5a6675] border border-[#e2e8f0] hover:bg-[#f4f6f9]'
            }`}
          >
            All ({counts.all})
          </button>

          <button
            type="button"
            onClick={() => setFilter('pending_approval')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
              filter === 'pending_approval'
                ? 'bg-[#b06000] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#b06000] border border-[#feefc3] hover:bg-[#fef7e0]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Pending ({counts.pending})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilter('awaiting_receipt')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
              filter === 'awaiting_receipt'
                ? 'bg-[#1a73e8] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#1a73e8] border border-[#d2e3fc] hover:bg-[#e8f0fe]'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Awaiting Delivery ({counts.awaiting})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilter('received')}
            className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
              filter === 'received'
                ? 'bg-[#188038] text-white font-semibold m3-elevation-1'
                : 'bg-white text-[#188038] border border-[#ceead6] hover:bg-[#e6f4ea]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Received ({counts.received})</span>
          </button>

          {counts.cancelled > 0 && (
            <button
              type="button"
              onClick={() => setFilter('cancelled')}
              className={`h-8 px-3 rounded-[16px] font-medium transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
                filter === 'cancelled'
                  ? 'bg-[#5a6675] text-white font-semibold m3-elevation-1'
                  : 'bg-white text-[#5a6675] border border-[#e2e8f0] hover:bg-[#f4f6f9]'
              }`}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Cancelled ({counts.cancelled})</span>
            </button>
          )}
        </div>
      </div>

      {/* Orders List */}
      <div className="flex-1 px-4 py-3 overflow-y-auto space-y-3 bg-[#f4f6f9]">
        {/* Safety Disclaimer Banner */}
        <div className="p-3 bg-white border border-[#e2e8f0] rounded-[16px] text-xs text-[#5a6675] flex items-start gap-2.5 m3-elevation-1">
          <ShieldCheck className="w-4 h-4 text-[#1a73e8] flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-[#1f2733]">Workflow Rule:</span> PO approval records internal authorization and does not change inventory. Stock is only incremented when you explicitly record delivery via <strong>Receive Items</strong>.
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3 pt-2">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="p-4 bg-white rounded-[16px] border border-[#e2e8f0] space-y-2.5 animate-pulse m3-elevation-1"
              >
                <div className="h-5 w-40 bg-[#e2e8f0] rounded-[6px]"></div>
                <div className="h-4 w-3/4 bg-[#e2e8f0] rounded-[4px]"></div>
                <div className="h-8 w-28 bg-[#e2e8f0] rounded-[12px]"></div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredOrders.length === 0 && (
          <div className="text-center py-12 px-4 bg-white rounded-[16px] border border-[#e2e8f0] m3-elevation-1 my-4">
            <div className="w-16 h-16 rounded-full bg-[#e8f0fe] text-[#1a73e8] flex items-center justify-center mx-auto mb-3">
              <ShoppingCart className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-[#1f2733] mb-1 font-['Google_Sans',sans-serif]">
              {filter === 'all'
                ? 'No Purchase Orders Yet'
                : `No ${filter.replace('_', ' ')} orders`}
            </h3>
            <p className="text-xs text-[#5a6675] max-w-[260px] mx-auto mb-4">
              Requisition new stock from the Alerts screen or tap below to draft a purchase order.
            </p>
            <button
              type="button"
              onClick={() => setSelectMaterialModalOpen(true)}
              className="h-11 px-4 rounded-[14px] bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold inline-flex items-center gap-1.5 m3-elevation-1 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Draft Requisition</span>
            </button>
          </div>
        )}

        {/* Order Cards */}
        {!isLoading &&
          filteredOrders.map((order) => {
            const isPending = order.status === 'pending_approval';
            const isApproved = order.status === 'approved';
            const isPartial = order.status === 'partially_received';
            const isReceived = order.status === 'received';
            const isCancelled = order.status === 'cancelled';

            let statusBadge = (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-[16px] text-xs font-bold border bg-[#fef7e0] text-[#b06000] border-[#feefc3]">
                <Clock className="w-3.5 h-3.5" />
                <span>Pending Approval</span>
              </span>
            );

            if (isApproved) {
              statusBadge = (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-[16px] text-xs font-bold border bg-[#e8f0fe] text-[#1a73e8] border-[#d2e3fc]">
                  <Truck className="w-3.5 h-3.5" />
                  <span>Approved — Awaiting Receipt</span>
                </span>
              );
            } else if (isPartial) {
              statusBadge = (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-[16px] text-xs font-bold border bg-[#f3e8ff] text-[#7e22ce] border-[#ede9fe]">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Partially Received</span>
                </span>
              );
            } else if (isReceived) {
              statusBadge = (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-[16px] text-xs font-bold border bg-[#e6f4ea] text-[#188038] border-[#ceead6]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Received</span>
                </span>
              );
            } else if (isCancelled) {
              statusBadge = (
                <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-[16px] text-xs font-bold border bg-[#f4f6f9] text-[#5a6675] border-[#e2e8f0]">
                  <Ban className="w-3.5 h-3.5" />
                  <span>Cancelled</span>
                </span>
              );
            }

            const receivedCount = order.receivedQuantity || 0;
            const remainingCount = typeof order.remainingQuantity === 'number'
              ? order.remainingQuantity
              : Math.max(0, order.quantity - receivedCount);

            return (
              <div
                key={order.id}
                className="p-4 bg-white rounded-[16px] border border-[#e2e8f0] m3-elevation-1 hover:m3-elevation-2 transition-all space-y-2.5"
              >
                {/* Header: PO Number + Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono text-[#5a6675] tracking-wide">
                      {order.orderNumber}
                    </div>
                    <h3 className="text-sm font-bold text-[#1f2733] font-['Google_Sans',sans-serif] mt-0.5">
                      {order.materialName}
                    </h3>
                  </div>
                  {statusBadge}
                </div>

                {/* Supplier info (Clearly synthetic) */}
                <div className="bg-[#f4f6f9] p-2.5 rounded-[12px] border border-[#e2e8f0] text-xs space-y-1">
                  <div className="flex items-center justify-between text-[#5a6675]">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-[#1a73e8]" />
                      Supplier:
                    </span>
                    <span className="text-[10px] text-[#b06000] font-medium bg-[#fef7e0] px-1.5 py-0.5 rounded">
                      Synthetic Demo Supplier
                    </span>
                  </div>
                  <div className="font-semibold text-[#1f2733]">{order.supplierName}</div>
                </div>

                {/* Quantities & Pricing Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0]">
                    <span className="text-[10px] text-[#5a6675] block">Order Quantity:</span>
                    <span className="font-bold text-sm text-[#1a73e8] mt-0.5 block">
                      {order.quantity} {order.unit}
                    </span>
                  </div>

                  <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0]">
                    <span className="text-[10px] text-[#5a6675] block">Estimated Total:</span>
                    <span className="font-bold text-sm text-[#1f2733] mt-0.5 block">
                      {order.estimatedCost !== null
                        ? `$${order.estimatedCost.toFixed(2)} USD`
                        : 'Price unavailable'}
                    </span>
                  </div>
                </div>

                {/* Delivery Fulfillment Progress Bar (for approved, partial, received) */}
                {!isPending && !isCancelled && (
                  <div className="space-y-1 bg-[#f4f6f9] p-2.5 rounded-[12px] border border-[#e2e8f0] text-xs">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-[#5a6675] font-medium">Receipt Progress:</span>
                      <span className="font-bold text-[#1f2733]">
                        {receivedCount} of {order.quantity} {order.unit} received
                      </span>
                    </div>
                    <div className="w-full bg-[#e2e8f0] h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${isReceived ? 'bg-[#188038]' : 'bg-[#1a73e8]'}`}
                        style={{ width: `${Math.min(100, Math.round((receivedCount / order.quantity) * 100))}%` }}
                      ></div>
                    </div>
                    {remainingCount > 0 && !isReceived && (
                      <div className="text-[10px] text-[#b06000] text-right font-medium">
                        {remainingCount} {order.unit} outstanding
                      </div>
                    )}
                  </div>
                )}

                {/* Deficit explanation if present */}
                {order.deficitExplanation && (
                  <div className="text-[11px] text-[#5a6675] bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 text-[#1a73e8] flex-shrink-0 mt-0.5" />
                    <span>{order.deficitExplanation}</span>
                  </div>
                )}

                {/* Notes */}
                {order.notes && (
                  <p className="text-xs text-[#5a6675] italic">"{order.notes}"</p>
                )}

                {/* Receipt History Log if present */}
                {order.receipts && order.receipts.length > 0 && (
                  <div className="bg-[#f4f6f9] p-2 rounded-[10px] border border-[#e2e8f0] text-[11px] space-y-1">
                    <span className="font-bold text-[#1f2733] block">Receipt History:</span>
                    {order.receipts.map((rcpt, idx) => (
                      <div key={idx} className="flex justify-between text-[#5a6675] border-t border-[#e2e8f0]/60 pt-1">
                        <span>
                          {rcpt.receiptDate} · Lot: <strong>{rcpt.batchNo}</strong>
                        </span>
                        <span className="font-semibold text-[#188038]">
                          +{rcpt.receivedQuantity} {order.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Status metadata */}
                {order.approvedBy && (
                  <div className="text-[11px] text-[#1a73e8] bg-[#e8f0fe] px-2.5 py-1 rounded-[8px] flex items-center justify-between">
                    <span>Approved by {order.approvedBy}</span>
                    <span>{order.approvedAt ? new Date(order.approvedAt).toLocaleDateString() : ''}</span>
                  </div>
                )}

                {order.cancelledReason && (
                  <div className="text-[11px] text-[#c5221f] bg-[#fce8e6] px-2.5 py-1 rounded-[8px]">
                    Cancelled: {order.cancelledReason}
                  </div>
                )}

                {/* Action Buttons Row */}
                <div className="pt-2 border-t border-[#e2e8f0] flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] text-[#5a6675]">
                    Created: {new Date(order.createdAt).toLocaleDateString()}
                  </span>

                  <div className="flex items-center gap-1.5 ml-auto">
                    {/* Action 1: Receive Items on approved/partial orders */}
                    {(isApproved || isPartial) && (
                      <button
                        type="button"
                        onClick={() => setReceivingOrder(order)}
                        className="h-9 px-3.5 rounded-[12px] bg-[#188038] hover:bg-[#137333] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer m3-elevation-1 transition-all shadow-sm"
                      >
                        <PackageCheck className="w-4 h-4 stroke-[2.5]" />
                        <span>Receive Items</span>
                      </button>
                    )}

                    {/* Action 2: Approve on pending order */}
                    {isPending && (
                      <button
                        type="button"
                        disabled={approvingOrderId === order.id}
                        onClick={() => handleApprove(order)}
                        className="h-9 px-3.5 rounded-[12px] bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer m3-elevation-1 transition-all"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>{approvingOrderId === order.id ? 'Approving...' : 'Approve PO'}</span>
                      </button>
                    )}

                    {/* Action 3: Edit on pending order */}
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(order)}
                        className="h-9 px-3 rounded-[12px] bg-[#f4f6f9] hover:bg-[#e8f0fe] text-[#5a6675] hover:text-[#1a73e8] border border-[#e2e8f0] text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}

                    {/* Action 4: Cancel PO on pending, approved, or partial orders */}
                    {(isPending || isApproved || isPartial) && (
                      <button
                        type="button"
                        disabled={cancellingOrderId === order.id}
                        onClick={() => handleCancelClick(order)}
                        className="h-9 px-2.5 rounded-[12px] text-[#5a6675] hover:text-[#c5221f] hover:bg-[#fce8e6] border border-transparent hover:border-[#fad2cf] text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        title="Cancel Purchase Order"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Select Material Modal to initiate New Draft Requisition */}
      {selectMaterialModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-[380px] bg-white rounded-[20px] shadow-2xl border border-[#e2e8f0] overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-[#e2e8f0] flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#1f2733] font-['Google_Sans',sans-serif]">
                Select Material to Reorder
              </h3>
              <button
                type="button"
                onClick={() => setSelectMaterialModalOpen(false)}
                className="w-7 h-7 rounded-full hover:bg-[#f4f6f9] flex items-center justify-center text-[#5a6675]"
              >
                ✕
              </button>
            </div>
            <div className="p-3 overflow-y-auto space-y-2 flex-1 text-xs">
              {materials.length === 0 ? (
                <div className="p-4 text-center text-[#5a6675]">No materials found in inventory.</div>
              ) : (
                materials.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectMaterialModalOpen(false);
                      onOpenDraftModal(m);
                    }}
                    className="w-full p-2.5 rounded-[12px] border border-[#e2e8f0] hover:border-[#1a73e8] hover:bg-[#e8f0fe] flex items-center justify-between text-left transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-[#1f2733]">{m.name}</div>
                      <div className="text-[11px] text-[#5a6675]">
                        Stock: {m.quantity} {m.unit} · {m.category || 'General'}
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-[#1a73e8]" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-[380px] bg-white rounded-[20px] shadow-2xl border border-[#e2e8f0] overflow-hidden p-5 space-y-4 text-xs">
            <div className="flex justify-between items-center border-b border-[#e2e8f0] pb-3">
              <h3 className="font-bold text-sm text-[#1f2733]">Edit {editingOrder.orderNumber}</h3>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="text-[#5a6675] hover:text-[#1f2733]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="font-semibold text-[#1f2733] block mb-1">
                  Quantity ({editingOrder.unit})
                </label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={editQty}
                  onChange={(e) => setEditQty(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="w-full h-10 px-3 border border-[#e2e8f0] rounded-[10px] text-xs"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-[#1f2733] block mb-1">
                  Supplier
                </label>
                <select
                  value={editSupplierId}
                  onChange={(e) => setEditSupplierId(e.target.value)}
                  className="w-full h-10 px-2 border border-[#e2e8f0] rounded-[10px] text-xs"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-[#1f2733] block mb-1">
                  Unit Price ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Optional"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className="w-full h-10 px-3 border border-[#e2e8f0] rounded-[10px] text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-[#1f2733] block mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2 border border-[#e2e8f0] rounded-[10px] text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="flex-1 h-10 rounded-[12px] border border-[#e2e8f0] font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="flex-1 h-10 rounded-[12px] bg-[#1a73e8] text-white font-semibold"
                >
                  {isSubmittingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* In-App Confirmation Dialog for Cancelling Order (replaces window.confirm) */}
      {orderToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-[380px] bg-white rounded-[20px] shadow-2xl border border-[#e2e8f0] overflow-hidden p-5 space-y-4 text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#fce8e6] text-[#c5221f] flex items-center justify-center flex-shrink-0">
                <Ban className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#1f2733] font-['Google_Sans',sans-serif]">
                  Cancel Purchase Order?
                </h3>
                <p className="text-[11px] text-[#5a6675]">PO {orderToCancel.orderNumber}</p>
              </div>
            </div>

            <p className="text-xs text-[#5a6675] leading-relaxed">
              Are you sure you want to cancel purchase requisition for <strong>{orderToCancel.materialName}</strong> ({orderToCancel.quantity} {orderToCancel.unit})? This will mark the order as cancelled and allow new draft requisitions to be generated if the shortage continues.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOrderToCancel(null)}
                disabled={cancellingOrderId === orderToCancel.id}
                className="flex-1 h-10 rounded-[12px] border border-[#e2e8f0] font-semibold text-[#5a6675] hover:bg-[#f4f6f9] cursor-pointer"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={() => handleConfirmCancel(orderToCancel)}
                disabled={cancellingOrderId === orderToCancel.id}
                className="flex-1 h-10 rounded-[12px] bg-[#c5221f] hover:bg-[#a51d24] text-white font-semibold cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                {cancellingOrderId === orderToCancel.id ? 'Cancelling...' : 'Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Items Modal */}
      <ReceiveItemsModal
        isOpen={!!receivingOrder}
        onClose={() => setReceivingOrder(null)}
        order={receivingOrder}
        materials={materials}
        onReceived={handleReceiptComplete}
      />
    </div>
  );
};
