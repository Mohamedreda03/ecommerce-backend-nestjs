import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { getQueueToken } from '@nestjs/bull';

describe('MailService', () => {
  let service: MailService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: getQueueToken('email'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should queue a welcome email', async () => {
    await service.sendWelcome('test@example.com', 'John');
    expect(mockQueue.add).toHaveBeenCalledWith('welcome', {
      email: 'test@example.com',
      firstName: 'John',
    });
  });

  it('should queue a password reset email', async () => {
    await service.sendPasswordReset('test@example.com', 'http://reset');
    expect(mockQueue.add).toHaveBeenCalledWith('password-reset', {
      email: 'test@example.com',
      resetUrl: 'http://reset',
    });
  });

  it('should queue an order confirmation email', async () => {
    const order = { orderNumber: 'ORD-123', totalAmount: 100, items: [] };
    await service.sendOrderConfirmation(order, 'test@example.com');
    expect(mockQueue.add).toHaveBeenCalledWith('order-confirmation', {
      order,
      email: 'test@example.com',
    });
  });

  it('should queue an order shipped email', async () => {
    const order = { orderNumber: 'ORD-123' };
    await service.sendOrderShipped(order, 'test@example.com', 'TRK123');
    expect(mockQueue.add).toHaveBeenCalledWith('order-shipped', {
      order,
      email: 'test@example.com',
      trackingInfo: 'TRK123',
    });
  });

  it('should queue an order delivered email', async () => {
    const order = { orderNumber: 'ORD-123' };
    await service.sendOrderDelivered(order, 'test@example.com');
    expect(mockQueue.add).toHaveBeenCalledWith('order-delivered', {
      order,
      email: 'test@example.com',
    });
  });
});
