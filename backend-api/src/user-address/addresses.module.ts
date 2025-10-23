import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@mp-writer/nest-modules';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [AddressesService],
  controllers: [AddressesController],
})
export class AddressesModule {}

