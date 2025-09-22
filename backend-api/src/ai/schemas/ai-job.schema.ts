import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AiJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

@Schema({ _id: false })
export class AiFollowUpDetail {
  @Prop({ required: true })
  question!: string;

  @Prop({ required: true })
  answer!: string;
}

const AiFollowUpDetailSchema = SchemaFactory.createForClass(AiFollowUpDetail);

@Schema({ timestamps: true })
export class AiJob {
  @Prop({ required: true, unique: true, index: true })
  jobId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user!: string;

  @Prop({ required: true, enum: ['queued', 'in_progress', 'completed', 'failed'], default: 'queued' })
  status!: AiJobStatus;

  @Prop({ required: true })
  message!: string;

  @Prop({ required: true })
  prompt!: string;

  @Prop()
  tone?: string;

  @Prop({ type: [AiFollowUpDetailSchema], default: [] })
  details!: AiFollowUpDetail[];

  @Prop()
  mpName?: string;

  @Prop()
  constituency?: string;

  @Prop()
  userName?: string;

  @Prop()
  userAddressLine?: string;

  @Prop()
  content?: string | null;

  @Prop()
  error?: string | null;

  @Prop()
  credits?: number;

  @Prop()
  lastResponseId?: string | null;

  @Prop({ type: Date })
  completedAt?: Date | null;
}

export type AiJobDocument = HydratedDocument<AiJob>;

export const AiJobSchema = SchemaFactory.createForClass(AiJob);
AiJobSchema.index({ user: 1, status: 1, updatedAt: -1 });
AiJobSchema.index({ user: 1, createdAt: -1 });
