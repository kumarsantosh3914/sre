import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Incident, MonitoredService } from '@sreai/database';
import { IncidentStatus, ServiceMetadata, ServiceMetadataSchema } from '@sreai/shared';
import { DataSource, QueryFailedError } from 'typeorm';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

export type ServiceHealth = 'healthy' | 'degraded' | 'down';

function parseMetadata(raw: Record<string, unknown> | undefined): ServiceMetadata {
  const parsed = ServiceMetadataSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return parsed.data;
}

@Injectable()
export class ServicesService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Health = worst open incident: an open P1 → down, any other open
  // incident → degraded, none → healthy.
  async list(tenantId: string) {
    const services = await this.ds
      .getRepository(MonitoredService)
      .find({ where: { tenantId }, order: { name: 'ASC' } });
    const open: { service_id: string; open: number; p1: number; last: Date | null }[] =
      await this.ds
        .getRepository(Incident)
        .createQueryBuilder('i')
        .select('i.service_id', 'service_id')
        .addSelect(`count(*) FILTER (WHERE i.status <> :resolved)::int`, 'open')
        .addSelect(`count(*) FILTER (WHERE i.status <> :resolved AND i.severity = 'p1')::int`, 'p1')
        .addSelect('max(i.detected_at)', 'last')
        .where('i.tenant_id = :tenantId', { tenantId, resolved: IncidentStatus.RESOLVED })
        .andWhere('i.parent_incident_id IS NULL')
        .groupBy('i.service_id')
        .getRawMany();
    const byId = new Map(open.map((o) => [o.service_id, o]));

    return services.map((s) => {
      const stats = byId.get(s.id);
      const health: ServiceHealth = stats?.p1 ? 'down' : stats?.open ? 'degraded' : 'healthy';
      return {
        id: s.id,
        name: s.name,
        alwaysEscalate: s.alwaysEscalate,
        autoExecuteEnabled: s.autoExecuteEnabled,
        metadata: s.metadata,
        health,
        openIncidents: stats?.open ?? 0,
        lastIncidentAt: stats?.last ?? null,
        createdAt: s.createdAt,
      };
    });
  }

  async create(tenantId: string, dto: CreateServiceDto): Promise<MonitoredService> {
    const metadata = parseMetadata(dto.metadata);
    try {
      return await this.ds.getRepository(MonitoredService).save({
        tenantId,
        name: dto.name,
        alwaysEscalate: dto.alwaysEscalate ?? false,
        autoExecuteEnabled: dto.autoExecuteEnabled ?? false,
        metadata,
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('A service with that name already exists');
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateServiceDto): Promise<MonitoredService> {
    const repo = this.ds.getRepository(MonitoredService);
    const service = await repo.findOne({ where: { tenantId, id } });
    if (!service) throw new NotFoundException('Service not found');
    if (dto.metadata !== undefined) service.metadata = parseMetadata(dto.metadata);
    if (dto.alwaysEscalate !== undefined) service.alwaysEscalate = dto.alwaysEscalate;
    if (dto.autoExecuteEnabled !== undefined) service.autoExecuteEnabled = dto.autoExecuteEnabled;
    return repo.save(service);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const res = await this.ds.getRepository(MonitoredService).delete({ tenantId, id });
    if (!res.affected) throw new NotFoundException('Service not found');
  }
}
