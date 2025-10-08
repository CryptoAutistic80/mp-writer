import { Body, Controller, Get, Put, Post, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserCreditsService } from './user-credits.service';
import { UpsertUserCreditsDto } from './dto/upsert-user-credits.dto';
import { AdjustUserCreditsDto } from './dto/adjust-user-credits.dto';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../payments/stripe/stripe.service';
import { StartCheckoutDto } from './dto/start-checkout.dto';

@UseGuards(JwtAuthGuard)
@Controller('user/credits')
export class UserCreditsController {
  constructor(
    private readonly userCredits: UserCreditsService,
    private readonly config: ConfigService,
    private readonly stripe: StripeService,
  ) {}

  private assertMutationAllowed() {
    const flag = this.config.get<string>('ALLOW_DEV_CREDIT_MUTATION');
    const disabled = flag === '0' || flag?.toLowerCase?.() === 'false';
    if (disabled) {
      throw new ForbiddenException('Credit balance changes are disabled');
    }
  }

  @Get()
  async getMine(@Req() req: any) {
    return this.userCredits.getMine(req.user.id);
  }

  @Get('packages')
  async listPackages() {
    return { packages: this.stripe.getCreditPackages() };
  }

  @Put()
  async setMine(@Req() req: any, @Body() body: UpsertUserCreditsDto) {
    this.assertMutationAllowed();
    return this.userCredits.setMine(req.user.id, body.credits);
  }

  @Post('add')
  async add(@Req() req: any, @Body() body: AdjustUserCreditsDto) {
    this.assertMutationAllowed();
    return this.userCredits.addToMine(req.user.id, body.amount);
  }

  @Post('checkout')
  async checkout(@Req() req: any, @Body() body: StartCheckoutDto) {
    return this.stripe.createCheckoutSession(req.user.id, body.packageId);
  }

  @Post('deduct')
  async deduct(@Req() req: any, @Body() body: AdjustUserCreditsDto) {
    this.assertMutationAllowed();
    return this.userCredits.deductFromMine(req.user.id, body.amount);
  }
}
