export type UpdateMode = 'manual' | 'auto';

export type UpdateDownloadRoute = 'direct' | 'mirror';
export interface UpdateSettings {
  mode: UpdateMode;
  downloadRoute: UpdateDownloadRoute;
}
