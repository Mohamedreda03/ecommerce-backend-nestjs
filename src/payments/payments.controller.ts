import {
  Controller,
  Headers,
  Post,
  RawBody,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Stripe webhook endpoint.
   * Must be @Public() — Stripe cannot provide a JWT.
   * Uses raw body for signature verification.
   */
  @Post('webhook')
  @Public()
  @ApiExcludeEndpoint()
  handleWebhook(
    @RawBody() rawBody: Buffer,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(rawBody, signature);
  }
}
