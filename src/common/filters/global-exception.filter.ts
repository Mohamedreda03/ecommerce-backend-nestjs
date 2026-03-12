import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/client';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.resolveError(exception);

    const body: ErrorResponse = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
  } {
    // ThrottlerException — must be checked before HttpException (it extends it)
    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests. Please slow down.',
        error: 'Too Many Requests',
      };
    }

    // HttpException (including NestJS built-ins like NotFoundException, etc.)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      return {
        statusCode: status,
        message: Array.isArray(message) ? message.join('; ') : String(message),
        error: exception.name,
      };
    }

    // Prisma known request errors
    if (exception instanceof PrismaClientKnownRequestError) {
      return this.resolvePrismaKnownError(exception);
    }

    // Prisma validation error (wrong types / missing required fields in query)
    if (exception instanceof PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid data provided.',
        error: 'Bad Request',
      };
    }

    // Unknown / unhandled errors — log full stack, return generic message
    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred.',
      error: 'Internal Server Error',
    };
  }

  private resolvePrismaKnownError(exception: PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
    error: string;
  } {
    switch (exception.code) {
      case 'P2002': {
        const fields = Array.isArray(exception.meta?.['target'])
          ? (exception.meta['target'] as string[]).join(', ')
          : 'field';
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `A record with this ${fields} already exists.`,
          error: 'Conflict',
        };
      }
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found.',
          error: 'Not Found',
        };
      case 'P2003': {
        const field = exception.meta?.['field_name']
          ? String(exception.meta['field_name'])
          : 'related record';
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: `Foreign key constraint failed on: ${field}.`,
          error: 'Bad Request',
        };
      }
      case 'P2028':
        return {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Transaction timed out. Please try again.',
          error: 'Service Unavailable',
        };
      default:
        this.logger.error(
          `Unhandled Prisma error code: ${exception.code}`,
          exception.stack,
        );
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred.',
          error: 'Internal Server Error',
        };
    }
  }
}
