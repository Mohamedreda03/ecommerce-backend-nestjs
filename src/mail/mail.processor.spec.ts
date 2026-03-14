import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { MailProcessor } from './mail.processor';

// Mock nodemailer
jest.mock('nodemailer');

describe('MailProcessor', () => {
  let processor: MailProcessor;
  let mockSendMail: jest.Mock;

  const mockConfigService = {
    getOrThrow: jest.fn((key) => {
      const config = {
        MAIL_HOST: 'smtp.test.com',
        MAIL_PORT: 587,
        MAIL_FROM: 'noreply@test.com',
      };
      return config[key as keyof typeof config];
    }),
    get: jest.fn((key) => {
      const config: Record<string, string> = {
        MAIL_USER: 'user',
        MAIL_PASSWORD: 'password',
        MAIL_FROM_NAME: 'Test Store',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    mockSendMail = jest.fn().mockResolvedValue(true);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailProcessor,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    processor = module.get<MailProcessor>(MailProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      auth: { user: 'user', pass: 'password' },
    });
  });

  it('should handle welcome email', async () => {
    const job = { data: { email: 'test@example.com', firstName: 'John' } } as any;
    await processor.handleWelcome(job);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Test Store" <noreply@test.com>',
      to: 'test@example.com',
      subject: 'Welcome to Ecommerce Store',
      html: expect.stringContaining('Welcome to Ecommerce Store, John!'),
    });
  });

  it('should handle password reset email', async () => {
    const job = {
      data: { email: 'test@example.com', resetUrl: 'http://reset' },
    } as any;
    await processor.handlePasswordReset(job);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Test Store" <noreply@test.com>',
      to: 'test@example.com',
      subject: 'Password Reset Request',
      html: expect.stringContaining('http://reset'),
    });
  });

  it('should handle order confirmation email', async () => {
    const job = {
      data: {
        email: 'test@example.com',
        order: { orderNumber: 'ORD-123', totalAmount: 100, items: [] },
      },
    } as any;
    await processor.handleOrderConfirmation(job);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Test Store" <noreply@test.com>',
      to: 'test@example.com',
      subject: 'Order Confirmation - ORD-123',
      html: expect.stringContaining('ORD-123'),
    });
  });

  it('should handle order shipped email without tracking', async () => {
    const job = {
      data: { email: 'test@example.com', order: { orderNumber: 'ORD-123' } },
    } as any;
    await processor.handleOrderShipped(job);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Test Store" <noreply@test.com>',
      to: 'test@example.com',
      subject: 'Order Shipped - ORD-123',
      html: expect.stringContaining('has been shipped'),
    });
  });

  it('should handle order shipped email with tracking', async () => {
    const job = {
      data: {
        email: 'test@example.com',
        order: { orderNumber: 'ORD-123' },
        trackingInfo: 'TRK123',
      },
    } as any;
    await processor.handleOrderShipped(job);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Test Store" <noreply@test.com>',
      to: 'test@example.com',
      subject: 'Order Shipped - ORD-123',
      html: expect.stringContaining('TRK123'),
    });
  });

  it('should handle order delivered email', async () => {
    const job = {
      data: { email: 'test@example.com', order: { orderNumber: 'ORD-123' } },
    } as any;
    await processor.handleOrderDelivered(job);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"Test Store" <noreply@test.com>',
      to: 'test@example.com',
      subject: 'Order Delivered - ORD-123',
      html: expect.stringContaining('delivered successfully'),
    });
  });

  it('should throw error if sendMail fails', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP error'));
    const job = { data: { email: 'test@example.com', firstName: 'John' } } as any;

    await expect(processor.handleWelcome(job)).rejects.toThrow('SMTP error');
  });
});
