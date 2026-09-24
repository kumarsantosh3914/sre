import { Controller, Get, Query } from '@nestjs/common';
import { JwtAccessPayload } from '@sreai/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

class WindowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() user: JwtAccessPayload, @Query() q: WindowQueryDto) {
    return this.analytics.overview(user.tenantId, q.days);
  }

  // PRD: GET /analytics/mttr — MTTR trends over time by service.
  @Get('mttr')
  async mttr(@CurrentUser() user: JwtAccessPayload, @Query() q: WindowQueryDto) {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const [byService, trend] = await Promise.all([
      this.analytics.mttrByService(user.tenantId, since),
      this.analytics.mttrTrend(user.tenantId, since),
    ]);
    return { windowDays: q.days, byService, trend };
  }
}
