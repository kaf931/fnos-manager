import { PageDto } from '../common/page.dto.js';
import { operationActions, operationStatuses } from '../../domain/operations.js';
import { IsIn, IsInt } from 'class-validator';
import type { OperationRetention } from '../../domain/operations.js';
export class SettingsDto {
  @IsInt() @IsIn([100, 500, 1000, 5000]) declare retention: OperationRetention;
}

export class OperationPageDto extends PageDto {
  @IsIn(['all', ...operationActions]) action = 'all';
  @IsIn(['all', ...operationStatuses]) status = 'all';
}
