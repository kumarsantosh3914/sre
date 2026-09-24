import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integration } from '@sreai/database';
import { CommandBus } from './command-bus.service';
import { INTEGRATION_READER, integrationReaderProvider } from './integration-reader.provider';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Integration])],
  providers: [CommandBus, integrationReaderProvider],
  exports: [CommandBus, INTEGRATION_READER],
})
export class CommonModule {}
