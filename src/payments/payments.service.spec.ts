import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '../common/enums/order-status.enum';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

const mockPrisma = {
  $transaction: jest.fn((cb) => {
    if (typeof cb === 'function') return cb(mockPrisma);
    return Promise.all(cb);
  }),
  payment: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  order: {
    update: jest.fn(),
  },
};

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'STRIPE_SECRET_KEY') return 'sk_test_123';
    if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_123';
    throw new Error(`Unexpected config key: ${key}`);
  }),
};

// Mock stripe module before importing PaymentsService
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_123',
        client_secret: 'pi_123_secret',
      }),
    },
    refunds: {
      create: jest.fn().mockResolvedValue({
        id: 're_123',
        status: 'succeeded',
      }),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
});

describe('PaymentsService', () => {
  let service: PaymentsService;
  let stripeMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    // Access the private stripe property for mocking
    stripeMock = (service as any).stripe;
  });

  describe('createPaymentIntent', () => {
    it('creates a payment intent with correct amount and metadata', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-123',
        userId: 'user-1',
        totalAmount: 50.5,
      };

      const result = await service.createPaymentIntent(order);

      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith({
        amount: 5050, // cents
        currency: 'usd',
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: order.userId,
        },
        automatic_payment_methods: { enabled: true },
      });

      expect(result).toEqual({
        paymentIntentId: 'pi_123',
        clientSecret: 'pi_123_secret',
      });
    });

    it('throws BadRequestException for zero amount', async () => {
      await expect(
        service.createPaymentIntent({
          id: '1',
          orderNumber: '2',
          userId: '3',
          totalAmount: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleWebhook', () => {
    const rawBody = Buffer.from('test');
    const signature = 'sig_123';

    it('throws BadRequestException on invalid signature', async () => {
      stripeMock.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(service.handleWebhook(rawBody, signature)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('handles payment_intent.succeeded', async () => {
      const paymentIntent = {
        id: 'pi_123',
        metadata: { orderId: 'order-1' },
      };

      stripeMock.webhooks.constructEvent.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: paymentIntent },
      });

      mockPrisma.payment.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});

      await service.handleWebhook(rawBody, signature);

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_123' },
        data: expect.objectContaining({ status: PaymentStatus.SUCCEEDED }),
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: OrderStatus.CONFIRMED },
      });
    });

    it('handles payment_intent.payment_failed', async () => {
      const paymentIntent = {
        id: 'pi_123',
        metadata: { orderId: 'order-1' },
      };

      stripeMock.webhooks.constructEvent.mockReturnValue({
        type: 'payment_intent.payment_failed',
        data: { object: paymentIntent },
      });

      mockPrisma.payment.update.mockResolvedValue({});

      await service.handleWebhook(rawBody, signature);

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_123' },
        data: expect.objectContaining({ status: PaymentStatus.FAILED }),
      });
    });

    it('handles charge.refunded', async () => {
      const charge = {
        payment_intent: 'pi_123',
      };

      stripeMock.webhooks.constructEvent.mockReturnValue({
        type: 'charge.refunded',
        data: { object: charge },
      });

      mockPrisma.payment.findUnique.mockResolvedValue({ orderId: 'order-1' });
      mockPrisma.payment.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});

      await service.handleWebhook(rawBody, signature);

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_123' },
        data: expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: OrderStatus.REFUNDED },
      });
    });
  });

  describe('refundPayment', () => {
    it('creates refund and updates records', async () => {
      mockPrisma.payment.update.mockResolvedValue({});
      mockPrisma.payment.findUnique.mockResolvedValue({ orderId: 'order-1' });
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.refundPayment('pi_123');

      expect(stripeMock.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_123',
        reason: 'requested_by_customer',
      });

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { stripePaymentIntentId: 'pi_123' },
        data: expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: OrderStatus.REFUNDED },
      });

      expect(result).toEqual({ refundId: 're_123', status: 'succeeded' });
    });
  });
});
