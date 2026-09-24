import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedisClient } from '@sreai/queue';
import { JwtAccessPayload, REALTIME_CHANNEL, RealtimeEventSchema, errorMeta } from '@sreai/shared';
import IORedis from 'ioredis';
import { Server, Socket } from 'socket.io';

export const tenantRoom = (tenantId: string): string => `tenant:${tenantId}`;

// Live dashboard updates. Services publish incident events on the
// REALTIME_CHANNEL Redis channel; every gateway instance subscribes and
// emits to its own sockets in the event's tenant room (server.local, so an
// event isn't re-broadcast through the Redis adapter N times). The Redis
// adapter keeps rooms and gateway-originated broadcasts correct across
// instances.
@WebSocketGateway({
  path: '/realtime',
  cors: { origin: process.env.DASHBOARD_URL ?? 'http://localhost:3100', credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private clients: IORedis[] = [];

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    if (process.env.REALTIME_ENABLED === 'false') return;
    const pub = createRedisClient();
    const sub = createRedisClient();
    const events = createRedisClient();
    this.clients = [pub, sub, events];
    for (const client of this.clients) {
      client.on('error', (err: Error) => this.logger.warn('Realtime Redis error', errorMeta(err)));
    }
    server.adapter(createAdapter(pub, sub));

    events
      .subscribe(REALTIME_CHANNEL)
      .catch((err: unknown) =>
        this.logger.error('Realtime channel subscription failed', errorMeta(err)),
      );
    events.on('message', (channel: string, message: string) => {
      if (channel !== REALTIME_CHANNEL) return;
      this.relay(message);
    });
  }

  relay(message: string): void {
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      return;
    }
    const event = RealtimeEventSchema.safeParse(json);
    if (!event.success) return;
    this.server.local.to(tenantRoom(event.data.tenantId)).emit('incident.event', event.data);
  }

  async handleConnection(client: Socket): Promise<void> {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    const token = typeof auth?.token === 'string' ? auth.token : undefined;
    try {
      if (!token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      await client.join(tenantRoom(payload.tenantId));
      client.data.tenantId = payload.tenantId;
    } catch (err) {
      this.logger.warn('Realtime connection rejected', errorMeta(err));
      client.emit('error', { message: 'unauthorized' });
      client.disconnect(true);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.server) {
      // Nest closes the Socket.IO server *after* module-destroy hooks, and
      // that close calls adapter.close() (Redis unsubscribes) without
      // awaiting it — on connections quit below. Close the adapter here,
      // then make the later call a no-op.
      const adapter = this.server.of('/').adapter;
      await Promise.resolve(adapter.close()).catch(() => undefined);
      adapter.close = (): Promise<void> => Promise.resolve();
    }
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
  }
}
