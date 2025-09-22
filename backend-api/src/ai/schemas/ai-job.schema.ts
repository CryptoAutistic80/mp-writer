import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AiJobDocument = HydratedDocument<AiJob>;

export type AiJobDetail = {
  question: string;
  answer: string;
};

@Schema({ timestamps: true })
export class AiJob {
  _id!: string;

  @Prop({ type: String, required: true, unique: true })
  jobId!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true })
  user!: string;

  @Prop({ type: String, required: true, enum: ['queued', 'in_progress', 'completed', 'failed'] })
  status!: 'queued' | 'in_progress' | 'completed' | 'failed';

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

  @Prop({ type: String, default: null })
  lastResponseId!: string | null;

  createdAt!: Date;

  updatedAt!: Date;
}

export const AiJobSchema = SchemaFactory.createForClass(AiJob);

AiJobSchema.index({ user: 1 }, { unique: true });
AiJobSchema.index({ jobId: 1 }, { unique: true });

AiJobSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret.jobId;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
