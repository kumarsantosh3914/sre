import { Module } from '@nestjs/common';
import { MEMORY_QUEUE } from '../common/tokens';
import { DiagnosisModule } from '../diagnosis/diagnosis.module';
import { MemoryQueue, createMemoryQueue } from './memory.queue';
import { MemoryService } from './memory.service';
import { MemoryWorker } from './memory.worker';
import { PostmortemStorage } from './postmortem-storage.service';
import { PreventionService } from './prevention.service';

@Module({
  imports: [DiagnosisModule],
  providers: [
    { provide: MEMORY_QUEUE, useFactory: createMemoryQueue },
    MemoryQueue,
    MemoryService,
    MemoryWorker,
    PreventionService,
    PostmortemStorage,
  ],
  exports: [MemoryQueue, MemoryService],
})
export class MemoryModule {}
