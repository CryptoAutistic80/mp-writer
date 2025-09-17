import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TerminusModule } from '@nestjs/terminus';
import { AppService } from './app.service';
import { AppController } from './app.controller';
import { NestModulesModule } from '@mp-writer/nest-modules';
import { HealthController } from './health.controller';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { AiModule } from '../ai/ai.module';
import { MpsModule } from '../mps/mps.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { AddressesModule } from '../user-address/addresses.module';
import { UserAddressModule } from '../user-address-store/user-address.module';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { WritingSessionsModule } from '../writing-sessions/writing-sessions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TerminusModule,
    ThrottlerModule.forRoot([{ ttl: 60, limit: 60 }]),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI', 'mongodb://localhost:27017/mp_writer'),
      }),
    }),
    NestModulesModule,
    UsersModule,
    AuthModule,
    PurchasesModule,
    AiModule,
    MpsModule,
    UserMpModule,
    AddressesModule,
    UserAddressModule,
    UserCreditsModule,
    WritingSessionsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
