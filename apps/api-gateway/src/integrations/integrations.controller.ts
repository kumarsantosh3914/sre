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
import { ConfigService } from '@nestjs/config';
import { JwtAccessPayload } from '@sreai/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminOnly } from '../common/roles.decorator';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto';
import { IntegrationTesterService, TestResult } from './integration-tester.service';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly tester: IntegrationTesterService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(@CurrentUser() user: JwtAccessPayload) {
    return this.integrations.list(user.tenantId);
  }

  @Post()
  @AdminOnly()
  create(@CurrentUser() user: JwtAccessPayload, @Body() dto: CreateIntegrationDto) {
    return this.integrations.create(user.tenantId, dto);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.integrations.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.integrations.remove(user.tenantId, id);
  }

  @Post(':id/test')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  async test(
    @CurrentUser() user: JwtAccessPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestResult> {
    const integration = await this.integrations.find(user.tenantId, id);
    const result = await this.tester.test(
      user.tenantId,
      integration,
      this.integrations.credentials(integration),
      this.config.get<string>('SLACK_BOT_TOKEN') || undefined,
    );
    await this.integrations.recordTest(user.tenantId, id, result.ok ? null : result.message);
    return result;
  }
}
