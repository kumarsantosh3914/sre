import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { JwtAccessPayload } from '@sreai/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminOnly } from '../common/roles.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Controller('api-keys')
@AdminOnly()
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload) {
    return this.keys.list(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: JwtAccessPayload, @Body() dto: CreateApiKeyDto) {
    return this.keys.create(user.tenantId, dto.name);
  }

  @Post(':id/rotate')
  rotate(@CurrentUser() user: JwtAccessPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.rotate(user.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.keys.revoke(user.tenantId, id);
  }
}
