import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/module';
import { ParliamentModule } from './parliament/module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule, ParliamentModule],
})
export class AppModule {}
