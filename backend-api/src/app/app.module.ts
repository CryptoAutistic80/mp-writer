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
import { EncryptionService } from '../crypto/encryption.service';
import { WritingDeskJobsModule } from '../writing-desk-jobs/writing-desk-jobs.module';

function validateConfig(config: Record<string, unknown>) {
  const errors: string[] = [];

  const requireString = (key: string, opts?: { minLength?: number; forbid?: string[] }) => {
    const raw = config[key];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      errors.push(`${key} is required`);
      return;
    }
    if (opts?.minLength && raw.length < opts.minLength) {
      errors.push(`${key} must be at least ${opts.minLength} characters`);
    }
    if (opts?.forbid?.some((value) => value === raw)) {
      errors.push(`${key} must not use the default value '${raw}'`);
    }
  };

  requireString('MONGO_URI');
  requireString('JWT_SECRET', { minLength: 32, forbid: ['changeme'] });

  const dek = config.DATA_ENCRYPTION_KEY;
  if (typeof dek !== 'string' || dek.trim().length === 0) {
    errors.push('DATA_ENCRYPTION_KEY is required');
  } else {
    try {
      EncryptionService.deriveKey(dek);
    } catch (e: unknown) {
      errors.push(`DATA_ENCRYPTION_KEY invalid: ${(e as Error).message}`);
    }
  }

  const appOrigin = config.APP_ORIGIN;
  if (appOrigin && typeof appOrigin === 'string') {
    if (!/^https?:\/\//i.test(appOrigin)) {
      errors.push('APP_ORIGIN must be an absolute http(s) URL');
    }
  }

  const researchContextSize = config.OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE;
  if (typeof researchContextSize === 'string' && researchContextSize.trim().length > 0) {
    const normalised = researchContextSize.trim().toLowerCase();
    const allowed = ['shallow', 'medium', 'deep'];
    if (!allowed.includes(normalised)) {
      errors.push('OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE must be shallow, medium, or deep');
    }
  }

  if (errors.length) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }

  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
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
    WritingDeskJobsModule,
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
