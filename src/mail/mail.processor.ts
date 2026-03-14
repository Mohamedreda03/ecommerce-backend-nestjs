import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bull';
import * as nodemailer from 'nodemailer';

@Processor('email')
export class MailProcessor {
  private readonly logger = new Logger(MailProcessor.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('MAIL_HOST'),
      port: this.configService.getOrThrow<number>('MAIL_PORT'),
      auth: {
        user: this.configService.get<string>('MAIL_USER') || undefined,
        pass: this.configService.get<string>('MAIL_PASSWORD') || undefined,
      },
    });
  }

  @Process('welcome')
  async handleWelcome(job: Job<{ email: string; firstName: string }>) {
    const { email, firstName } = job.data;
    const html = `
      <h1>Welcome to Ecommerce Store, ${firstName}!</h1>
      <p>We are excited to have you on board.</p>
    `;

    await this.sendMail(email, 'Welcome to Ecommerce Store', html);
  }

  @Process('password-reset')
  async handlePasswordReset(job: Job<{ email: string; resetUrl: string }>) {
    const { email, resetUrl } = job.data;
    const html = `
      <h1>Password Reset Request</h1>
      <p>Please click the link below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>If you did not request this, please ignore this email.</p>
    `;

    await this.sendMail(email, 'Password Reset Request', html);
  }

  @Process('order-confirmation')
  async handleOrderConfirmation(
    job: Job<{
      order: { orderNumber: string; totalAmount: number; items: any[] };
      email: string;
    }>,
  ) {
    const { order, email } = job.data;
    const html = `
      <h1>Order Confirmation</h1>
      <p>Thank you for your order, ${email}!</p>
      <p>Your order number is: <strong>${order.orderNumber}</strong></p>
      <p>Total amount: $${order.totalAmount}</p>
      <p>We will notify you once your order has been shipped.</p>
    `;

    await this.sendMail(
      email,
      `Order Confirmation - ${order.orderNumber}`,
      html,
    );
  }

  @Process('order-shipped')
  async handleOrderShipped(
    job: Job<{
      order: { orderNumber: string };
      email: string;
      trackingInfo?: string;
    }>,
  ) {
    const { order, email, trackingInfo } = job.data;
    let html = `
      <h1>Order Shipped</h1>
      <p>Good news! Your order <strong>${order.orderNumber}</strong> has been shipped.</p>
    `;

    if (trackingInfo) {
      html += `<p>Tracking Information: ${trackingInfo}</p>`;
    }

    await this.sendMail(email, `Order Shipped - ${order.orderNumber}`, html);
  }

  @Process('order-delivered')
  async handleOrderDelivered(
    job: Job<{ order: { orderNumber: string }; email: string }>,
  ) {
    const { order, email } = job.data;
    const html = `
      <h1>Order Delivered</h1>
      <p>Your order <strong>${order.orderNumber}</strong> has been delivered successfully!</p>
      <p>We hope you enjoy your purchase.</p>
    `;

    await this.sendMail(email, `Order Delivered - ${order.orderNumber}`, html);
  }

  private async sendMail(to: string, subject: string, html: string) {
    const from = this.configService.getOrThrow<string>('MAIL_FROM');
    const fromName = this.configService.get<string>('MAIL_FROM_NAME') || 'Store';

    try {
      await this.transporter.sendMail({
        from: `"${fromName}" <${from}>`,
        to,
        subject,
        html,
      });
      this.logger.log(`Successfully sent email: "${subject}" to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${(error as Error).message}`);
      throw error; // Let Bull retry
    }
  }
}
