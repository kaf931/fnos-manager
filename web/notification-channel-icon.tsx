import type { NotificationChannel } from '../backend/domain/notifications.js';
import { AppIcon } from './ui/icon-markup.js';
import wecom from './assets/notifications/wecom.png';
import dingtalk from './assets/notifications/dingtalk.png';
import feishu from './assets/notifications/feishu.ico';
import serverchan from './assets/notifications/serverchan.png';
import bark from './assets/notifications/bark.png';
const artwork: Partial<Record<NotificationChannel, string>> = {
  wecom,
  dingtalk,
  feishu,
  serverchan,
  bark,
};

/** Brand assets are bundled locally; generic channels reuse the shared icon catalogue. */
export function NotificationChannelIcon({ channel }: { channel: NotificationChannel }) {
  const source = artwork[channel];
  return source ? (
    <img src={source} alt="" aria-hidden="true" width={24} height={24} />
  ) : (
    <AppIcon name={channel === 'email' ? 'mail' : channel === 'webhook' ? 'link' : 'bell'} />
  );
}
