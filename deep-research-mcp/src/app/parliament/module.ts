import { Module } from '@nestjs/common';
import { ParliamentController } from './controller';
import { ParliamentService } from './service';
import { CacheService } from './cache.service';
import { QueryProcessor } from './query-processor';
import { RelevanceScorer } from './relevance-scorer';

@Module({
  controllers: [ParliamentController],
  providers: [
    ParliamentService,
    CacheService,
    QueryProcessor,
    RelevanceScorer,
  ],
  exports: [ParliamentService],
})
export class ParliamentModule {}
