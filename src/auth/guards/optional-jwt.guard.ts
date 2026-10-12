import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * OptionalJwtGuard — attempts JWT validation but does NOT throw on missing token.
 * Useful for endpoints that are public but can still receive richer data when authenticated
 * (e.g., hall-ticket check-in can be used by both anonymous kiosk and logged-in patient).
 *
 * If a valid token is present → req.user is populated.
 * If no token (or invalid) → req.user remains undefined, request proceeds.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  // Override handleRequest so a missing/invalid token is silently ignored

  handleRequest(_err: any, user: any) {
    // Return user if valid, otherwise return null (no exception thrown)
    return user || null;
  }
}
