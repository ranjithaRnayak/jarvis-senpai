import {
  collection,
  addDoc,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { MaterialItem, getMaterialById, calculateExpiryDate, computeMaterialStatus } from './materialService';
import { getSuppliers, getSupplierById, getSuggestedSupplierForCategory, Supplier } from './supplierService';

export type OrderStatus =
  | 'pending_approval'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface ReceiptRecord {
  id: string;
  receivedQuantity: number;
  batchNo: string;
  receiptDate: string; // YYYY-MM-DD
  expiryDate?: string; // YYYY-MM-DD
  shelfLifeDays?: number;
  notes?: string;
  targetMaterialId: string;
  isNewBatch: boolean;
  receivedAt: string; // ISO timestamp
  receivedBy: string;
}

export interface PurchaseOrder {
  id?: string;
  orderNumber: string;
  materialId: string;
  materialName: string;
  category?: string;
  supplierId: string;
  supplierName: string;
  isSyntheticSupplier: boolean;
  supplierNotes?: string;
  quantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  unit: string;
  unitPrice: number | null; // null if unknown
  estimatedCost: number | null; // calculated only if unitPrice is known
  currency: string;
  status: OrderStatus;
  orderType: 'reorder' | 'replacement' | 'manual';
  deficitExplanation?: string;
  notes?: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
  receipts?: ReceiptRecord[];
  createdAt: string;
  updatedAt: string;
}

// In-memory fallback cache for orders if Firestore permissions or offline state occurs
let cachedOrders: PurchaseOrder[] = [];

function cleanFirestoreData(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        cleaned[key] = cleanFirestoreData(val);
      } else {
        cleaned[key] = val;
      }
    }
  }
  return cleaned;
}

/**
 * Creates a draft purchase order model for a given material.
 * draftOrder(materialId)
 * Loads the actual material from Firestore, resolves supplier,
 * calculates suggested quantity, and calculates estimated cost only when price is known.
 */
export async function draftOrder(
  materialOrId: string | MaterialItem,
  options?: {
    customQuantity?: number;
    customSupplierId?: string;
    customUnitPrice?: number;
    orderType?: 'reorder' | 'replacement' | 'manual';
    notes?: string;
  }
): Promise<PurchaseOrder> {
  let material: MaterialItem | null = null;
  if (typeof materialOrId === 'string') {
    material = await getMaterialById(materialOrId);
    if (!material) {
      throw new Error(`Material with ID "${materialOrId}" was not found.`);
    }
  } else {
    material = materialOrId;
  }

  // 1. Resolve Supplier
  const allSuppliers = getSuppliers();
  let resolvedSupplier: Supplier | undefined;

  if (options?.customSupplierId) {
    resolvedSupplier = getSupplierById(options.customSupplierId);
  } else if (material.supplierId) {
    resolvedSupplier = getSupplierById(material.supplierId);
  }

  if (!resolvedSupplier) {
    resolvedSupplier = getSuggestedSupplierForCategory(material.category ?? undefined);
  }

  // 2. Determine Suggested Quantity & Deficit Explanation
  let suggestedQuantity = 1;
  let deficitExplanation: string | undefined;

  if (typeof options?.customQuantity === 'number' && options.customQuantity > 0) {
    suggestedQuantity = options.customQuantity;
  } else if (typeof material.targetStockLevel === 'number' && material.targetStockLevel > 0) {
    suggestedQuantity = Math.max(0, material.targetStockLevel - (material.quantity ?? 0));
    deficitExplanation = `Calculated to reach configured Target Stock Level of ${material.targetStockLevel} ${material.unit} (Current: ${(material.quantity ?? 0)} ${material.unit}).`;
  } else if (typeof material.minThreshold === 'number' && material.minThreshold > 0) {
    const deficit = Math.max(0, material.minThreshold - (material.quantity ?? 0));
    suggestedQuantity = deficit > 0 ? deficit : 1;
    deficitExplanation = `Minimum-threshold deficit: ${deficit} ${material.unit} (Current: ${material.quantity} ${material.unit}, Min Threshold: ${material.minThreshold} ${material.unit}). This reflects safety deficit, not optimized economic order quantity.`;
  } else {
    suggestedQuantity = 1;
    deficitExplanation = `Standard quantity of 1 ${material.unit} (Stock thresholds not configured on material).`;
  }

  if (suggestedQuantity <= 0) {
    suggestedQuantity = 1;
  }

  // 3. Determine Known Unit Price & Calculate Estimated Cost
  // Never invent a price! Only calculate when price is verified or entered.
  const knownUnitPrice: number | null =
    typeof options?.customUnitPrice === 'number' && options.customUnitPrice >= 0
      ? options.customUnitPrice
      : typeof material.unitPrice === 'number' && material.unitPrice >= 0
      ? material.unitPrice
      : null;

  const estimatedCost: number | null =
    knownUnitPrice !== null ? Number((suggestedQuantity * knownUnitPrice).toFixed(2)) : null;

  const nowISO = new Date().toISOString();
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `PO-${year}-${randomSuffix}`;

  const draft: PurchaseOrder = {
    orderNumber,
    materialId: material.id || 'unassigned',
    materialName: material.name,
    category: material.category ?? undefined,
    supplierId: resolvedSupplier.id,
    supplierName: resolvedSupplier.name,
    isSyntheticSupplier: resolvedSupplier.isSynthetic,
    supplierNotes: resolvedSupplier.notes,
    quantity: suggestedQuantity,
    receivedQuantity: 0,
    remainingQuantity: suggestedQuantity,
    unit: material.unit || 'pcs',
    unitPrice: knownUnitPrice,
    estimatedCost,
    currency: 'USD',
    status: 'pending_approval',
    orderType: options?.orderType || 'reorder',
    deficitExplanation,
    notes: options?.notes || '',
    approvedAt: null,
    approvedBy: null,
    cancelledAt: null,
    cancelledReason: null,
    receipts: [],
    createdAt: nowISO,
    updatedAt: nowISO,
  };

  return draft;
}

