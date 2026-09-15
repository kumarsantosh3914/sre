import { FindOptionsWhere, Repository } from 'typeorm';

// Every entity must have a `tenantId` column; every query must be scoped to
// it. Extend this instead of calling `Repository` methods directly. See
// CLAUDE.md non-negotiable rule #3.
export abstract class BaseTenantRepository<T extends { tenantId: string }> {
  protected constructor(protected readonly repo: Repository<T>) {}

  findAll(tenantId: string): Promise<T[]> {
    return this.repo.find({ where: { tenantId } as FindOptionsWhere<T> });
  }

  findOne(tenantId: string, id: string): Promise<T | null> {
    return this.repo.findOne({
      where: { tenantId, id } as unknown as FindOptionsWhere<T>,
    });
  }
}
