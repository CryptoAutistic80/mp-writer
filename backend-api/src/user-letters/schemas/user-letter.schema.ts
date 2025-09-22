import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UserLetterDocument = HydratedDocument<UserLetter>;

@Schema({ _id: false })
export class UserLetterDetail {
  @Prop({ default: '' })
  question!: string;

  @Prop({ default: '' })
  answer!: string;
}

const UserLetterDetailSchema = SchemaFactory.createForClass(UserLetterDetail);

@Schema({ timestamps: true })
export class UserLetter {
  _id!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: string;

  @Prop({ required: true })
  jobId!: string;

  @Prop({ required: true, enum: ['queued', 'in_progress', 'completed', 'failed'] })
  status!: string;

  @Prop({ default: '' })
  message!: string;

  @Prop({ default: '' })
  prompt!: string;

  @Prop({ default: '' })
  tone!: string;

  @Prop({ type: [UserLetterDetailSchema], default: [] })
  details!: UserLetterDetail[];

  @Prop({ default: '' })
  mpName!: string;

  @Prop({ default: '' })
  constituency!: string;

  @Prop({ default: '' })
  userName!: string;

  @Prop({ default: '' })
  userAddressLine!: string;

  @Prop({ default: null })
  ciphertext!: string | null;

  @Prop({ default: null })
  error!: string | null;

  @Prop({ default: null })
  credits!: number | null;

  @Prop({ default: null })
  lastResponseId!: string | null;

  createdAt!: Date;

  updatedAt!: Date;
}

export const UserLetterSchema = SchemaFactory.createForClass(UserLetter);
UserLetterSchema.index({ user: 1, jobId: 1 }, { unique: true });
UserLetterSchema.index({ user: 1, updatedAt: -1 });
