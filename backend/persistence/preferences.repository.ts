import type { DatabaseService } from './database.service.js';
export interface UserPreferences {
  theme: 'system' | 'light' | 'dark';
  palette: 'classic' | 'mist' | 'teal' | 'default';
  terminalBackground: 'striped' | 'solid';
  commandHints: boolean;
  defaultPage: 'icons' | 'tasks' | 'terminal' | 'storage' | 'wake';
  navigationMotion: boolean;
}
export class PreferencesRepository {
  constructor(private readonly database: DatabaseService) {}
  get(owner: string): UserPreferences {
    const row = this.database.connection
      .prepare(
        'SELECT theme,palette,terminal_background,command_hints,default_page,navigation_motion FROM user_preferences WHERE owner_uid=?',
      )
      .get(owner);
    return row
      ? {
          theme: row.theme as UserPreferences['theme'],
          palette: row.palette as UserPreferences['palette'],
          terminalBackground: row.terminal_background as UserPreferences['terminalBackground'],
          commandHints: row.command_hints === 1,
          defaultPage: row.default_page as UserPreferences['defaultPage'],
          navigationMotion: row.navigation_motion === 1,
        }
      : {
          theme: 'system',
          palette: 'classic',
          terminalBackground: 'striped',
          commandHints: true,
          defaultPage: 'icons',
          navigationMotion: true,
        };
  }
  save(owner: string, patch: Partial<UserPreferences>): UserPreferences {
    return this.database.transaction(() => {
      const value = { ...this.get(owner), ...patch };
      this.database.connection
        .prepare(
          `INSERT INTO user_preferences(owner_uid,theme,palette,terminal_background,command_hints,default_page,navigation_motion,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_uid) DO UPDATE SET theme=excluded.theme,palette=excluded.palette,terminal_background=excluded.terminal_background,command_hints=excluded.command_hints,default_page=excluded.default_page,navigation_motion=excluded.navigation_motion,updated_at=excluded.updated_at`,
        )
        .run(
          owner,
          value.theme,
          value.palette,
          value.terminalBackground,
          Number(value.commandHints),
          value.defaultPage,
          Number(value.navigationMotion),
          Date.now(),
        );
      return value;
    });
  }
}
