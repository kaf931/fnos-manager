import type { IconEntry } from './domain/icons.js';
import { DatabaseService } from './persistence/database.service.js';
import { IconRepository } from './persistence/icon.repository.js';
export class Store {
  private readonly repository: IconRepository;
  constructor(
    readonly dir: string,
    database?: DatabaseService,
  ) {
    this.repository = new IconRepository(database ?? new DatabaseService(dir));
  }
  image(id: string): Buffer {
    return this.repository.image(id);
  }
  get entries(): IconEntry[] {
    return this.repository.list();
  }
  find(id: string): IconEntry | undefined {
    return this.repository.find(id);
  }
  save(entry: IconEntry, image?: Buffer): void {
    this.repository.save(entry, image);
  }
  remove(id: string): void {
    this.repository.remove(id);
  }
}
