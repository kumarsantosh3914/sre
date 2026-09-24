import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

@Module({ imports: [JwtModule.register({})], providers: [RealtimeGateway] })
export class RealtimeModule {}
