import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Determine SSL settings based on DATABASE_URL
// - localhost/127.0.0.1: no SSL (local development)
// - AWS RDS: no SSL (rds.force_ssl=0 for POC)
const dbUrl = process.env.DATABASE_URL || '';
const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');

// Create PostgreSQL connection pool
// SSL is disabled for both local and AWS RDS (POC mode)
const connectionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

// Create Prisma adapter for PostgreSQL
const adapter = new PrismaPg(connectionPool);

// PrismaClient singleton for Next.js
// Prevents multiple instances during development hot reload

const globalForPrisma = globalThis as unknown as {
  prisma: InstanceType<typeof PrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
