export type PurchasePlanId = 'single' | 'starter_pack';

export interface PurchasePlanConfig {
  id: PurchasePlanId;
  name: string;
  credits: number;
  amount: number;
  currency: string;
  description?: string;
}

export const PURCHASE_PLANS: Record<PurchasePlanId, PurchasePlanConfig> = {
  single: {
    id: 'single',
    name: 'Single credit',
    credits: 1,
    amount: 500,
    currency: 'gbp',
    description: 'One AI-assisted letter generation.',
  },
  starter_pack: {
    id: 'starter_pack',
    name: 'Starter pack (5 credits)',
    credits: 5,
    amount: 2000,
    currency: 'gbp',
    description: 'Bundle of five letters at a discounted rate.',
  },
};

export function getPurchasePlan(planId: string) {
  if (!planId) return null;
  return PURCHASE_PLANS[planId as PurchasePlanId] ?? null;
}
