import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type WritingSessionDocument = HydratedDocument<WritingSession>;

export type WritingSessionStatus =
  | 'draft'
  | 'refined'
  | 'researching'
  | 'completed'
  | 'failed';

export type WritingSessionCitation = {
  label: string;
  url?: string;
  note?: string;
};

export type WritingSessionResearch = {
  letterBody: string;
  citations: WritingSessionCitation[];
  rawOutput?: string;
};

export type WritingSessionRefinement = {
  summary: string;
  keyPoints: string[];
  toneSuggestions: string[];
  followUpQuestions?: string[];
  rawOutput?: string;
  model?: string;
};

@Schema({ timestamps: true })
export class WritingSession {
  _id!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user!: string;

  @Prop({ type: String, enum: ['draft', 'refined', 'researching', 'completed', 'failed'], default: 'draft' })
  status!: WritingSessionStatus;

  @Prop({ type: String, required: true })
  issueBrief!: string;

  @Prop({ type: Object })
  refinement?: WritingSessionRefinement | null;

  @Prop({ type: Object })
  research?: WritingSessionResearch | null;

  @Prop({ type: Object })
  mpSnapshot?: any;

  @Prop({ type: Object })
  addressSnapshot?: any;

  @Prop({ type: String })
  refinementModel?: string | null;

  @Prop({ type: String })
  researchModel?: string | null;

  @Prop({ type: Date })
  refinementCompletedAt?: Date | null;

  @Prop({ type: Date })
  researchStartedAt?: Date | null;

  @Prop({ type: Date })
  researchCompletedAt?: Date | null;

  @Prop({ type: String })
  errorMessage?: string | null;

  @Prop({ type: Number, default: 0 })
  creditsSpent?: number;
}

export const WritingSessionSchema = SchemaFactory.createForClass(WritingSession);
WritingSessionSchema.index({ user: 1, updatedAt: -1 });

