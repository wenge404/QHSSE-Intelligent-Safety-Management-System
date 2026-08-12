import { createApp } from './app';
import { config } from './config/env';
import { prisma } from './config/prisma';

async function main() {
  await prisma.$connect();

  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`IQSMS API listening on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`  predictive service: ${config.mlServiceUrl}`);
  });

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received, shutting down.`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start API:', error);
  await prisma.$disconnect();
  process.exit(1);
});
