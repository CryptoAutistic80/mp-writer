import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WritingSessionsService } from './writing-sessions.service';
import { CreateWritingSessionDto } from './dto/create-writing-session.dto';
import { RunResearchDto } from './dto/run-research.dto';

@UseGuards(JwtAuthGuard)
@Controller('writing-sessions')
export class WritingSessionsController {
  constructor(private readonly sessions: WritingSessionsService) {}

  @Post()
  async create(@Req() req: any, @Body() body: CreateWritingSessionDto) {
    return this.sessions.create(req.user.id, body);
  }

  @Get()
  async list(@Req() req: any, @Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.sessions.listMine(req.user.id, Number.isNaN(parsedLimit ?? NaN) ? undefined : parsedLimit);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.sessions.getMine(req.user.id, id);
  }

  @Post(':id/research')
  async runResearch(@Req() req: any, @Param('id') id: string, @Body() body: RunResearchDto) {
    return this.sessions.runResearch(req.user.id, id, body);
  }
}
