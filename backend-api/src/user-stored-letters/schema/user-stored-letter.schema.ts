import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { WRITING_DESK_LETTER_TONES, WritingDeskLetterTone } from '../../writing-desk-jobs/writing-desk-jobs.types';

@Schema({ timestamps: true })
export class UserStoredLetter {
  @Prop({ required: true, unique: true })
  letterId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  ciphertext!: string;

  @Prop({ type: String, default: '', maxlength: 256 })
  mpName!: string;

  @Prop({ type: String, enum: [...WRITING_DESK_LETTER_TONES, null], default: null })
  tone!: WritingDeskLetterTone | null;
}

export type UserStoredLetterDocument = UserStoredLetter & Document;

export const UserStoredLetterSchema = SchemaFactory.createForClass(UserStoredLetter);

UserStoredLetterSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, any>) => {
    ret.id = ret._id?.toString?.();
    delete ret._id;
    return ret;
  },
});
