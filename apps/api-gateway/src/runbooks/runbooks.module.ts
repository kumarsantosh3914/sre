import { Module } from '@nestjs/common';
import { RunbooksController } from './runbooks.controller';

@Module({ controllers: [RunbooksController] })
export class RunbooksModule {}
