import { parseRedisUrl } from './redis-connection';

describe('parseRedisUrl', () => {
  it('parses host and port', () => {
    expect(parseRedisUrl('redis://localhost:6380')).toMatchObject({
      host: 'localhost',
      port: 6380,
      db: 0,
    });
  });

  it('parses credentials, db and TLS', () => {
    const opts = parseRedisUrl('rediss://user:p%40ss@cache.aws:6379/2');
    expect(opts).toMatchObject({ username: 'user', password: 'p@ss', db: 2, tls: {} });
  });
});
