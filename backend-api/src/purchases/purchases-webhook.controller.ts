import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PurchasesService } from './purchases.service';

@Controller('purchases/webhook')
export class PurchasesWebhookController {
  constructor(private readonly purchases: PurchasesService, private readonly config: ConfigService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined
  ) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new BadRequestException('Stripe webhook secret is not configured');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    try {
      const event = this.purchases.constructWebhookEvent(rawBody, signature, webhookSecret);
      await this.purchases.handleStripeEvent(event);
    } catch (error) {
      throw new BadRequestException(`Unable to process Stripe webhook: ${(error as Error).message}`);
    }

    return { received: true };
  }
}
