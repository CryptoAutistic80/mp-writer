import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  WRITING_DESK_JOB_PHASES,
  WRITING_DESK_RESEARCH_STATUSES,
  WritingDeskJobPhase,
  WritingDeskResearchStatus,
} from '../writing-desk-jobs.types';

@Schema({ timestamps: true })
export class WritingDeskJob {
  @Prop({ required: true, unique: true })
  jobId!: string;

  @Prop({ required: true, unique: true, index: true })
  userId!: string;

  @Prop({ type: String, enum: WRITING_DESK_JOB_PHASES, required: true })
  phase!: WritingDeskJobPhase;

  @Prop({ type: Number, required: true, min: 0 })
  stepIndex!: number;

  @Prop({ type: Number, required: true, min: 0 })
  followUpIndex!: number;

  @Prop({ type: String, required: true })
  formCiphertext!: string;

  @Prop({ type: [String], default: [] })
  followUpQuestions!: string[];

  @Prop({ type: String, required: true })
  followUpAnswersCiphertext!: string;

  @Prop({ type: String, default: null })
  notes!: string | null;

  @Prop({ type: String, default: null })
  responseId!: string | null;

  @Prop({ type: String, enum: WRITING_DESK_RESEARCH_STATUSES, default: 'idle' })
  researchStatus!: WritingDeskResearchStatus;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  researchProgress!: number;

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        type: { type: String, required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, required: true },
      },
    ],
    default: [],
  })
  researchActions!: Array<{
    id: string;
    type: string;
    message: string;
    createdAt: Date;
  }>;

  @Prop({ type: String, default: null })
  researchResult!: string | null;

  @Prop({ type: String, default: null })
  researchResponseId!: string | null;

  @Prop({ type: String, default: null })
  researchError!: string | null;

  @Prop({ type: Date, default: null })
  researchStartedAt!: Date | null;

  @Prop({ type: Date, default: null })
  researchCompletedAt!: Date | null;

  @Prop({ type: Number, default: null })
  researchBilledCredits!: number | null;

  @Prop({ type: Number, default: 0 })
  researchCursor!: number;
}

export type WritingDeskJobDocument = WritingDeskJob & Document;

export const WritingDeskJobSchema = SchemaFactory.createForClass(WritingDeskJob);

WritingDeskJobSchema.index({ userId: 1 }, { unique: true });

WritingDeskJobSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, any>) => {
    ret.id = ret._id?.toString?.();
    delete ret._id;
    return ret;
  },
});
