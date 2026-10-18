import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { AuthSession } from '../entities/auth-session.entity';
import { readCookie } from '../auth.config';
import { ApiConfigService } from '../../config/api-config.service';
import { ACCESS_COOKIE, JWT_ALGORITHM } from '../../common/constants/auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    config: ApiConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => readCookie(req, ACCESS_COOKIE) || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
      algorithms: [JWT_ALGORITHM],
    });
  }

  async validate(payload: { sub: string; sid: string }) {
    if (!payload.sid || !payload.sub) throw new UnauthorizedException('Invalid session.');
    const session = await this.sessions.findOne({
      where: { id: payload.sid, userId: payload.sub },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired.');
    }
    const user = await this.users.findOne({ where: { id: payload.sub, isActive: true } });
    if (!user) throw new UnauthorizedException('Account is inactive.');
    return user;
  }
}
