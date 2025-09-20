import { InjectModel } from '@nestjs/mongoose';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { Purchase } from './schemas/purchase.schema';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { getPurchasePlan } from './purchase-plans';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly purchaseModel: Model<Purchase>,
    private readonly userCredits: UserCreditsService,
  ) {}

  async create(userId: string, input: { plan: string; amount?: number; currency?: string; metadata?: any }) {
    const plan = getPurchasePlan(input.plan);
    if (!plan) {
      throw new BadRequestException('Unknown purchase plan');
    }

    const amount = input.amount ?? plan.amount;
    const currency = (input.currency ?? plan.currency).toLowerCase();
    if (amount !== plan.amount || currency !== plan.currency) {
      throw new BadRequestException('Purchase details do not match plan');
    }

    const purchaseDoc = await this.purchaseModel.create({
      user: userId,
      plan: plan.id,
      amount,
      currency,
      metadata: input.metadata,
      status: 'succeeded',
    });

    const updatedCredits = await this.userCredits.addToMine(userId, plan.credits);

    const purchase = purchaseDoc.toObject ? purchaseDoc.toObject() : purchaseDoc;

    return { purchase, credits: updatedCredits.credits };
  }

  async findMine(userId: string) {
    return this.purchaseModel.find({ user: userId }).sort({ createdAt: -1 }).lean();
  }

  async getById(userId: string, id: string) {
    return this.purchaseModel.findOne({ _id: id, user: userId }).lean();
  }
}

