import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '../common/enums/order-status.enum';
import { PaymentStatus } from '../common/enums/payment-status.enum';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(
      this.configService.getOrThrow<string>('STRIPE_SECRET_KEY'),
    );
    this.webhookSecret = this.configService.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
  }

  // ─── Create PaymentIntent ──────────────────────────────────────────────────────

  async createPaymentIntent(order: {
    id: string;
    orderNumber: string;
    userId: string;
    totalAmount: number | { toNumber?: () => number };
  }): Promise<{ paymentIntentId: string; clientSecret: string }> {
    const amountNumber =
      typeof order.totalAmount === 'object' && order.totalAmount.toNumber
        ? order.totalAmount.toNumber()
        : Number(order.totalAmount);

    // Stripe expects amount in cents (smallest currency unit)
    const amountInCents = Math.round(amountNumber * 100);

    if (amountInCents <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
    };
  }

  // ─── Webhook handler ──────────────────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      this.logger.error(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid webhook signature');
    }

    this.logger.log(`Received Stripe event: ${event.type}`);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(
          event.data.object as Stripe.PaymentIntent,
        );
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  // ─── Refund ────────────────────────────────────────────────────────────────────

  async refundPayment(paymentIntentId: string) {
    const refund = await this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
    });

    const payment = await this.markPaymentAsRefunded(paymentIntentId, refund);

    if (!payment) {
      throw new NotFoundException(
        `Local payment record for PI ${paymentIntentId} not found`,
      );
    }

    return { refundId: refund.id, status: refund.status };
  }

  // ─── Private event handlers ────────────────────────────────────────────────────

  private async handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata?.orderId;
    if (!orderId) {
      this.logger.warn('PaymentIntent succeeded without orderId in metadata');
      return;
    }

    await this.prisma.$transaction([
      // Update payment status
      this.prisma.payment.update({
        where: { stripePaymentIntentId: paymentIntent.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          stripeResponse: JSON.parse(JSON.stringify(paymentIntent)),
        },
      }),
      // Update order status to CONFIRMED
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CONFIRMED },
      }),
    ]);

    this.logger.log(
      `Payment succeeded for order ${orderId} (PI: ${paymentIntent.id})`,
    );

    // TODO: Queue confirmation email (Phase 16)
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata?.orderId;
    if (!orderId) {
      this.logger.warn('PaymentIntent failed without orderId in metadata');
      return;
    }

    await this.prisma.payment.update({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: {
        status: PaymentStatus.FAILED,
        stripeResponse: JSON.parse(JSON.stringify(paymentIntent)),
      },
    });

    // Keep order as PENDING so user can retry payment
    this.logger.log(
      `Payment failed for order ${orderId} (PI: ${paymentIntent.id})`,
    );
  }

  private async handleChargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentId) {
      this.logger.warn('Charge refunded without payment_intent');
      return;
    }

    const payment = await this.markPaymentAsRefunded(paymentIntentId, charge);

    if (!payment) {
      this.logger.warn(`No payment found for refunded PI: ${paymentIntentId}`);
      return;
    }

    this.logger.log(
      `Charge refunded for order ${payment.orderId} (PI: ${paymentIntentId})`,
    );
  }

  private async markPaymentAsRefunded(
    paymentIntentId: string,
    stripePayload: any,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { orderId: true },
    });

    if (!payment) {
      return null;
    }

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { stripePaymentIntentId: paymentIntentId },
        data: {
          status: PaymentStatus.REFUNDED,
          stripeResponse: JSON.parse(JSON.stringify(stripePayload)),
        },
      }),
      this.prisma.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.REFUNDED },
      }),
    ]);

    return payment;
  }
}
