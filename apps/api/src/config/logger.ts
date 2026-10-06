import pino from 'pino';
import { env, isDev, isTest } from './env';

export const logger = pino({
  level: env.LOG_LEVEL ?? (isTest ? 'silent' : isDev ? 'debug' : 'info'),
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
});
