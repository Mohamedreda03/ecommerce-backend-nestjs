import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bull';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async sendWelcome(email: string, firstName: string) {
    this.logger.log(`Queueing welcome email for ${email}`);
    await this.emailQueue.add('welcome', { email, firstName });
  }

  async sendPasswordReset(email: string, resetUrl: string) {
    this.logger.log(`Queueing password reset email for ${email}`);
    await this.emailQueue.add('password-reset', { email, resetUrl });
  }

  async sendOrderConfirmation(
    order: { orderNumber: string; totalAmount: number; items: any[] },
    email: string,
  ) {
    this.logger.log(
      `Queueing order confirmation email for ${email} (Order: ${order.orderNumber})`,
    );
    await this.emailQueue.add('order-confirmation', { order, email });
  }

  async sendOrderShipped(
    order: { orderNumber: string },
    email: string,
    trackingInfo?: string,
  ) {
    this.logger.log(
      `Queueing order shipped email for ${email} (Order: ${order.orderNumber})`,
    );
    await this.emailQueue.add('order-shipped', { order, email, trackingInfo });
  }

  async sendOrderDelivered(order: { orderNumber: string }, email: string) {
    this.logger.log(
      `Queueing order delivered email for ${email} (Order: ${order.orderNumber})`,
    );
    await this.emailQueue.add('order-delivered', { order, email });
  }
}
