import { SetMetadata } from '@nestjs/common';
import { Role } from '../../user/enums/role.enum';

import { ROLES_KEY } from '../../common/constants/auth.constants';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
