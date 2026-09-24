import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { JwtAccessPayload } from '@sreai/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AuditExportQueryDto,
  DecisionDto,
  ListIncidentsQueryDto,
  ManualActionDto,
  ResolveIncidentDto,
} from './dto/incident.dto';
import { auditCsv, auditView } from './incident.views';
import { IncidentsService } from './incidents.service';

interface Accepted {
  accepted: true;
}

// Mutations return 202: they're queued for the service that owns the
// state change; the dashboard sees the result over the realtime socket.
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload, @Query() query: ListIncidentsQueryDto) {
    return this.incidents.list(user.tenantId, query);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.detail(user.tenantId, id);
  }

  @Get(':id/diagnosis')
  diagnosis(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.diagnosis(user.tenantId, id);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.incidents.timeline(user.tenantId, id);
  }

  // Audit export for post-mortems: JSON (enveloped) or a CSV download.
  @Get(':id/audit')
  @Header('Cache-Control', 'no-store')
  async audit(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AuditExportQueryDto,
  ) {
    const events = await this.incidents.auditLog(user.tenantId, id);
    if (query.format === 'csv') {
      return new StreamableFile(Buffer.from(auditCsv(events), 'utf8'), {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="incident-${id}-audit.csv"`,
      });
    }
    return events.map(auditView);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.ACCEPTED)
  async resolve(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIncidentDto,
  ): Promise<Accepted> {
    await this.incidents.resolve(user.tenantId, id, user.sub, dto.note ?? null);
    return { accepted: true };
  }

  @Post(':id/actions')
  @HttpCode(HttpStatus.ACCEPTED)
  async manualAction(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualActionDto,
  ): Promise<Accepted> {
    await this.incidents.manualAction(user.tenantId, id, user.sub, dto);
    return { accepted: true };
  }

  @Post(':id/actions/:actionId/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approve(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ): Promise<Accepted> {
    await this.incidents.decide(user.tenantId, id, actionId, user.sub, 'approve', null);
    return { accepted: true };
  }

  @Post(':id/actions/:actionId/reject')
  @HttpCode(HttpStatus.ACCEPTED)
  async reject(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: DecisionDto,
  ): Promise<Accepted> {
    await this.incidents.decide(
      user.tenantId,
      id,
      actionId,
      user.sub,
      'reject',
      dto.reason ?? null,
    );
    return { accepted: true };
  }

  @Post(':id/actions/:actionId/rollback')
  @HttpCode(HttpStatus.ACCEPTED)
  async rollbackAction(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ): Promise<Accepted & { actionId: string }> {
    return {
      accepted: true,
      actionId: await this.incidents.rollback(user.tenantId, id, actionId, user.sub),
    };
  }

  // PRD: POST /incidents/:id/rollback — the last auto-executed action.
  @Post(':id/rollback')
  @HttpCode(HttpStatus.ACCEPTED)
  async rollbackLast(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Accepted & { actionId: string }> {
    return {
      accepted: true,
      actionId: await this.incidents.rollback(user.tenantId, id, null, user.sub),
    };
  }
}
