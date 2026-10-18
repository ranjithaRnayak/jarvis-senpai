import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { MaterialItem, computeMaterialStatus } from './materialService';
import { PurchaseOrder } from './orderService';

export type AlertType = 'expired' | 'expiring_soon' | 'low_stock' | 'stockout_risk';
export type AlertSeverity = 'low' | 'med' | 'high';
export type AlertStatus = 'active' | 'resolved';

export interface AlertEvidence {
  expiryDate?: string;
  daysToExpiry?: number;
  quantity?: number;
  usableStock?: number;
  minThreshold?: number;
  deficit?: number;
  dailyUsageRate?: number;
  supplierLeadDays?: number;
  daysOfStock?: number;
  unit?: string;
  batchNo?: string;
  [key: string]: any;
}

export interface InventoryAlert {
  id: string; // stable: `${materialId}_${type}`
  materialId: string;
  materialName: string;
  batchNo?: string;
  category?: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  reason: string;
  status: AlertStatus;
  evidence: AlertEvidence;
  actionable: boolean; // whether an action button is applicable
  actionType: 'reorder' | 'replacement' | 'view_order' | 'configure';
  linkedOrderId?: string | null;
  linkedOrderNumber?: string | null;
  reorderStatus?: 'none' | 'pending_approval' | 'approved' | 'partially_received' | 'received' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

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
 * Reusable deterministic application logic for computing alerts
 * computeAlerts(materials[], orders[]) -> alerts[]
 * Coordinates alert status with active purchase orders.
 */
export function computeAlerts(
  materials: MaterialItem[],
  orders: PurchaseOrder[] = []
): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nowISO = new Date().toISOString();

  // 1. Group usable (non-expired) stock by product identity (normalized name + category)
  // This ensures replenishment decisions account for all usable batches across the product
  // while NEVER counting expired batches as available stock!
  const productUsableStockMap = new Map<string, number>();

  for (const mat of materials) {
    const status = computeMaterialStatus(mat.expiryDate);
    const key = `${(mat.name || '').trim().toLowerCase()}:::${(mat.category || '').trim().toLowerCase()}`;

    // Only count batches that are NOT expired
    if (status !== 'expired') {
      const current = productUsableStockMap.get(key) || 0;
      productUsableStockMap.set(key, current + (mat.quantity || 0));
    } else {
      // Ensure key is initialized
      if (!productUsableStockMap.has(key)) {
        productUsableStockMap.set(key, 0);
      }
    }
  }

  // Helper to find covering active PO for a material or product
  const findCoveringOrder = (mat: MaterialItem): PurchaseOrder | undefined => {
    return orders.find(
      (o) =>
        (o.materialId === mat.id ||
          ((o.materialName || '').trim().toLowerCase() === (mat.name || '').trim().toLowerCase() &&
            (o.category || '').trim().toLowerCase() === (mat.category || '').trim().toLowerCase())) &&
        (o.status === 'pending_approval' || o.status === 'approved' || o.status === 'partially_received')
    );
  };

  // Helper to find recently cancelled order for display context
  const findCancelledOrder = (mat: MaterialItem): PurchaseOrder | undefined => {
    return orders.find(
      (o) =>
        (o.materialId === mat.id ||
          ((o.materialName || '').trim().toLowerCase() === (mat.name || '').trim().toLowerCase() &&
            (o.category || '').trim().toLowerCase() === (mat.category || '').trim().toLowerCase())) &&
        o.status === 'cancelled'
    );
  };

