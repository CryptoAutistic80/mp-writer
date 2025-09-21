import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UserAddressDocument = HydratedDocument<UserAddress>;

@Schema({ timestamps: true })
export class UserAddress {
  _id!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: string;

  @Prop({ required: true })
  ciphertext!: string; // v1.<iv>.<tag>.<data>
}

export const UserAddressSchema = SchemaFactory.createForClass(UserAddress);
UserAddressSchema.index({ user: 1 }, { unique: true });
