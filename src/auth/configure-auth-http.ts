import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ApiConfigService } from '../config/api-config.service';
import { API_PREFIX } from '../common/constants/app.constants';
import {
  AUTH_CONTROLLER_PATH,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
  AUTH_RATE_LIMIT_MAX_IPS,
} from '../common/constants/auth.constants';

export function configureAuthHttp(app: INestApplication, config: ApiConfigService) {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const origins = config.corsOrigins;
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  // ponytail: per-process rate limit; use a shared limiter before running multiple API replicas.
  const attempts = new Map<string, { count: number; until: number }>();
  app.use(
    `/${API_PREFIX}/${AUTH_CONTROLLER_PATH}`,
    (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !origins.includes(origin)) {
          res.status(403).json({ message: 'Origin is not allowed.' });
          return;
        }
        const key = req.ip || 'unknown';
        const now = Date.now();
        for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
        const entry = attempts.get(key) || { count: 0, until: now + AUTH_RATE_LIMIT_WINDOW_MS };
        entry.count += 1;
        if (!attempts.has(key) && attempts.size >= AUTH_RATE_LIMIT_MAX_IPS) {
          res.status(429).json({ message: 'Too many requests.' });
          return;
        }
        attempts.set(key, entry);
        if (entry.count > AUTH_RATE_LIMIT_MAX_REQUESTS) {
          res.setHeader('Retry-After', String(AUTH_RATE_LIMIT_WINDOW_MS / 1000));
          res.status(429).json({ message: 'Too many requests. Try again in one minute.' });
          return;
        }
      }
      next();
    },
  );
}
