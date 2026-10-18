import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  where,
  deleteDoc,
  doc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ExtractionResult } from './gemini';

export interface MaterialItem {
  id?: string;
  name: string;
  category: string | null;
  batchNo: string | null;
  purchaseDate: string | null;
  shelfLifeDays: number;
  expiryDate: string | null;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  status: 'ok' | 'expiring' | 'expired';
  createdAt: string;

  // Optional stock & replenishment threshold settings
  minThreshold?: number;
  targetStockLevel?: number;
  dailyUsageRate?: number;
  supplierLeadDays?: number;
  supplierId?: string;
  unitPrice?: number;
}

export interface BatchUsageLog {
  id?: string;
  batchNo: string;
  materialId?: string;
  materialName?: string;
  action: 'initial_stock' | 'dispensed' | 'qc_inspection' | 'adjustment' | 'disposed';
  quantityChange: number; // e.g. -5, +20, etc.
  remainingQuantity?: number;
  unit: string;
  purposeOrNotes: string;
  operator: string;
  timestamp: string;
}

/**
 * Calculates expiryDate = purchaseDate + shelfLifeDays
 * Returns ISO date string YYYY-MM-DD or null if purchaseDate is not provided
 */
export function calculateExpiryDate(purchaseDateStr: string | null | undefined, shelfLifeDays: number = 90): string | null {
  if (!purchaseDateStr) return null;
  try {
    const parts = purchaseDateStr.split('-');
    let date: Date;
    if (parts.length === 3) {
      date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      date = new Date(purchaseDateStr);
    }

    if (isNaN(date.getTime())) {
      return null;
    }

    date.setDate(date.getDate() + shelfLifeDays);
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Computes dynamic status:
 * - Red 'expired': expiry date is in the past
 * - Amber 'expiring': expiry date is within 7 days
 * - Green 'ok': expiry date is > 7 days away or valid
 */
export function computeMaterialStatus(expiryDateStr: string | null | undefined): 'ok' | 'expiring' | 'expired' {
  if (!expiryDateStr) return 'ok';
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const parts = expiryDateStr.split('-');
    let expiry: Date;
    if (parts.length === 3) {
      expiry = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      expiry = new Date(expiryDateStr);
    }

    if (isNaN(expiry.getTime())) return 'ok';
    expiry.setHours(0, 0, 0, 0);

    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return 'expired';
    } else if (diffDays <= 7) {
      return 'expiring';
    } else {
      return 'ok';
    }
  } catch {
    return 'ok';
  }
}

/**
 * Writes an extracted material result to Firestore collection "materials"
 * with expiryDate = purchaseDate + shelfLifeDays and status "ok",
 * and automatically logs the initial receipt into "batchUsageLogs".
 */
