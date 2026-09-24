import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Tenant } from '@sreai/database';
import {
  JwtAccessPayload,
  TenantSettings,
  TenantSettingsSchema,
  parseTenantSettings,
} from '@sreai/shared';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminOnly } from '../common/roles.decorator';
import { UpdateSettingsDto } from './dto/settings.dto';

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@Controller('settings')
export class SettingsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async get(
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<{ name: string; slug: string; settings: TenantSettings }> {
    const tenant = await this.ds.getRepository(Tenant).findOne({ where: { id: user.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return { name: tenant.name, slug: tenant.slug, settings: parseTenantSettings(tenant.settings) };
  }

  @Patch()
  @AdminOnly()
  async update(
    @CurrentUser() user: JwtAccessPayload,
    @Body() dto: UpdateSettingsDto,
  ): Promise<TenantSettings> {
    const repo = this.ds.getRepository(Tenant);
    const tenant = await repo.findOne({ where: { id: user.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const merged = TenantSettingsSchema.safeParse({
      ...parseTenantSettings(tenant.settings),
      ...dto.settings,
    });
    if (!merged.success) {
      throw new BadRequestException({
        message: merged.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const s = merged.data;
    if (!validTimezone(s.timezone))
      throw new BadRequestException(`Unknown timezone "${s.timezone}"`);
    const auto = s.autoThreshold ?? 0.85;
    const draft = s.draftThreshold ?? 0.6;
    if (draft >= auto) throw new BadRequestException('draftThreshold must be below autoThreshold');

    tenant.settings = s;
    await repo.save(tenant);
    return s;
  }
}
