import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { User } from '@sreai/database';
import { JwtAccessPayload, UserRole } from '@sreai/shared';
import { IsEnum } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../common/roles.decorator';

class UpdateRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}

@Controller('team')
export class TeamController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async list(@CurrentUser() user: JwtAccessPayload) {
    const users = await this.ds
      .getRepository(User)
      .find({ where: { tenantId: user.tenantId }, order: { createdAt: 'ASC' } });
    return users.map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt }));
  }

  @Patch(':id/role')
  @Roles(UserRole.OWNER)
  async updateRole(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    if (id === user.sub) throw new BadRequestException('You cannot change your own role');
    const res = await this.ds
      .getRepository(User)
      .update({ tenantId: user.tenantId, id }, { role: dto.role });
    if (!res.affected) throw new NotFoundException('User not found');
    return { id, role: dto.role };
  }
}