  for (const rawItem of materials) {
    if (!rawItem.id) continue;

    // Material fields may be null when a label value wasn't readable; normalize for alert math
    const item = {
      ...rawItem,
      id: rawItem.id,
      quantity: rawItem.quantity ?? 0,
      unit: rawItem.unit ?? undefined,
      batchNo: rawItem.batchNo ?? undefined,
      category: rawItem.category ?? undefined,
    };

    const prodKey = `${(item.name || '').trim().toLowerCase()}:::${(item.category || '').trim().toLowerCase()}`;
    const usableStock = productUsableStockMap.get(prodKey) ?? item.quantity;
    const activeCoveringPO = findCoveringOrder(rawItem);
    const cancelledPO = !activeCoveringPO ? findCancelledOrder(rawItem) : undefined;

    // -------------------------------------------------------------
    // A. EXPIRY ALERTS (Batch-specific)
    // -------------------------------------------------------------
    if (item.expiryDate) {
      const parts = item.expiryDate.split('-');
      let expiry: Date | null = null;
      if (parts.length === 3) {
        expiry = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        const parsed = new Date(item.expiryDate);
        if (!isNaN(parsed.getTime())) {
          expiry = parsed;
        }
      }

      if (expiry && !isNaN(expiry.getTime())) {
        expiry.setHours(0, 0, 0, 0);
        const diffMs = expiry.getTime() - now.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          // Already expired batch
          const daysPast = Math.abs(diffDays);
          const hasCoveringOrder = !!activeCoveringPO;

          let msg = `Batch is expired (${daysPast} day${daysPast === 1 ? '' : 's'} ago)`;
          if (activeCoveringPO) {
            if (activeCoveringPO.status === 'approved') {
              msg += ` — Replacement approved (${activeCoveringPO.orderNumber})`;
            } else if (activeCoveringPO.status === 'pending_approval') {
              msg += ` — Replacement draft pending (${activeCoveringPO.orderNumber})`;
            } else if (activeCoveringPO.status === 'partially_received') {
              msg += ` — Partial replacement received (${activeCoveringPO.receivedQuantity}/${activeCoveringPO.quantity})`;
            }
          }

          alerts.push({
            id: `${item.id}_expired`,
            materialId: item.id,
            materialName: item.name,
            batchNo: item.batchNo,
            category: item.category,
            type: 'expired',
            severity: 'high',
            message: msg,
            reason: `Batch ${item.batchNo || 'N/A'} expired on ${item.expiryDate}. Unsafe for consumption/use; quarantine batch and order fresh replacement. Note: Receiving fresh stock does not make this expired batch usable.`,
            status: 'active',
            actionable: !hasCoveringOrder,
            actionType: hasCoveringOrder ? 'view_order' : 'replacement',
            linkedOrderId: activeCoveringPO?.id || (cancelledPO ? cancelledPO.id : null),
            linkedOrderNumber: activeCoveringPO?.orderNumber || (cancelledPO ? cancelledPO.orderNumber : null),
            reorderStatus: activeCoveringPO ? activeCoveringPO.status : cancelledPO ? 'cancelled' : 'none',
            evidence: {
              expiryDate: item.expiryDate,
              daysToExpiry: diffDays,
              quantity: item.quantity,
              usableStock,
              unit: item.unit,
              batchNo: item.batchNo,
            },
            createdAt: nowISO,
            updatedAt: nowISO,
          });
        } else if (diffDays <= 14) {
          // Expiring within 14 days
          const severity: AlertSeverity = diffDays <= 3 ? 'high' : diffDays <= 7 ? 'med' : 'low';
          let msg = diffDays === 0 ? 'Batch expires today' : `Batch expires in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
          const hasCoveringOrder = !!activeCoveringPO;

          if (activeCoveringPO) {
            if (activeCoveringPO.status === 'approved') {
              msg += ` — Replacement approved (${activeCoveringPO.orderNumber})`;
            } else if (activeCoveringPO.status === 'pending_approval') {
              msg += ` — Replacement pending (${activeCoveringPO.orderNumber})`;
            } else if (activeCoveringPO.status === 'partially_received') {
              msg += ` — Partial replacement received`;
            }
          }

          alerts.push({
            id: `${item.id}_expiring_soon`,
            materialId: item.id,
            materialName: item.name,
            batchNo: item.batchNo,
            category: item.category,
            type: 'expiring_soon',
            severity,
            message: msg,
            reason: `Batch ${item.batchNo || 'N/A'} reaches end of shelf life on ${item.expiryDate} (${diffDays} days remaining). Expedite usage or prepare replacement order.`,
            status: 'active',
            actionable: !hasCoveringOrder,
            actionType: hasCoveringOrder ? 'view_order' : 'replacement',
            linkedOrderId: activeCoveringPO?.id || (cancelledPO ? cancelledPO.id : null),
            linkedOrderNumber: activeCoveringPO?.orderNumber || (cancelledPO ? cancelledPO.orderNumber : null),
            reorderStatus: activeCoveringPO ? activeCoveringPO.status : cancelledPO ? 'cancelled' : 'none',
            evidence: {
              expiryDate: item.expiryDate,
              daysToExpiry: diffDays,
              quantity: item.quantity,
              usableStock,
              unit: item.unit,
              batchNo: item.batchNo,
            },
            createdAt: nowISO,
            updatedAt: nowISO,
          });
        }
      }
    }

    // -------------------------------------------------------------
    // B. LOW STOCK ALERTS (Based on Valid Usable Stock)
    // -------------------------------------------------------------
    // Only check if minThreshold is explicitly configured on the item
    if (typeof item.minThreshold === 'number' && !isNaN(item.minThreshold)) {
      if (usableStock <= item.minThreshold) {
        const isOutOfStock = usableStock <= 0;
        const deficit = Math.max(0, item.minThreshold - usableStock);
        const severity: AlertSeverity = isOutOfStock
          ? 'high'
          : usableStock <= item.minThreshold * 0.5
          ? 'high'
          : 'med';

        const hasCoveringOrder = !!activeCoveringPO;
        let baseMsg = isOutOfStock
          ? `Stockout: 0 ${item.unit} usable stock remaining`
          : `Low Stock: ${usableStock} ${item.unit} usable stock (Min: ${item.minThreshold})`;

        if (activeCoveringPO) {
          if (activeCoveringPO.status === 'approved') {
            baseMsg = `Reorder approved — awaiting stock receipt (${activeCoveringPO.orderNumber})`;
          } else if (activeCoveringPO.status === 'pending_approval') {
            baseMsg = `Reorder draft pending approval (${activeCoveringPO.orderNumber})`;
          } else if (activeCoveringPO.status === 'partially_received') {
            baseMsg = `Partially received (${activeCoveringPO.receivedQuantity}/${activeCoveringPO.quantity} ${item.unit}, ${activeCoveringPO.orderNumber})`;
          }
        }

        alerts.push({
          id: `${item.id}_low_stock`,
          materialId: item.id,
          materialName: item.name,
          batchNo: item.batchNo,
          category: item.category,
          type: 'low_stock',
          severity,
          message: baseMsg,
          reason: `Current usable stock of ${usableStock} ${item.unit} is at or below the safety threshold of ${item.minThreshold} ${item.unit} (deficit: ${deficit} ${item.unit}).${
            activeCoveringPO
              ? ` Active PO ${activeCoveringPO.orderNumber} covers ${activeCoveringPO.quantity} ${item.unit} (status: ${activeCoveringPO.status}).`
              : cancelledPO
              ? ` Note: Previous PO ${cancelledPO.orderNumber} was cancelled. A new reorder draft is recommended.`
              : ''
          }`,
          status: 'active',
          actionable: !hasCoveringOrder,
          actionType: hasCoveringOrder ? 'view_order' : 'reorder',
          linkedOrderId: activeCoveringPO?.id || (cancelledPO ? cancelledPO.id : null),
          linkedOrderNumber: activeCoveringPO?.orderNumber || (cancelledPO ? cancelledPO.orderNumber : null),
          reorderStatus: activeCoveringPO ? activeCoveringPO.status : cancelledPO ? 'cancelled' : 'none',
          evidence: {
            quantity: item.quantity,
            usableStock,
            minThreshold: item.minThreshold,
            deficit,
            unit: item.unit,
            coveringOrderNumber: activeCoveringPO?.orderNumber,
            coveringOrderStatus: activeCoveringPO?.status,
          },
          createdAt: nowISO,
          updatedAt: nowISO,
        });
      }
    }

    // -------------------------------------------------------------
    // C. OPTIONAL STOCK-OUT RISK (Based on Valid Usable Stock)
    // -------------------------------------------------------------
    if (
      typeof item.dailyUsageRate === 'number' &&
      item.dailyUsageRate > 0 &&
      typeof item.supplierLeadDays === 'number' &&
      item.supplierLeadDays > 0
    ) {
      const daysOfStock = usableStock / item.dailyUsageRate;
      if (daysOfStock <= item.supplierLeadDays) {
        const severity: AlertSeverity =
          daysOfStock <= Math.max(1, item.supplierLeadDays * 0.5) ? 'high' : 'med';

        const hasCoveringOrder = !!activeCoveringPO;
        let baseMsg = `Stockout Risk: ~${daysOfStock.toFixed(1)} days of stock (Lead time: ${item.supplierLeadDays}d)`;

        if (activeCoveringPO) {
          if (activeCoveringPO.status === 'approved') {
            baseMsg = `Reorder approved — awaiting stock receipt (${activeCoveringPO.orderNumber})`;
          } else if (activeCoveringPO.status === 'pending_approval') {
            baseMsg = `Reorder draft pending approval (${activeCoveringPO.orderNumber})`;
          } else if (activeCoveringPO.status === 'partially_received') {
            baseMsg = `Partially received (${activeCoveringPO.receivedQuantity}/${activeCoveringPO.quantity} ${item.unit})`;
          }
        }

        alerts.push({
          id: `${item.id}_stockout_risk`,
          materialId: item.id,
          materialName: item.name,
          batchNo: item.batchNo,
          category: item.category,
          type: 'stockout_risk',
          severity,
          message: baseMsg,
          reason: `At daily consumption of ${item.dailyUsageRate} ${item.unit}/day, existing usable stock will be exhausted in ~${daysOfStock.toFixed(1)} days, which is within the supplier lead time (${item.supplierLeadDays} days).${
            activeCoveringPO
              ? ` Active PO ${activeCoveringPO.orderNumber} is in progress (${activeCoveringPO.status}).`
              : ''
          }`,
          status: 'active',
          actionable: !hasCoveringOrder,
          actionType: hasCoveringOrder ? 'view_order' : 'reorder',
          linkedOrderId: activeCoveringPO?.id || (cancelledPO ? cancelledPO.id : null),
          linkedOrderNumber: activeCoveringPO?.orderNumber || (cancelledPO ? cancelledPO.orderNumber : null),
          reorderStatus: activeCoveringPO ? activeCoveringPO.status : cancelledPO ? 'cancelled' : 'none',
          evidence: {
            quantity: item.quantity,
            usableStock,
            dailyUsageRate: item.dailyUsageRate,
            supplierLeadDays: item.supplierLeadDays,
            daysOfStock: parseFloat(daysOfStock.toFixed(1)),
            unit: item.unit,
            coveringOrderNumber: activeCoveringPO?.orderNumber,
            coveringOrderStatus: activeCoveringPO?.status,
          },
          createdAt: nowISO,
          updatedAt: nowISO,
        });
      }
    }
  }

  // Sort alerts by severity (high -> med -> low)
  const severityOrder: Record<AlertSeverity, number> = { high: 0, med: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

// In-memory fallback cache for alerts if Firestore access is limited
let cachedActiveAlerts: InventoryAlert[] = [];

/**
 * Persists computed alerts to the Firestore "alerts" collection
 * with deduplication and automated resolution of stale alerts.
 */
export async function syncAlertsWithFirestore(
  computed: InventoryAlert[],
  materials: MaterialItem[]
): Promise<void> {
  cachedActiveAlerts = [...computed];
  const activeIds = new Set(computed.map((a) => a.id));
  const materialIds = new Set(materials.map((m) => m.id).filter(Boolean));

  try {
    // Write or update all active alerts
    for (const alert of computed) {
      const alertRef = doc(db, 'alerts', alert.id);
      const rawPayload = {
        materialId: alert.materialId,
        materialName: alert.materialName,
        batchNo: alert.batchNo || 'N/A',
        category: alert.category || 'General',
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        reason: alert.reason,
        status: 'active',
        evidence: alert.evidence,
        actionable: alert.actionable,
        actionType: alert.actionType,
        linkedOrderId: alert.linkedOrderId || null,
        linkedOrderNumber: alert.linkedOrderNumber || null,
        reorderStatus: alert.reorderStatus || 'none',
        updatedAt: new Date().toISOString(),
        createdAt: alert.createdAt,
      };

      await setDoc(alertRef, cleanFirestoreData(rawPayload), { merge: true });
    }

    // Check for existing alerts in Firestore to resolve stale ones
    const snapshot = await getDocs(collection(db, 'alerts'));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const alertId = docSnap.id;
      // If alert was for a deleted material or condition is no longer active
      if (data.status === 'active' && (!activeIds.has(alertId) || !materialIds.has(data.materialId))) {
        await updateDoc(doc(db, 'alerts', alertId), {
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    // Non-fatal: if rules do not permit writes yet or offline, report and preserve local cache
    console.warn('Firestore alerts sync notice:', error);
    handleFirestoreError(error, OperationType.WRITE, 'alerts');
  }
}

/**
 * Subscribes to real-time alerts from Firestore "alerts" collection
 */
export function subscribeAlerts(
  onUpdate: (alerts: InventoryAlert[]) => void,
  onError?: (err: any) => void
): () => void {
  const path = 'alerts';
  try {
    const q = query(collection(db, path));
    return onSnapshot(
      q,
      (snapshot) => {
        const items: InventoryAlert[] = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<InventoryAlert, 'id'>),
          }))
          .filter((a) => a.status === 'active');

        const severityOrder: Record<AlertSeverity, number> = { high: 0, med: 1, low: 2 };
        items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        cachedActiveAlerts = items;
        onUpdate(items);
      },
      (error) => {
        console.warn('Firestore alerts subscription error, falling back to cached alerts:', error);
        if (onError) onError(error);
        onUpdate(cachedActiveAlerts);
      }
    );
  } catch (err) {
    console.warn('subscribeAlerts caught error:', err);
    if (onError) onError(err);
    onUpdate(cachedActiveAlerts);
    return () => {};
  }
}

export function getCachedAlerts(): InventoryAlert[] {
  return cachedActiveAlerts;
}
