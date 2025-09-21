import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UserMpDocument = HydratedDocument<UserMp>;

@Schema({ timestamps: true })
export class UserMp {
  _id!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: string;

  @Prop({ required: true })
  constituency!: string;

  @Prop({ type: Object })
  mp!: {
    id?: number;
    name?: string;
    party?: string;
    portraitUrl?: string;
    since?: string;
    email?: string;
    twitter?: string;
    website?: string;
    parliamentaryAddress?: string;
  } | null;
}

export const UserMpSchema = SchemaFactory.createForClass(UserMp);
UserMpSchema.index({ user: 1 }, { unique: true });
