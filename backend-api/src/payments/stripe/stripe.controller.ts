import { Controller, Headers, Post, Req, RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { StripeService } from './stripe.service';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripe: StripeService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string
  ) {
    await this.stripe.handleWebhook(signature, req.rawBody);
    return { received: true };
  }
}