/**
 * Saves a draft order to the Firestore "orders" collection
 */
export async function saveOrderToFirestore(order: Omit<PurchaseOrder, 'id'>): Promise<string> {
  const path = 'orders';
  const orderWithStatus: Omit<PurchaseOrder, 'id'> = {
    ...order,
    status: 'pending_approval', // Strictly pending_approval on initial save
    receivedQuantity: order.receivedQuantity || 0,
    remainingQuantity: typeof order.remainingQuantity === 'number' ? order.remainingQuantity : order.quantity,
    receipts: order.receipts || [],
    createdAt: order.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const payload = cleanFirestoreData(orderWithStatus) as Omit<PurchaseOrder, 'id'>;

  try {
    const docRef = await addDoc(collection(db, path), payload);
    const newOrder: PurchaseOrder = { id: docRef.id, ...orderWithStatus };
    cachedOrders = [newOrder, ...cachedOrders.filter((o) => o.id !== docRef.id)];
    return docRef.id;
  } catch (error) {
    console.warn('Firestore orders save warning:', error);
    // Fallback: save to local cache so user can still see and approve orders
    const fakeId = `local_po_${Date.now()}`;
    const fallbackOrder: PurchaseOrder = { id: fakeId, ...orderWithStatus };
    cachedOrders = [fallbackOrder, ...cachedOrders];
    handleFirestoreError(error, OperationType.CREATE, path);
    return fakeId;
  }
}

/**
 * Updates a purchase order in Firestore
 */
export async function updateOrderInFirestore(
  orderId: string,
  updates: Partial<PurchaseOrder>
): Promise<void> {
  const path = `orders/${orderId}`;
  const updatedPayload = cleanFirestoreData({
    ...updates,
    updatedAt: new Date().toISOString(),
  });

  try {
    if (!orderId.startsWith('local_po_')) {
      await updateDoc(doc(db, 'orders', orderId), updatedPayload);
    }
    cachedOrders = cachedOrders.map((o) =>
      o.id === orderId ? { ...o, ...updatedPayload } : o
    );
  } catch (error) {
    console.warn('Firestore update order warning:', error);
    cachedOrders = cachedOrders.map((o) =>
      o.id === orderId ? { ...o, ...updatedPayload } : o
    );
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

/**
 * Human approval action: updates order status from pending_approval to approved.
 * IMPORTANT: Approval is NOT receipt of goods. Does NOT increase inventory.
 */
export async function approveOrderInFirestore(
  orderId: string,
  approverName: string = 'Current User'
): Promise<void> {
  const path = `orders/${orderId}`;
  const approvalPayload = {
    status: 'approved' as OrderStatus,
    approvedAt: new Date().toISOString(),
    approvedBy: approverName,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (!orderId.startsWith('local_po_')) {
      await updateDoc(doc(db, 'orders', orderId), approvalPayload);
    }
    cachedOrders = cachedOrders.map((o) =>
      o.id === orderId ? { ...o, ...approvalPayload } : o
    );
  } catch (error) {
    console.warn('Firestore approve order warning:', error);
    cachedOrders = cachedOrders.map((o) =>
      o.id === orderId ? { ...o, ...approvalPayload } : o
    );
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

/**
 * Cancels a purchase order.
 * Restores the ability to draft a new reorder when stock condition remains.
 */
export async function cancelOrderInFirestore(
  orderId: string,
  reason: string = 'Cancelled by user'
): Promise<void> {
  const path = `orders/${orderId}`;
  const cancelPayload = {
    status: 'cancelled' as OrderStatus,
    cancelledAt: new Date().toISOString(),
    cancelledReason: reason,
    updatedAt: new Date().toISOString(),
  };

  try {
    if (!orderId.startsWith('local_po_')) {
      await updateDoc(doc(db, 'orders', orderId), cancelPayload);
    }
    cachedOrders = cachedOrders.map((o) =>
      o.id === orderId ? { ...o, ...cancelPayload } : o
    );
  } catch (error) {
    console.warn('Firestore cancel order warning:', error);
    cachedOrders = cachedOrders.map((o) =>
      o.id === orderId ? { ...o, ...cancelPayload } : o
    );
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

export interface ReceiveItemsPayload {
  receivedQuantity: number;
  batchNo: string;
  receiptDate: string; // YYYY-MM-DD
  expiryDate?: string; // YYYY-MM-DD
  shelfLifeDays?: number;
  notes?: string;
  isNewBatch: boolean;
  receivedBy?: string;
}

export interface ReceiveItemsResult {
  updatedOrder: PurchaseOrder;
  targetMaterialId: string;
  isNewBatch: boolean;
  inventoryQuantityAdded: number;
}

/**
 * Receive Items workflow:
 * Validates received quantities, persists receipt to inventory with strict batch & expiry safety,
 * updates PO status to partially_received or received, and appends the receipt record.
 */
export async function receiveOrderItems(
  orderId: string,
  payload: ReceiveItemsPayload
): Promise<ReceiveItemsResult> {
  // 1. Locate the order
  let order = cachedOrders.find((o) => o.id === orderId);
  if (!order && !orderId.startsWith('local_po_')) {
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (snap.exists()) {
      order = { id: snap.id, ...(snap.data() as Omit<PurchaseOrder, 'id'>) };
    }
  }

  if (!order) {
    throw new Error(`Order ${orderId} was not found.`);
  }

  if (order.status !== 'approved' && order.status !== 'partially_received') {
    throw new Error(`Cannot receive items for order with status "${order.status}". Order must be approved first.`);
  }

  // 2. Validate quantities
  const currentReceived = order.receivedQuantity || 0;
  const currentRemaining = typeof order.remainingQuantity === 'number' ? order.remainingQuantity : Math.max(0, order.quantity - currentReceived);

  if (payload.receivedQuantity <= 0) {
    throw new Error('Received quantity must be greater than zero.');
  }

  if (payload.receivedQuantity > currentRemaining) {
    throw new Error(
      `Cannot receive ${payload.receivedQuantity} ${order.unit}. Only ${currentRemaining} ${order.unit} remaining on order ${order.orderNumber}.`
    );
  }

  const newReceived = currentReceived + payload.receivedQuantity;
  const newRemaining = Math.max(0, order.quantity - newReceived);
  const newStatus: OrderStatus = newRemaining === 0 ? 'received' : 'partially_received';

  // 3. Batch & Expiry Safety checks
  const targetMat = await getMaterialById(order.materialId);
  const isTargetExpired = targetMat ? computeMaterialStatus(targetMat.expiryDate) === 'expired' : false;

  // SAFETY RULE: Never add incoming stock to an expired batch!
  let isNewBatch = payload.isNewBatch;
  if (isTargetExpired) {
    isNewBatch = true;
  }

  let targetMaterialId = order.materialId;

  // 4. Persist inventory update to Firestore
  if (isNewBatch || !targetMat) {
    // Create new batch material document
    const shelfLife = payload.shelfLifeDays || targetMat?.shelfLifeDays || 90;
    const expiry = payload.expiryDate || calculateExpiryDate(payload.receiptDate, shelfLife);
    const newMaterialData = cleanFirestoreData({
      name: targetMat ? targetMat.name : order.materialName,
      category: targetMat?.category || order.category || 'General',
      batchNo: payload.batchNo || `LOT-RCV-${Date.now().toString().slice(-4)}`,
      purchaseDate: payload.receiptDate || new Date().toISOString().split('T')[0],
      shelfLifeDays: shelfLife,
      expiryDate: expiry,
      quantity: payload.receivedQuantity,
      unit: order.unit,
      confidence: 1.0, // Human verified physical receipt
      status: computeMaterialStatus(expiry),
      createdAt: new Date().toISOString(),
      // Carry forward threshold configuration from original product definition
      minThreshold: targetMat?.minThreshold,
      targetStockLevel: targetMat?.targetStockLevel,
      dailyUsageRate: targetMat?.dailyUsageRate,
      supplierLeadDays: targetMat?.supplierLeadDays,
      supplierId: targetMat?.supplierId || order.supplierId,
      unitPrice: targetMat?.unitPrice ?? order.unitPrice ?? undefined,
    });

    try {
      const docRef = await addDoc(collection(db, 'materials'), newMaterialData);
      targetMaterialId = docRef.id;
    } catch (err) {
      console.error('Failed to create new material batch on receipt:', err);
      handleFirestoreError(err, OperationType.CREATE, 'materials');
      throw new Error(`Failed to persist new inventory batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Add to existing unexpired batch
    try {
      const newQuantity = (targetMat.quantity || 0) + payload.receivedQuantity;
      await updateDoc(doc(db, 'materials', targetMat.id!), {
        quantity: newQuantity,
        updatedAt: new Date().toISOString(),
      });
      targetMaterialId = targetMat.id!;
    } catch (err) {
      console.error('Failed to update existing material quantity on receipt:', err);
      handleFirestoreError(err, OperationType.UPDATE, `materials/${targetMat.id}`);
      throw new Error(`Failed to update inventory quantity: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. Create Receipt Record
  const receiptRecord: ReceiptRecord = {
    id: `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    receivedQuantity: payload.receivedQuantity,
    batchNo: payload.batchNo,
    receiptDate: payload.receiptDate,
    expiryDate: payload.expiryDate,
    shelfLifeDays: payload.shelfLifeDays,
    notes: payload.notes,
    targetMaterialId,
    isNewBatch,
    receivedAt: new Date().toISOString(),
    receivedBy: payload.receivedBy || 'Inventory Specialist',
  };

  const updatedReceipts = [...(order.receipts || []), receiptRecord];

  // 6. Update Order in Firestore
  const orderUpdates = cleanFirestoreData({
    receivedQuantity: newReceived,
    remainingQuantity: newRemaining,
    status: newStatus,
    receipts: updatedReceipts,
    updatedAt: new Date().toISOString(),
  });

  try {
    if (!orderId.startsWith('local_po_')) {
      await updateDoc(doc(db, 'orders', orderId), orderUpdates);
    }
    const updatedOrder: PurchaseOrder = {
      ...order,
      receivedQuantity: newReceived,
      remainingQuantity: newRemaining,
      status: newStatus,
      receipts: updatedReceipts,
      updatedAt: new Date().toISOString(),
    };
    cachedOrders = cachedOrders.map((o) => (o.id === orderId ? updatedOrder : o));

    return {
      updatedOrder,
      targetMaterialId,
      isNewBatch,
      inventoryQuantityAdded: payload.receivedQuantity,
    };
  } catch (err) {
    console.error('Failed to update purchase order receipt status in Firestore:', err);
    handleFirestoreError(err, OperationType.UPDATE, `orders/${orderId}`);
    throw new Error(`Failed to update purchase order receipt status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Subscribes to real-time purchase orders from Firestore "orders" collection
 */
export function subscribeOrders(
  onUpdate: (orders: PurchaseOrder[]) => void,
  onError?: (err: any) => void
): () => void {
  const path = 'orders';
  try {
    const q = query(collection(db, path));
    return onSnapshot(
      q,
      (snapshot) => {
        const items: PurchaseOrder[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const quantity = typeof data.quantity === 'number' ? data.quantity : 1;
          const receivedQuantity = typeof data.receivedQuantity === 'number' ? data.receivedQuantity : 0;
          const remainingQuantity = typeof data.remainingQuantity === 'number' ? data.remainingQuantity : Math.max(0, quantity - receivedQuantity);

          return {
            id: docSnap.id,
            ...(data as Omit<PurchaseOrder, 'id'>),
            quantity,
            receivedQuantity,
            remainingQuantity,
            receipts: data.receipts || [],
          };
        });

        // Sort by createdAt desc
        items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        cachedOrders = items;
        onUpdate(items);
      },
      (error) => {
        console.warn('Firestore orders subscription warning, using local cache:', error);
        if (onError) onError(error);
        onUpdate(cachedOrders);
      }
    );
  } catch (err) {
    console.warn('subscribeOrders caught error:', err);
    if (onError) onError(err);
    onUpdate(cachedOrders);
    return () => {};
  }
}

export function getCachedOrders(): PurchaseOrder[] {
  return cachedOrders;
}
