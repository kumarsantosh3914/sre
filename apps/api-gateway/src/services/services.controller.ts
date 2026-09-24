import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { JwtAccessPayload } from '@sreai/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminOnly } from '../common/roles.decorator';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload) {
    return this.services.list(user.tenantId);
  }

  @Post()
  @AdminOnly()
  create(@CurrentUser() user: JwtAccessPayload, @Body() dto: CreateServiceDto) {
    return this.services.create(user.tenantId, dto);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.services.remove(user.tenantId, id);
  }
}
