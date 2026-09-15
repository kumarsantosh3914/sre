import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';

// Deliberately doesn't boot AppModule: that now wires TypeOrmModule and
// AuthModule, which need a live Postgres and JWT secrets. A health check
// smoke test shouldn't require either — see auth.e2e-spec.ts for the
// full-app test against a real (testcontainers) Postgres.
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', service: 'api-gateway' });
  });
});
