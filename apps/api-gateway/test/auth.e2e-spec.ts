import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createTestDatabase, TestDatabase } from '@sreai/database/testing';
import { configureHttpApp } from '@sreai/shared/nest';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

jest.setTimeout(120_000);

const REFRESH_COOKIE_PREFIX = 'refresh_token=';

function extractRefreshCookie(setCookieHeader: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader].filter((c): c is string => Boolean(c));
  const cookie = cookies.find((c) => c.startsWith(REFRESH_COOKIE_PREFIX));
  if (!cookie) {
    throw new Error('refresh_token cookie was not set');
  }
  return cookie.split(';')[0];
}

// Real PostgreSQL: TEST_DATABASE_URL if set, otherwise a testcontainer.
describe('Auth (e2e, real Postgres)', () => {
  let db: TestDatabase;
  let app: INestApplication;

  beforeAll(async () => {
    db = await createTestDatabase();

    process.env.JWT_SECRET = 'e2e-test-access-secret-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret-at-least-32-characters';

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(db.options),
        AuthModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const credentials = { tenantName: 'Acme Inc', email: 'owner@acme.com', password: 'password123' };

  it('registers a tenant + owner user and returns an access token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(credentials)
      .expect(201);

    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ email: credentials.email, role: 'owner' });
    expect(extractRefreshCookie(res.headers['set-cookie'])).toContain(REFRESH_COOKIE_PREFIX);
  });

  it('rejects registering the same email twice', async () => {
    await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(409);
  });

  it('returns 409, not 500, when two concurrent registrations race on the same new email', async () => {
    const raceCredentials = {
      tenantName: 'Race Co',
      email: 'race@acme.com',
      password: 'password123',
    };

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').send(raceCredentials),
      request(app.getHttpServer()).post('/auth/register').send(raceCredentials),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects unauthenticated access to a protected route', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('logs in, accesses a protected route, refreshes, and logs out', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const accessToken = loginRes.body.data.accessToken as string;
    const firstRefreshCookie = extractRefreshCookie(loginRes.headers['set-cookie']);

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meRes.body.data).toMatchObject({ email: credentials.email, role: 'owner' });

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(200);
    const rotatedAccessToken = refreshRes.body.data.accessToken as string;
    const rotatedRefreshCookie = extractRefreshCookie(refreshRes.headers['set-cookie']);
    expect(rotatedAccessToken).toEqual(expect.any(String));
    // Refresh tokens carry a jti specifically so rotation always produces a
    // distinct token (see auth.service.ts) — this is the invariant that
    // actually matters, unlike access token identity, which isn't tracked.
    expect(rotatedRefreshCookie).not.toEqual(firstRefreshCookie);

    // The old refresh token was invalidated by rotation.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(200);

    // The (still-unexpired) refresh token is unusable once logged out.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', rotatedRefreshCookie)
      .expect(401);
  });
});
