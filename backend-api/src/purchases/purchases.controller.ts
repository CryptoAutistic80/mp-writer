import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PurchasesService } from './purchases.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@UseGuards(JwtAuthGuard)
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  async list(@Req() req: any) {
    return this.purchases.findMine(req.user.id);
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    return this.purchases.getById(req.user.id, id);
  }

  @Post('checkout-session')
  async createCheckoutSession(@Req() req: any, @Body() body: CreateCheckoutSessionDto) {
    return this.purchases.createCheckoutSession(req.user.id, body.packageId);
  }

  @Get('checkout-session/:sessionId')
  async getCheckoutSession(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.purchases.getCheckoutSessionForUser(req.user.id, sessionId);
  }
}

