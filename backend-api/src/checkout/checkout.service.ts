import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { PurchasesService } from '../purchases/purchases.service';
import { PurchaseMetadata } from '../purchases/dto/create-purchase.dto';
import { CheckoutUser, CreditPackage } from './types';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class CheckoutService {
  private readonly stripe: Stripe | null;
  private readonly checkoutEnabled: boolean;
  private readonly priceMap: Record<number, string>;
  private readonly amountMap: Record<number, number>; // Amount in minor units (e.g., cents)
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService,
    private readonly purchases: PurchasesService,
    @InjectConnection() private readonly connection: Connection,
  ) {
    this.checkoutEnabled = this.parseBoolean(this.config.get('STRIPE_CHECKOUT_ENABLED'));
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = secretKey ? new Stripe(secretKey) : null;
    this.priceMap = this.loadPriceMap();
    this.amountMap = this.loadAmountMap();
  }

  async createSession(user: CheckoutUser, credits: number) {
    this.assertCheckoutEnabled();
    const stripe = this.requireStripe();
    const priceId = this.resolvePriceId(credits);
    const origin = this.getAppOrigin();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/credit-shop/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/credit-shop/cancel`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: {
        userId: user.id,
        credits: String(credits),
        priceId,
        fulfilled: 'false',
      },
    });

    if (!session.url) {
      throw new InternalServerErrorException('Unable to create Stripe checkout session.');
    }

    return { sessionId: session.id, url: session.url };
  }

  async confirmSession(user: CheckoutUser, sessionId: string) {
    this.assertCheckoutEnabled();
    const stripe = this.requireStripe();
    if (!sessionId) throw new BadRequestException('sessionId is required');

    const existing = await this.purchases.findByStripeSession(user.id, sessionId);
    if (existing) {
      const balance = await this.userCredits.getMine(user.id);
      return { alreadyProcessed: true, creditsAdded: 0, balance: balance.credits };
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'line_items.data.price'],
    });

    if (session.client_reference_id && session.client_reference_id !== user.id) {
      throw new ForbiddenException('Checkout session does not belong to this user.');
    }

    if (session.metadata?.userId && session.metadata.userId !== user.id) {
      throw new ForbiddenException('Checkout session metadata mismatch.');
    }

    if (session.metadata?.fulfilled === 'true') {
      const balance = await this.userCredits.getMine(user.id);
      return { alreadyProcessed: true, creditsAdded: 0, balance: balance.credits };
    }

    const credits = Number(session.metadata?.credits ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      throw new BadRequestException('Checkout session is missing credit information.');
    }

    // Validate price ID matches expected
    const expectedPriceId = this.resolvePriceId(credits);
    const priceFromMetadata = session.metadata?.priceId;
    const priceFromLineItem = session.line_items?.data?.[0]?.price?.id;
    const resolvedPriceId = priceFromMetadata || priceFromLineItem;
    if (!resolvedPriceId) {
      throw new BadRequestException('Unable to determine price for checkout session.');
    }
    if (resolvedPriceId !== expectedPriceId) {
      throw new BadRequestException('Checkout session price does not match the selected package.');
    }

    // NEW: Validate amount paid matches expected amount
    const expectedAmount = this.amountMap[credits];
    if (expectedAmount !== undefined) {
      const amountPaid = typeof session.amount_total === 'number' 
        ? session.amount_total 
        : session.line_items?.data?.[0]?.amount_total ?? 0;
      
      if (amountPaid !== expectedAmount) {
        this.logger.error(
          `Amount mismatch for session ${session.id}: expected ${expectedAmount}, got ${amountPaid}`
        );
        throw new BadRequestException('Payment amount does not match the selected package.');
      }
    }

    if (session.payment_status !== 'paid') {
      throw new BadRequestException('Checkout session has not completed payment.');
    }

    return await this.fulfillOrder(session, credits);
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(signature: string, payload: Buffer): Promise<{ received: boolean }> {
    const stripe = this.requireStripe();
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new InternalServerErrorException('Webhook secret not configured');
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Received webhook event: ${event.type} (${event.id})`);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.async_payment_succeeded':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.async_payment_failed':
        this.logger.warn(`Async payment failed for session: ${event.data.object.id}`);
        break;
      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  /**
   * Get available credit packages
   */
  getCreditPackages(): CreditPackage[] {
    const currency = this.config.get<string>('STRIPE_CURRENCY') || 'gbp';
    const packages: CreditPackage[] = [];

    for (const [credits, priceId] of Object.entries(this.priceMap)) {
      const creditsNum = Number(credits);
      const amount = this.amountMap[creditsNum];
      if (amount !== undefined) {
        packages.push({
          credits: creditsNum,
          priceId,
          amount,
          currency,
        });
      }
    }

    return packages.sort((a, b) => a.credits - b.credits);
  }

  /**
   * Handle checkout.session.completed webhook
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    this.logger.log(`Processing completed checkout session: ${session.id}`);

    // Check if already fulfilled
    if (session.metadata?.fulfilled === 'true') {
      this.logger.log(`Session ${session.id} already marked as fulfilled`);
      return;
    }

    const userId = session.metadata?.userId || session.client_reference_id;
    if (!userId) {
      this.logger.error(`No userId found in session ${session.id}`);
      return;
    }

    // Check if already processed in our database
    const existing = await this.purchases.findByStripeSession(userId, session.id);
    if (existing) {
      this.logger.log(`Session ${session.id} already processed in database`);
      return;
    }

    // Validate payment status
    if (session.payment_status !== 'paid') {
      this.logger.warn(`Session ${session.id} is not paid (status: ${session.payment_status})`);
      return;
    }

    const credits = Number(session.metadata?.credits ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      this.logger.error(`Invalid credits in session ${session.id}: ${session.metadata?.credits}`);
      return;
    }

    try {
      // Retrieve full session with line items
      const stripe = this.requireStripe();
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items', 'line_items.data.price'],
      });

      await this.fulfillOrder(fullSession, credits);
      this.logger.log(`Successfully fulfilled order for session ${session.id}`);
    } catch (error) {
      this.logger.error(`Failed to fulfill order for session ${session.id}: ${(error as Error).message}`);
      // Don't throw - we'll retry on next webhook delivery
    }
  }

  /**
   * Fulfill the order: add credits and create purchase record
   * Uses MongoDB transaction for atomicity
   */
  private async fulfillOrder(session: Stripe.Checkout.Session, credits: number) {
    const userId = session.metadata?.userId || session.client_reference_id;
    if (!userId) {
      throw new BadRequestException('User ID not found in session');
    }

    const defaultCurrency = (this.config.get<string>('STRIPE_CURRENCY') || 'gbp').toLowerCase();
    const amountMinor = typeof session.amount_total === 'number' 
      ? session.amount_total 
      : session.line_items?.data?.[0]?.amount_total ?? 0;

    const priceId = session.metadata?.priceId || session.line_items?.data?.[0]?.price?.id || '';

    const metadata: PurchaseMetadata = {
      stripeSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === 'string' 
        ? session.payment_intent 
        : session.payment_intent?.id,
      credits,
      priceId,
    };

    // Use transaction for atomicity
    const mongoSession = await this.connection.startSession();
    let updatedBalance: number | null = null;

    try {
      await mongoSession.withTransaction(async () => {
        // Add credits
        const balanceResult = await this.userCredits.addToMine(userId, credits);
        updatedBalance = typeof balanceResult?.credits === 'number' ? balanceResult.credits : null;
        
        // Create purchase record
        await this.purchases.create(userId, {
          plan: `credit_pack_${credits}`,
          amount: amountMinor,
          currency: session.currency ?? defaultCurrency,
          metadata,
        });
      });

      // Mark session as fulfilled in Stripe (outside transaction)
      try {
        const stripe = this.requireStripe();
        await stripe.checkout.sessions.update(session.id, {
          metadata: {
            ...session.metadata,
            fulfilled: 'true',
          },
        });
      } catch (error) {
        this.logger.warn(`Unable to mark session ${session.id} as fulfilled in Stripe: ${(error as Error).message}`);
      }

      if (typeof updatedBalance !== 'number') {
        throw new InternalServerErrorException('Unable to determine updated credit balance.');
      }

      return {
        alreadyProcessed: false,
        creditsAdded: credits,
        balance: updatedBalance,
      };
    } catch (error) {
      this.logger.error(`Transaction failed for session ${session.id}: ${(error as Error).message}`);
      throw error;
    } finally {
      await mongoSession.endSession();
    }
  }

  private assertCheckoutEnabled() {
    if (!this.checkoutEnabled) {
      throw new BadRequestException('Stripe checkout is disabled.');
    }
  }

  private requireStripe() {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe is not configured.');
    }
    return this.stripe;
  }

  private resolvePriceId(credits: number) {
    const priceId = this.priceMap[credits];
    if (!priceId) {
      throw new BadRequestException('Unsupported credit package.');
    }
    return priceId;
  }

  private parseBoolean(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return !['0', 'false', 'no', ''].includes(value.trim().toLowerCase());
    return false;
  }

  private loadPriceMap(): Record<number, string> {
    const entries: Array<[number, string | undefined]> = [
      [3, this.config.get<string>('STRIPE_PRICE_ID_CREDITS_3')],
      [5, this.config.get<string>('STRIPE_PRICE_ID_CREDITS_5')],
      [10, this.config.get<string>('STRIPE_PRICE_ID_CREDITS_10')],
    ];

    const map: Record<number, string> = {};
    for (const [credits, priceId] of entries) {
      if (priceId) {
        map[credits] = priceId;
      }
    }
    return map;
  }

  private loadAmountMap(): Record<number, number> {
    // Amounts in minor units (pence for GBP, cents for USD, etc.)
    const entries: Array<[number, string | undefined]> = [
      [3, this.config.get<string>('STRIPE_AMOUNT_CREDITS_3')],
      [5, this.config.get<string>('STRIPE_AMOUNT_CREDITS_5')],
      [10, this.config.get<string>('STRIPE_AMOUNT_CREDITS_10')],
    ];

    const map: Record<number, number> = {};
    for (const [credits, amountStr] of entries) {
      if (amountStr) {
        const amount = Number(amountStr);
        if (Number.isFinite(amount) && amount > 0) {
          map[credits] = amount;
        }
      }
    }
    return map;
  }

  private getAppOrigin() {
    const origin = this.config.get<string>('APP_ORIGIN');
    if (!origin) {
      throw new InternalServerErrorException('APP_ORIGIN is not configured.');
    }
    return origin.replace(/\/+$/, '');
  }
}
