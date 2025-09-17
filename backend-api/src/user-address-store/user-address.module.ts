import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { UserAddressController } from './user-address.controller';
import { UserAddressService } from './user-address.service';
import { UserAddress, UserAddressSchema } from './schemas/user-address.schema';
import { EncryptionService } from '../crypto/encryption.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: UserAddress.name, schema: UserAddressSchema }]),
  ],
  controllers: [UserAddressController],
  providers: [UserAddressService, EncryptionService],
  exports: [UserAddressService],
})
export class UserAddressModule {}

