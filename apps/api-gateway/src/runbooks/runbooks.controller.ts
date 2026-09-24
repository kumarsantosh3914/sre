import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Incident, MonitoredService, Postmortem, Runbook } from '@sreai/database';
import { JwtAccessPayload } from '@sreai/shared';
import { IsIn, IsOptional } from 'class-validator';
import { DataSource, In } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

class DownloadQueryDto {
  @IsOptional()
  @IsIn(['json', 'markdown'])
  format?: 'json' | 'markdown';
}

@Controller()
export class RunbooksController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get('runbooks')
  async list(@CurrentUser() user: JwtAccessPayload) {
    const runbooks = await this.ds.getRepository(Runbook).find({
      where: { tenantId: user.tenantId },
      order: { updatedAt: 'DESC' },
    });
    const serviceIds = [
      ...new Set(runbooks.map((r) => r.serviceId).filter((id): id is string => Boolean(id))),
    ];
    const services = serviceIds.length
      ? await this.ds
          .getRepository(MonitoredService)
          .find({ where: { tenantId: user.tenantId, id: In(serviceIds) } })
      : [];
    return runbooks.map((r) => ({
      id: r.id,
      title: r.title,
      service: services.find((s) => s.id === r.serviceId)?.name ?? null,
      incidentCount: r.incidentIds.length,
      version: r.version,
      updatedAt: r.updatedAt,
    }));
  }

  @Get('runbooks/:id')
  async get(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseUUIDPipe) id: string) {
    const runbook = await this.ds
      .getRepository(Runbook)
      .findOne({ where: { tenantId: user.tenantId, id } });
    if (!runbook) throw new NotFoundException('Runbook not found');
    return runbook;
  }

  @Get('incidents/:id/postmortem')
  async postmortem(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DownloadQueryDto,
  ) {
    const incident = await this.ds
      .getRepository(Incident)
      .findOne({ where: { tenantId: user.tenantId, id } });
    if (!incident) throw new NotFoundException('Incident not found');
    const postmortem = await this.ds
      .getRepository(Postmortem)
      .findOne({ where: { tenantId: user.tenantId, incidentId: id } });
    if (!postmortem) throw new NotFoundException('Post-mortem not generated yet');
    if (query.format === 'markdown') {
      return new StreamableFile(Buffer.from(postmortem.markdown, 'utf8'), {
        type: 'text/markdown; charset=utf-8',
        disposition: `attachment; filename="postmortem-${id}.md"`,
      });
    }
    return {
      incidentId: id,
      markdown: postmortem.markdown,
      prevention: postmortem.prevention,
      storageKey: postmortem.storageKey,
      createdAt: postmortem.createdAt,
    };
  }
}
