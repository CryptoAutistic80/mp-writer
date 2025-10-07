export type CreditPackage = {
  id: string;
  name: string;
  description?: string;
  credits: number;
  price: {
    unitAmount: number;
    currency: string;
  };
  highlight?: boolean;
};

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'credits-5',
    name: 'Starter bundle',
    description: 'Ideal for topping up quickly and continuing your writing session.',
    credits: 5,
    price: { unitAmount: 399, currency: 'gbp' },
  },
  {
    id: 'credits-15',
    name: 'Best value',
    description: 'Stock up on credits and save more on every purchase.',
    credits: 15,
    price: { unitAmount: 999, currency: 'gbp' },
    highlight: true,
  },
  {
    id: 'credits-30',
    name: 'Power writer',
    description: 'For frequent writers who never want to pause their momentum.',
    credits: 30,
    price: { unitAmount: 1899, currency: 'gbp' },
  },
];

export function findCreditPackageById(id: string | null | undefined): CreditPackage | undefined {
  if (!id) return undefined;
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}
