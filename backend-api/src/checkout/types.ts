export interface CheckoutUser { id: string; email?: string | null };

export interface CreditPackage {
  credits: number;
  priceId: string;
  amount: number;
  currency: string;
}

