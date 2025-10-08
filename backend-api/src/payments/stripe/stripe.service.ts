import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PurchasesService } from '../../purchases/purchases.service';
import { UserCreditsService } from '../../user-credits/user-credits.service';

export type CreditPackage = {
  id: string;
  name: string;
  description: string;
  credits: number;
  amount: number;
  currency: string;
};

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2024-06-20';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;
  private readonly logger = new Logger(StripeService.name);

  private readonly packages: CreditPackage[] = [
    {
      id: 'starter-3',
      name: 'Starter credit pack',
      description: 'Perfect for quick letters and research checks.',
      credits: 3,
      amount: 299,
      currency: 'gbp',
    },
    {
      id: 'writer-5',
      name: 'Writer credit pack',
      description: 'Ideal for frequent campaigners with multiple MPs.',
      credits: 5,
      amount: 499,
      currency: 'gbp',
    },
    {
      id: 'campaigner-10',
      name: 'Campaigner credit pack',
      description: 'Best value for power users planning regular outreach.',
      credits: 10,
      amount: 999,
      currency: 'gbp',
    },
  ];

  constructor(
    private readonly config: ConfigService,
    private readonly purchases: PurchasesService,
    @Inject(forwardRef(() => UserCreditsService))
    private readonly userCredits: UserCreditsService
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY must be configured');
    }
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET must be configured');
    }
    this.webhookSecret = webhookSecret;
    this.successUrl =
      this.config.get<string>('STRIPE_SUCCESS_URL') ?? `${this.getAppOrigin()}/credit-shop/success`;
    this.cancelUrl =
      this.config.get<string>('STRIPE_CANCEL_URL') ?? `${this.getAppOrigin()}/credit-shop/cancel`;

    this.stripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: {
        name: 'MP Writer',
      },
    });
  }

  getCreditPackages(): CreditPackage[] {
    return this.packages.map((pkg) => ({ ...pkg }));
  }

  async createCheckoutSession(userId: string, packageId: string) {
    const selected = this.packages.find((pkg) => pkg.id === packageId);
    if (!selected) {
      throw new NotFoundException('Selected package is no longer available.');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: userId,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: selected.currency,
            unit_amount: selected.amount,
            product_data: {
              name: selected.name,
              description: selected.description,
            },
          },
        },
      ],
      metadata: {
        userId,
        packageId: selected.id,
        credits: selected.credits.toString(),
      },
      success_url: `${this.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: this.cancelUrl,
    });

    await this.purchases.createPendingStripePurchase(userId, {
      plan: selected.id,
      amount: selected.amount,
      currency: selected.currency,
      credits: selected.credits,
      stripeSessionId: session.id,
      stripePaymentIntentId: this.resolvePaymentIntentId(session.payment_intent),
      metadata: {
        packageId: selected.id,
      },
    });

    return {
      sessionId: session.id,
    };
  }

  async handleWebhook(signature: string | undefined, rawBody: Buffer | undefined) {
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature header');
    }
    if (!rawBody) {
      throw new BadRequestException('Missing Stripe payload');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      this.logger.warn(`Stripe webhook verification failed: ${(error as Error).message}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        await this.handleCheckoutExpired(event.data.object as Stripe.Checkout.Session, event.type);
        break;
      case 'charge.refunded':
      case 'charge.refund.updated':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event received: ${event.type}`);
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const purchase = await this.purchases.findByStripeSessionId(session.id);
    if (!purchase) {
      this.logger.warn(`Stripe session ${session.id} has no matching purchase`);
      return;
    }

    if (purchase.status === 'succeeded') {
      return;
    }

    const userId = typeof purchase.user === 'string' ? purchase.user : purchase.user.toString();
    await this.userCredits.addToMine(userId, purchase.credits);
    await this.purchases.markStripePurchaseSucceeded(session.id, {
      stripePaymentIntentId: this.resolvePaymentIntentId(session.payment_intent),
    });
    this.logger.log(`Purchase ${purchase._id} completed successfully for user ${userId}`);
  }

  private async handleCheckoutExpired(session: Stripe.Checkout.Session, eventType: string) {
    const purchase = await this.purchases.findByStripeSessionId(session.id);
    if (!purchase) {
      this.logger.warn(`Unable to locate purchase for expired session ${session.id}`);
      return;
    }

    if (purchase.status === 'pending') {
      await this.purchases.markStripePurchaseFailed(session.id, `${eventType}`);
      this.logger.log(`Marked purchase ${purchase._id} as failed after event ${eventType}`);
    }
  }

  private async handleChargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
    if (!paymentIntentId) {
      this.logger.warn(`Refund event received without payment intent reference`);
      return;
    }

    const purchase = await this.purchases.findByStripePaymentIntentId(paymentIntentId);
    if (!purchase) {
      this.logger.warn(`Unable to locate purchase for refunded payment intent ${paymentIntentId}`);
      return;
    }

    if (purchase.status !== 'refunded') {
      const userId = typeof purchase.user === 'string' ? purchase.user : purchase.user.toString();
      try {
        await this.userCredits.deductFromMine(userId, purchase.credits);
      } catch (error) {
        this.logger.warn(
          `Failed to deduct credits for refunded purchase ${purchase._id}: ${(error as Error).message}`
        );
      }
      await this.purchases.markStripePurchaseRefunded(paymentIntentId);
      this.logger.log(`Marked purchase ${purchase._id} as refunded`);
    }
  }

  private resolvePaymentIntentId(input: string | Stripe.PaymentIntent | null | undefined) {
    if (!input) return undefined;
    return typeof input === 'string' ? input : input.id;
  }

  private getAppOrigin() {
    const origin = this.config.get<string>('APP_ORIGIN');
    if (!origin) {
      throw new Error('APP_ORIGIN must be configured when Stripe URLs are not explicitly set');
    }
    return origin;
  }
}
