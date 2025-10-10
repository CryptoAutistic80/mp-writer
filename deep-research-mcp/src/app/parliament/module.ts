import { Module } from '@nestjs/common';
import { ParliamentController } from './controller';
import { ParliamentService } from './service';

@Module({
  controllers: [ParliamentController],
  providers: [ParliamentService],
  exports: [ParliamentService],
})
export class ParliamentModule {}
