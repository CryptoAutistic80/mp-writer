import { Controller, Get, Query } from '@nestjs/common';
import {
  BillSearchDto,
  CoreDatasetQueryDto,
  HistoricHansardQueryDto,
  LegislationSearchDto,
} from './dto';
import { ParliamentService } from './service';

@Controller('parliament')
export class ParliamentController {
  constructor(private readonly parliamentService: ParliamentService) {}

  @Get('data')
  fetchCoreDataset(@Query() query: CoreDatasetQueryDto) {
    return this.parliamentService.fetchCoreDataset(query);
  }

  @Get('bills')
  fetchBills(@Query() query: BillSearchDto) {
    return this.parliamentService.fetchBills(query);
  }

  @Get('historic-hansard')
  fetchHistoricHansard(@Query() query: HistoricHansardQueryDto) {
    return this.parliamentService.fetchHistoricHansard(query);
  }

  @Get('legislation')
  fetchLegislation(@Query() query: LegislationSearchDto) {
    return this.parliamentService.fetchLegislation(query);
  }
}
