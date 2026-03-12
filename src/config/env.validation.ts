import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().integer().positive().default(3000),

  // Database
  DATABASE_URL: Joi.string().uri().required(),
  TEST_DATABASE_URL: Joi.string().uri().optional(),

  // Redis
  REDIS_HOST: Joi.string().hostname().default('localhost'),
  REDIS_PORT: Joi.number().integer().positive().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),
  REDIS_URL: Joi.string().optional(),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  // Stripe
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),

  // Mail
  MAIL_HOST: Joi.string().hostname().required(),
  MAIL_PORT: Joi.number().integer().positive().required(),
  MAIL_USER: Joi.string().optional().allow(''),
  MAIL_PASSWORD: Joi.string().optional().allow(''),
  MAIL_FROM: Joi.string().email().required(),
  MAIL_FROM_NAME: Joi.string().default('Ecommerce Store'),

  // File Uploads
  UPLOAD_DIR: Joi.string().default('./uploads'),
  MAX_FILE_SIZE_MB: Joi.number().integer().positive().default(5),

  // Frontend
  FRONTEND_URL: Joi.string().uri().required(),

  // Shipping
  FREE_SHIPPING_THRESHOLD: Joi.number().positive().default(100),
  FLAT_SHIPPING_RATE: Joi.number().positive().default(10),
});
