import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident, MonitoredService } from '@sreai/database';
import { DiagnosisModule } from '../diagnosis/diagnosis.module';
import { MemoryModule } from '../memory/memory.module';
import { IncidentIntakeService } from './incident-intake.service';
import { IntakeConsumer } from './intake.consumer';
import { ResolutionHooks } from './resolution-hooks';

@Module({
  imports: [TypeOrmModule.forFeature([Incident, MonitoredService]), DiagnosisModule, MemoryModule],
  providers: [IncidentIntakeService, IntakeConsumer, ResolutionHooks],
  exports: [IncidentIntakeService],
})
export class IntakeModule {}
