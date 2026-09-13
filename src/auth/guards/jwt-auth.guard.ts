import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AUTH_CONSTANTS } from '../constants/auth.constants';

@Injectable()
export class JwtAuthGuard extends AuthGuard(AUTH_CONSTANTS.STRATEGY_JWT) {}
