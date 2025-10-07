import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { Purchase, PurchaseStatus } from './schemas/purchase.schema';
import { findCreditPackageById } from '@mp-writer/shared/credit-packages';
import { UserCreditsService } from '../user-credits/user-credits.service';

@Injectable()
export class PurchasesService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PurchasesService.name);
  private readonly successUrlTemplate: string;
  private readonly cancelUrl: string;

  constructor(
    @InjectModel(Purchase.name) private readonly purchaseModel: Model<Purchase>,
    private readonly config: ConfigService,
    private readonly userCredits: UserCreditsService
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY must be configured');
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-11-20',
      typescript: true,
    });

    const appOrigin = this.config.get<string>('APP_ORIGIN', 'http://localhost:3000');
    this.successUrlTemplate = `${appOrigin.replace(/\/$/, '')}/credit-shop/return?session_id={CHECKOUT_SESSION_ID}`;
    this.cancelUrl = `${appOrigin.replace(/\/$/, '')}/credit-shop?cancelled=1`;
  }

  constructWebhookEvent(payload: Buffer | string, signature: string, secret: string) {
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }

  async createCheckoutSession(userId: string, packageId: string) {
    const selectedPackage = findCreditPackageById(packageId);
    if (!selectedPackage) {
      throw new BadRequestException('Unknown credit package');
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'if_required',
      payment_method_types: ['card'],
      metadata: {
        userId,
        packageId: selectedPackage.id,
        credits: selectedPackage.credits.toString(),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: selectedPackage.price.currency,
            unit_amount: selectedPackage.price.unitAmount,
            product_data: {
              name: selectedPackage.name,
              description: selectedPackage.description,
            },
          },
        },
      ],
      success_url: this.successUrlTemplate,
      cancel_url: this.cancelUrl,
    });

    await this.purchaseModel.findOneAndUpdate(
      { stripeSessionId: session.id },
      {
        user: userId,
        plan: selectedPackage.id,
        amount: selectedPackage.price.unitAmount,
        currency: selectedPackage.price.currency,
        credits: selectedPackage.credits,
        status: 'pending' satisfies PurchaseStatus,
        metadata: this.serialiseMetadata(session.metadata),
        stripeSessionId: session.id,
        stripePaymentIntentId: this.extractPaymentIntentId(session.payment_intent),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  async findMine(userId: string) {
    return this.purchaseModel.find({ user: userId }).sort({ createdAt: -1 }).lean();
  }

  async getById(userId: string, id: string) {
    const purchase = await this.purchaseModel.findOne({ _id: id, user: userId }).lean();
    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }
    return purchase;
  }

  async getCheckoutSessionForUser(userId: string, sessionId: string) {
    const purchase = await this.purchaseModel.findOne({ user: userId, stripeSessionId: sessionId }).lean();
    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }
    return {
      status: purchase.status,
      credits: purchase.credits,
      amount: purchase.amount,
      currency: purchase.currency,
      completedAt: purchase.completedAt,
      failureMessage: purchase.failureMessage,
    };
  }

  async handleStripeEvent(event: Stripe.Event) {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        await this.handleCheckoutSessionFailure(event.data.object as Stripe.Checkout.Session, 'failed');
        break;
      case 'charge.refunded':
        await this.handleRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const metadata = this.serialiseMetadata(session.metadata);
    const userId = metadata.userId;
    if (!userId) {
      this.logger.warn(`Received session ${session.id} without userId metadata`);
      return;
    }

    const purchase = await this.purchaseModel.findOne({ stripeSessionId: session.id });
    const packageId = metadata.packageId;
    const selectedPackage = findCreditPackageById(packageId);
    const credits = this.resolveCredits(selectedPackage?.credits, metadata.credits);
    const amount = session.amount_total ?? selectedPackage?.price.unitAmount ?? purchase?.amount ?? 0;
    const currency = session.currency ?? selectedPackage?.price.currency ?? purchase?.currency ?? 'gbp';
    const paymentIntentId = this.extractPaymentIntentId(session.payment_intent);

    if (!purchase) {
      await this.purchaseModel.create({
        user: userId,
        plan: packageId ?? 'unknown',
        amount,
        currency,
        credits,
        status: 'pending',
        metadata,
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      });
    }

    const existing = purchase ?? (await this.purchaseModel.findOne({ stripeSessionId: session.id }));
    if (!existing) {
      this.logger.error(`Unable to persist purchase for session ${session.id}`);
      return;
    }

    if (existing.status === 'succeeded') {
      this.logger.debug(`Purchase ${existing._id} already succeeded, skipping credit grant`);
      return;
    }

    if (!credits || credits <= 0) {
      this.logger.warn(`Session ${session.id} completed without credits to grant`);
    } else {
      const userKey = typeof existing.user === 'string' ? existing.user : existing.user.toString();
      await this.userCredits.addToMine(userKey, credits);
    }

    await this.purchaseModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          amount,
          currency,
          credits,
          status: 'succeeded' satisfies PurchaseStatus,
          metadata,
          stripePaymentIntentId: paymentIntentId,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          completedAt: new Date(),
          failureCode: undefined,
          failureMessage: undefined,
        },
      }
    );
  }

  private async handleCheckoutSessionFailure(session: Stripe.Checkout.Session, status: PurchaseStatus) {
    await this.purchaseModel.updateOne(
      { stripeSessionId: session.id },
      {
        $set: {
          status,
          stripePaymentIntentId: this.extractPaymentIntentId(session.payment_intent),
          failureCode: session.metadata?.failure_code ?? undefined,
          failureMessage: session.metadata?.failure_message ?? undefined,
        },
      }
    );
  }

  private async handleRefunded(charge: Stripe.Charge) {
    if (!charge.payment_intent) return;
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent.id;
    if (!paymentIntentId) return;

    const purchase = await this.purchaseModel.findOne({ stripePaymentIntentId: paymentIntentId });
    if (!purchase) return;

    if (purchase.status === 'refunded') return;

    await this.purchaseModel.updateOne(
      { _id: purchase._id },
      {
        $set: {
          status: 'refunded' satisfies PurchaseStatus,
          failureMessage: 'Payment was refunded',
        },
      }
    );
  }

  private extractPaymentIntentId(paymentIntent: string | Stripe.PaymentIntent | null | undefined) {
    if (!paymentIntent) return undefined;
    if (typeof paymentIntent === 'string') return paymentIntent;
    return paymentIntent.id;
  }

  private serialiseMetadata(metadata: Stripe.Metadata | null | undefined) {
    if (!metadata) return {} as Record<string, string>;
    return Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, value ?? ''])
    );
  }

  private resolveCredits(defaultCredits: number | undefined, metadataValue: unknown) {
    if (typeof defaultCredits === 'number' && defaultCredits > 0) {
      return defaultCredits;
    }
    const parsed = Number(metadataValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return 0;
  }
}
