import { HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/client';
import { GlobalExceptionFilter } from './global-exception.filter';

const mockJson = jest.fn();
const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
const mockGetResponse = jest.fn().mockReturnValue({ status: mockStatus });
const mockGetRequest = jest.fn().mockReturnValue({ url: '/api/v1/test' });

const mockHost = {
  switchToHttp: () => ({
    getResponse: mockGetResponse,
    getRequest: mockGetRequest,
  }),
} as any;

function getResponseBody() {
  return mockJson.mock.calls[0][0];
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new GlobalExceptionFilter();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('HttpException', () => {
    it('should return correct status and message for HttpException', () => {
      filter.catch(
        new HttpException('Not found', HttpStatus.NOT_FOUND),
        mockHost,
      );
      expect(mockStatus).toHaveBeenCalledWith(404);
      const body = getResponseBody();
      expect(body.statusCode).toBe(404);
      expect(body.message).toBe('Not found');
      expect(body.path).toBe('/api/v1/test');
      expect(body.timestamp).toBeDefined();
    });

    it('should join array messages from ValidationPipe errors', () => {
      const exception = new HttpException(
        { message: ['field is required', 'field must be a string'], error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
      filter.catch(exception, mockHost);
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(getResponseBody().message).toBe(
        'field is required; field must be a string',
      );
    });
  });

  describe('ThrottlerException', () => {
    it('should return 429 Too Many Requests', () => {
      filter.catch(new ThrottlerException(), mockHost);
      expect(mockStatus).toHaveBeenCalledWith(429);
      const body = getResponseBody();
      expect(body.statusCode).toBe(429);
      expect(body.error).toBe('Too Many Requests');
    });
  });

  describe('PrismaClientKnownRequestError', () => {
    function makePrismaError(
      code: string,
      meta?: Record<string, unknown>,
    ): PrismaClientKnownRequestError {
      const err = new PrismaClientKnownRequestError('db error', {
        code,
        clientVersion: '7.0.0',
        meta,
      });
      return err;
    }

    it('P2002 — should return 409 Conflict with field names', () => {
      filter.catch(
        makePrismaError('P2002', { target: ['email'] }),
        mockHost,
      );
      expect(mockStatus).toHaveBeenCalledWith(409);
      const body = getResponseBody();
      expect(body.statusCode).toBe(409);
      expect(body.error).toBe('Conflict');
      expect(body.message).toContain('email');
    });

    it('P2025 — should return 404 Not Found', () => {
      filter.catch(makePrismaError('P2025'), mockHost);
      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(getResponseBody().error).toBe('Not Found');
    });

    it('P2003 — should return 400 Bad Request with field name', () => {
      filter.catch(
        makePrismaError('P2003', { field_name: 'userId' }),
        mockHost,
      );
      expect(mockStatus).toHaveBeenCalledWith(400);
      const body = getResponseBody();
      expect(body.statusCode).toBe(400);
      expect(body.message).toContain('userId');
    });

    it('P2028 — should return 503 Service Unavailable', () => {
      filter.catch(makePrismaError('P2028'), mockHost);
      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(getResponseBody().error).toBe('Service Unavailable');
    });

    it('unknown Prisma code — should return 500', () => {
      filter.catch(makePrismaError('P9999'), mockHost);
      expect(mockStatus).toHaveBeenCalledWith(500);
    });
  });

  describe('PrismaClientValidationError', () => {
    it('should return 400 Bad Request', () => {
      const err = new PrismaClientValidationError('bad query', {
        clientVersion: '7.0.0',
      });
      filter.catch(err, mockHost);
      expect(mockStatus).toHaveBeenCalledWith(400);
      const body = getResponseBody();
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe('Bad Request');
    });
  });

  describe('Unknown errors', () => {
    it('should return 500 for generic Error', () => {
      filter.catch(new Error('Something broke'), mockHost);
      expect(mockStatus).toHaveBeenCalledWith(500);
      const body = getResponseBody();
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('An unexpected error occurred.');
      // Must not leak internal error details
      expect(body.message).not.toContain('Something broke');
    });

    it('should return 500 for thrown string', () => {
      filter.catch('raw string error', mockHost);
      expect(mockStatus).toHaveBeenCalledWith(500);
    });
  });
});
