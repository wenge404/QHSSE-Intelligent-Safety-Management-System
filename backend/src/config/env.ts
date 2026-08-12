import dotenv from 'dotenv';
import path from 'path';

// backend/src/config/env.ts -> backend/.env
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  mlServiceUrl: process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8000',
  isProduction: process.env.NODE_ENV === 'production',
};