export async function saveMaterialToFirestore(
  extracted: ExtractionResult,
  shelfLifeDays: number = 90
): Promise<string> {
  const expiryDate = calculateExpiryDate(extracted.purchaseDate, shelfLifeDays);

  const newMaterial: Omit<MaterialItem, 'id'> = {
    name: extracted.name || 'Unnamed Material',
    category: extracted.category ?? null,
    batchNo: extracted.batchNo ?? null,
    purchaseDate: extracted.purchaseDate ?? null,
    shelfLifeDays,
    expiryDate,
    quantity: extracted.quantity ?? null,
    unit: extracted.unit ?? null,
    confidence: extracted.confidence ?? 0,
    status: 'ok', // explicitly written as "ok" per prompt requirements
    createdAt: new Date().toISOString(),
  };

  const path = 'materials';
  try {
    const docRef = await addDoc(collection(db, path), newMaterial);

    // If batchNo exists, create the initial intake log entry in batchUsageLogs
    if (newMaterial.batchNo) {
      const logPath = 'batchUsageLogs';
      const initialLog: Omit<BatchUsageLog, 'id'> = {
        batchNo: newMaterial.batchNo,
        materialId: docRef.id,
        materialName: newMaterial.name,
        action: 'initial_stock',
        quantityChange: newMaterial.quantity || 0,
        remainingQuantity: newMaterial.quantity || 0,
        unit: newMaterial.unit || 'units',
        purposeOrNotes: `Initial receipt into inventory via scanner extraction (Batch: ${newMaterial.batchNo})`,
        operator: 'Jarvis Senpai AI System',
        timestamp: new Date().toISOString(),
      };
      await addDoc(collection(db, logPath), initialLog).catch((err) => {
        console.warn('Could not record initial batch intake log:', err);
      });
    }

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

/**
 * Subscribes to the real-time materials list from Firestore
 */
export function subscribeMaterials(
  onUpdate: (items: MaterialItem[]) => void,
  onError?: (err: any) => void
): () => void {
  const path = 'materials';
  const q = query(collection(db, path));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: MaterialItem[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Omit<MaterialItem, 'id'>;
        return {
          id: docSnap.id,
          ...data,
        };
      });

      // Sort by createdAt desc
      items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

/**
 * Delete a material document
 */
export async function deleteMaterial(id: string): Promise<void> {
  const path = `materials/${id}`;
  try {
    await deleteDoc(doc(db, 'materials', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Fetches all material entries matching a specific Batch/LOT number from Firestore
 */
export async function fetchBatchEntries(batchNo: string): Promise<MaterialItem[]> {
  if (!batchNo) return [];
  const path = 'materials';
  try {
    const q = query(collection(db, path), where('batchNo', '==', batchNo));
    const snapshot = await getDocs(q);
    const entries: MaterialItem[] = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<MaterialItem, 'id'>),
    }));
    entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return entries;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * Subscribes to real-time usage logs for a specific Batch/LOT number from Firestore
 */
export function subscribeBatchUsageLogs(
  batchNo: string,
  onUpdate: (logs: BatchUsageLog[]) => void,
  onError?: (err: any) => void
): () => void {
  if (!batchNo) {
    onUpdate([]);
    return () => {};
  }
  const path = 'batchUsageLogs';
  const q = query(collection(db, path), where('batchNo', '==', batchNo));

  return onSnapshot(
    q,
    (snapshot) => {
      const logs: BatchUsageLog[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<BatchUsageLog, 'id'>),
      }));
      // Sort newest first
      logs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      onUpdate(logs);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      if (onError) onError(error);
    }
  );
}

/**
 * Writes a new batch usage log / dispensing activity to Firestore
 * and optionally updates the material's current quantity
 */
export async function addBatchUsageLog(
  log: Omit<BatchUsageLog, 'id'>,
  materialDocId?: string,
  newRemainingQuantity?: number
): Promise<string> {
  const path = 'batchUsageLogs';
  try {
    const docRef = await addDoc(collection(db, path), log);

    if (materialDocId && typeof newRemainingQuantity === 'number') {
      const matRef = doc(db, 'materials', materialDocId);
      await updateDoc(matRef, { quantity: newRemainingQuantity });
    }

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

/**
 * Updates a material's quantity directly in Firestore
 */
export async function updateMaterialQuantity(id: string, newQuantity: number): Promise<void> {
  const path = `materials/${id}`;
  try {
    const matRef = doc(db, 'materials', id);
    await updateDoc(matRef, { quantity: newQuantity });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}

/**
 * Fetch a single material by ID from Firestore
 */
export async function getMaterialById(id: string): Promise<MaterialItem | null> {
  const path = `materials/${id}`;
  try {
    const docSnap = await getDoc(doc(db, 'materials', id));
    if (!docSnap.exists()) return null;
    return {
      id: docSnap.id,
      ...(docSnap.data() as Omit<MaterialItem, 'id'>),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * Updates stock threshold configuration on a material item in Firestore
 */
export async function updateMaterialSettings(
  id: string,
  settings: {
    minThreshold?: number;
    targetStockLevel?: number;
    dailyUsageRate?: number;
    supplierLeadDays?: number;
    supplierId?: string;
    unitPrice?: number;
  }
): Promise<void> {
  const path = `materials/${id}`;
  try {
    const cleanPayload: Record<string, any> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        cleanPayload[key] = value;
      } else {
        cleanPayload[key] = deleteField();
      }
    }
    await updateDoc(doc(db, 'materials', id), cleanPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    throw error;
  }
}
