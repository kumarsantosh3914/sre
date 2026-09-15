import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('reports ok status with the service name', () => {
    expect(controller.check()).toEqual({ status: 'ok', service: 'api-gateway' });
  });
});
