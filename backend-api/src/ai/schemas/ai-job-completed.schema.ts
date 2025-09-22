import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { AiJobDetail } from './ai-job.schema';

export type AiJobCompletedDocument = HydratedDocument<AiJobCompleted>;

@Schema({ timestamps: true })
export class AiJobCompleted {
  _id!: string;

  @Prop({ type: String, required: true, unique: true })
  jobId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: string;

  @Prop({ type: String, required: true })
  status!: 'completed' | 'failed';

  @Prop({ type: String, required: true })
  message!: string;

  @Prop({ type: Number, default: null })
  credits!: number | null;

  @Prop({ type: String, default: null })
  prompt!: string | null;

  @Prop({ type: String, default: null })
  model!: string | null;

  @Prop({ type: String, default: null })
  tone!: string | null;

  @Prop({ type: [{ question: String, answer: String }], default: [] })
  details!: AiJobDetail[];

  @Prop({ type: String, default: null })
  mpName!: string | null;

  @Prop({ type: String, default: null })
  constituency!: string | null;

  @Prop({ type: String, default: null })
  userName!: string | null;

  @Prop({ type: String, default: null })
  userAddressLine!: string | null;

  @Prop({ type: String, default: null })
  content!: string | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: Date, default: () => new Date() })
  completedAt!: Date;

  createdAt!: Date;

  updatedAt!: Date;
}

export const AiJobCompletedSchema = SchemaFactory.createForClass(AiJobCompleted);

AiJobCompletedSchema.index({ user: 1, createdAt: -1 });
AiJobCompletedSchema.index({ jobId: 1 }, { unique: true });

AiJobCompletedSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret.jobId;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
