export const menuTitles = {
  icons: '桌面图标',
  tasks: '计划任务',
  terminal: '远程连接',
  storage: '存储管理',
  wake: '网络唤醒',
  notifications: '通知中心',
  settings: '系统设置',
};
export type PageId = keyof typeof menuTitles;
export const isPageId = (value: unknown): value is PageId =>
  typeof value === 'string' && Object.hasOwn(menuTitles, value);
