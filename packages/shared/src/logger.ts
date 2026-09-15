import { createLogger, format, transports, Logger } from 'winston';

export function createWinstonLogger(serviceName: string): Logger {
  return createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    defaultMeta: { service: serviceName },
    format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
    transports: [new transports.Console()],
  });
}
