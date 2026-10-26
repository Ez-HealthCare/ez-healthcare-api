import { Body, Controller, Get, Param, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { toUserFull, toUserPublic } from '../common/dto/response.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Staff directory — returns public profile only.
   * RECEPTIONIST and ADMIN additionally receive nationalId + insuranceCardNumber
   * via the role-aware service call below.
   */
  @Get()
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE)
  @ApiOperation({ summary: 'List all active hospital users and staff' })
  @ApiResponse({
    status: 200,
    description: 'List of users retrieved (PII fields limited by caller role)',
  })
  async findAll(@Request() req: any) {
    const callerRole: Role = req.user?.role;
    return this.userService.findAll(callerRole);
  }

  @Get('me/profile')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Get the authenticated patient\'s full personal profile' })
  async getMyProfile(@Request() req: any) {
    return toUserFull(await this.userService.getMyProfile(req.user.id));
  }

  @Put('me/profile')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Complete or update the authenticated patient\'s personal profile' })
  async updateMyProfile(@Request() req: any, @Body() dto: UpdateMyProfileDto) {
    return toUserFull(await this.userService.updateMyProfile(req.user.id, dto));
  }

  /**
   * Reception identity audit — lookup patient by National ID.
   * Restricted to RECEPTIONIST and ADMIN; returns full PII for physical document verification.
   */
  @Get('audit/national-id/:nationalId')
  @Roles(Role.RECEPTIONIST, Role.ADMIN)
  @ApiOperation({
    summary: 'Reception audit: lookup patient by National ID (RECEPTIONIST/ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Patient record matched with full identity details' })
  @ApiResponse({ status: 404, description: 'National ID not found' })
  async findByNationalId(@Param('nationalId') nationalId: string) {
    const user = await this.userService.findByNationalId(nationalId);
    return toUserFull(user);
  }

  /**
   * Individual user profile. This dynamic route must remain below all static
   * /users paths, otherwise it would capture paths such as /users/audit/....
   */
  @Get(':id')
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.PATIENT)
  @ApiOperation({ summary: 'Find user profile by ID (PII filtered by caller role)' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  @ApiResponse({ status: 403, description: 'Patients may only access their own profile' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findById(@Param('id') id: string, @Request() req: any) {
    const caller = req.user;
    if (caller.role === Role.PATIENT && caller.id !== id) {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Patients may only access their own profile.');
    }

    const user = await this.userService.findById(id);
    const isPiiRole = [Role.ADMIN, Role.RECEPTIONIST].includes(caller.role);
    return isPiiRole ? toUserFull(user) : toUserPublic(user);
  }
}
