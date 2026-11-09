import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from '../common/types.js';
import { DiscoverIconDto, IconDto } from './dto.js';
import { IconsService } from './icons.service.js';
@Controller('app/deskicons/api')
export class IconsController {
  constructor(@Inject(IconsService) private readonly service: IconsService) {}
  @Get('state')
  async getState(@Req() req: ApiRequest) {
    return this.service.state(req.hostname);
  }
  @Get('entries')
  async getEntries() {
    return this.service.listEntries();
  }
  @Get('containers')
  async getContainers() {
    return this.service.containers();
  }
  @HttpCode(200)
  @Post('discover-icon')
  async postDiscoverIcon(@Body() inputDto: DiscoverIconDto) {
    return this.service.discover(inputDto);
  }
  @HttpCode(201)
  @Post('entries')
  async postEntries(@Body() inputDto: IconDto) {
    return this.service.createEntry(inputDto);
  }
  @Put('entries/:id')
  async putEntriesById(@Req() req: ApiRequest, @Body() inputDto: IconDto) {
    return this.service.updateEntry(req.params.id, inputDto);
  }
  @Get('entries/:id/icon')
  async getEntriesByIdIcon(@Req() req: ApiRequest, @Res() res: Response) {
    res.type('png').send(this.service.image(req.params.id));
  }
  @HttpCode(200)
  @Post('entries/:id/apply')
  async postEntriesByIdApply(@Req() req: ApiRequest) {
    return this.service.applyEntry(req.params.id);
  }
  @Get('entries/:id/package')
  async getEntriesByIdPackage(@Req() req: ApiRequest, @Res() res: Response) {
    const download = await this.service.packageEntry(req.params.id);
    res.download(download.file, download.name, () => {
      void download.cleanup();
    });
  }
  @HttpCode(204)
  @Delete('entries/:id')
  async deleteEntriesById(@Req() req: ApiRequest) {
    return this.service.removeEntry(req.params.id);
  }
}
