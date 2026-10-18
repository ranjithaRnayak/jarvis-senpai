/**
 * Supplier Service
 * Provides supplier lookup and clearly-labelled synthetic demo suppliers.
 * Never presented as verified live market data.
 */

export interface Supplier {
  id: string;
  name: string;
  contactEmail: string;
  leadDays: number;
  categories: string[];
  isSynthetic: boolean;
  notes: string;
}

export const SYNTHETIC_SUPPLIERS: Supplier[] = [
  {
    id: 'sup-alpha',
    name: 'Apex Industrial & Chemical Co.',
    contactEmail: 'orders@apex-industrial.example',
    leadDays: 5,
    categories: ['Raw Materials', 'Laboratory Reagent', 'Chemicals'],
    isSynthetic: true,
    notes: 'Synthetic demo supplier (5-day standard lead time)',
  },
  {
    id: 'sup-pharma',
    name: 'MedVance Pharma Distributors',
    contactEmail: 'supply@medvance.example',
    leadDays: 3,
    categories: ['Pharmaceuticals', 'Medical Supplies', 'Health'],
    isSynthetic: true,
    notes: 'Synthetic demo supplier (3-day express medical lead time)',
  },
  {
    id: 'sup-global',
    name: 'Global Packaging & Food Essentials',
    contactEmail: 'sales@globalpack.example',
    leadDays: 7,
    categories: ['Groceries', 'General Supplies', 'Packaging'],
    isSynthetic: true,
    notes: 'Synthetic demo supplier (7-day food-grade lead time)',
  },
  {
    id: 'sup-tech',
    name: 'OmniTech Industrial Components',
    contactEmail: 'dispatch@omnitech.example',
    leadDays: 10,
    categories: ['Hardware', 'Electronics', 'Machinery'],
    isSynthetic: true,
    notes: 'Synthetic demo supplier (10-day freight lead time)',
  },
];

export function getSuppliers(): Supplier[] {
  return SYNTHETIC_SUPPLIERS;
}

export function getSupplierById(id?: string): Supplier | undefined {
  if (!id) return undefined;
  return SYNTHETIC_SUPPLIERS.find((s) => s.id === id);
}

export function getSuggestedSupplierForCategory(category?: string): Supplier {
  if (!category) return SYNTHETIC_SUPPLIERS[0];
  const matched = SYNTHETIC_SUPPLIERS.find((s) =>
    s.categories.some((c) => c.toLowerCase().includes(category.toLowerCase()))
  );
  return matched || SYNTHETIC_SUPPLIERS[0];
}
