import { InjectModel } from '@nestjs/mongoose';
import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { Purchase, PurchaseStatus } from './schemas/purchase.schema';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly purchaseModel: Model<Purchase>,
  ) {}

  async create(
    userId: string,
    input: {
      plan: string;
      amount: number;
      currency?: string;
      credits: number;
      status?: PurchaseStatus;
      metadata?: Record<string, any>;
      stripeSessionId?: string;
      stripePaymentIntentId?: string;
    }
  ) {
    return this.purchaseModel.create({
      user: userId,
      ...input,
      currency: input.currency ?? 'usd',
      status: input.status ?? 'pending',
    });
  }

  async findMine(userId: string) {
    return this.purchaseModel.find({ user: userId }).sort({ createdAt: -1 }).lean();
  }

  async getById(userId: string, id: string) {
    return this.purchaseModel.findOne({ _id: id, user: userId }).lean();
  }

  async createPendingStripePurchase(
    userId: string,
    input: {
      plan: string;
      amount: number;
      currency: string;
      credits: number;
      stripeSessionId: string;
      stripePaymentIntentId?: string;
      metadata?: Record<string, any>;
    }
  ) {
    return this.purchaseModel.create({
      user: userId,
      plan: input.plan,
      amount: input.amount,
      currency: input.currency,
      credits: input.credits,
      metadata: input.metadata,
      stripeSessionId: input.stripeSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      status: 'pending',
    });
  }

  async findByStripeSessionId(sessionId: string) {
    return this.purchaseModel.findOne({ stripeSessionId: sessionId }).lean();
  }

  async findByStripePaymentIntentId(paymentIntentId: string) {
    return this.purchaseModel.findOne({ stripePaymentIntentId: paymentIntentId }).lean();
  }

  async markStripePurchaseSucceeded(
    sessionId: string,
    updates: { stripePaymentIntentId?: string }
  ) {
    const set: Record<string, any> = {
      status: 'succeeded',
    };
    if (updates.stripePaymentIntentId) {
      set.stripePaymentIntentId = updates.stripePaymentIntentId;
    }
    return this.purchaseModel
      .findOneAndUpdate(
        { stripeSessionId: sessionId },
        {
          $set: set,
        },
        { new: true }
      )
      .lean();
  }

  async markStripePurchaseFailed(sessionId: string, reason: string) {
    return this.purchaseModel
      .findOneAndUpdate(
        { stripeSessionId: sessionId },
        {
          $set: {
            status: 'failed',
            'metadata.failureReason': reason,
          },
        },
        { new: true }
      )
      .lean();
  }

  async markStripePurchaseRefunded(paymentIntentId: string) {
    return this.purchaseModel
      .findOneAndUpdate(
        { stripePaymentIntentId: paymentIntentId },
        {
          $set: {
            status: 'refunded',
          },
        },
        { new: true }
      )
      .lean();
  }
}

