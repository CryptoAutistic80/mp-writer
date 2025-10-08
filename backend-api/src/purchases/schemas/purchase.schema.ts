import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type PurchaseDocument = HydratedDocument<Purchase>;

export type PurchaseStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

@Schema({ timestamps: true })
export class Purchase {
  _id!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user!: string;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true, default: 'usd' })
  currency!: string;

  @Prop({ required: true })
  plan!: string;

  @Prop({ required: true })
  credits!: number;

  @Prop({ required: true, default: 'pending' })
  status!: PurchaseStatus;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ required: false, index: true, sparse: true, unique: true })
  stripeSessionId?: string;

  @Prop({ required: false, index: true, sparse: true, unique: true })
  stripePaymentIntentId?: string;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
PurchaseSchema.index({ user: 1, createdAt: -1 });

