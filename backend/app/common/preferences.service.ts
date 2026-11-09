import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../persistence/database.service.js';
import {
  PreferencesRepository,
  type UserPreferences,
} from '../../persistence/preferences.repository.js';
@Injectable()
export class PreferencesService {
  private readonly repository: PreferencesRepository;
  constructor(@Inject(DatabaseService) database: DatabaseService) {
    this.repository = new PreferencesRepository(database);
  }
  get(owner: string) {
    return this.repository.get(owner);
  }
  save(owner: string, input: Partial<UserPreferences>) {
    return this.repository.save(owner, input);
  }
}
