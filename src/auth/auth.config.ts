import type { Request, Response } from 'express';

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ACCESS_SECONDS,
  SESSION_COOKIE_OPTIONS,
} from '../common/constants/auth.constants';

export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  return req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function setSessionCookies(
  res: Response,
  session: { accessToken: string; refreshToken: string; expiresAt: Date; rememberMe: boolean },
  secure: boolean,
) {
  const options = {
    ...SESSION_COOKIE_OPTIONS,
    secure,
  };
  res.cookie(ACCESS_COOKIE, session.accessToken, { ...options, maxAge: ACCESS_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...options,
    ...(session.rememberMe ? { expires: session.expiresAt } : {}),
  });
}

export function clearSessionCookies(res: Response, secure: boolean) {
  const options = {
    ...SESSION_COOKIE_OPTIONS,
    secure,
  };
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}
