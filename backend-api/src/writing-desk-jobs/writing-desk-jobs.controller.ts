import { Body, Controller, Delete, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WritingDeskJobsService } from './writing-desk-jobs.service';
import { UpsertActiveWritingDeskJobDto } from './dto/upsert-active-writing-desk-job.dto';

@UseGuards(JwtAuthGuard)
@Controller('writing-desk/jobs/active')
export class WritingDeskJobsController {
  constructor(private readonly jobs: WritingDeskJobsService) {}

  @Get()
  async getActiveJob(@Req() req: any) {
    return this.jobs.getActiveJobForUser(req.user.id);
  }

  @Put()
  async upsertActiveJob(@Req() req: any, @Body() body: UpsertActiveWritingDeskJobDto) {
    return this.jobs.upsertActiveJob(req.user.id, body);
  }

  @Post('research/start')
  async startResearch(@Req() req: any) {
    return this.jobs.startResearch(req.user.id);
  }

  @Get('research/status')
  async getResearchStatus(@Req() req: any) {
    return this.jobs.refreshResearchStatus(req.user.id);
  }

  @Delete()
  async deleteActiveJob(@Req() req: any) {
    await this.jobs.deleteActiveJob(req.user.id);
    return { success: true };
  }
}
