import Space from '@douyinfe/semi-ui/lib/es/space';
import Badge from '@douyinfe/semi-ui/lib/es/badge';
import { useState, useEffect } from 'react';
import Dropdown from '@douyinfe/semi-ui/lib/es/dropdown';
import { AppIcon, NavigationArtwork } from './ui/icon-markup.js';
import { menuTitles, type PageId } from './menu-definitions.js';
export function MobileMore({
  page,
  onChange,
  onOpenChange,
  updateAvailable = false,
  unreadMessages = 0,
  onUpdate,
}: {
  page: PageId;
  updateAvailable?: boolean;
  unreadMessages?: number;
  onUpdate?: () => void;
  onChange: (page: PageId) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [page]);
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
  return (
    <Dropdown
      trigger="click"
      position="topRight"
      spacing={12}
      visible={open}
      onVisibleChange={setOpen}
      render={
        <Dropdown.Menu className="mobile-navigation-dropdown">
          {(['wake', 'notifications', 'settings'] as const).map((key) => (
            <Dropdown.Item
              key={key}
              active={page === key}
              onClick={() => {
                setOpen(false);
                onChange(key);
              }}
            >
              <span className="mobile-navigation-menu-icon">
                <AppIcon
                  name={key === 'wake' ? 'power' : key === 'notifications' ? 'bell' : 'settings'}
                />
              </span>
              {key === 'notifications' && unreadMessages > 0 ? (
                <Space spacing="tight" align="center">
                  <span>{menuTitles[key]}</span>
                  <Badge dot type="danger" />
                </Space>
              ) : (
                menuTitles[key]
              )}
            </Dropdown.Item>
          ))}
          {updateAvailable && onUpdate && (
            <Dropdown.Item
              onClick={() => {
                setOpen(false);
                onUpdate();
              }}
            >
              <span className="mobile-navigation-menu-icon">
                <AppIcon name="download" />
              </span>
              <Space spacing="tight" align="center">
                <span>应用更新</span>
                <Badge dot type="danger" />
              </Space>
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      }
    >
      <button
        type="button"
        className={
          'nav-item' +
          (open || page === 'wake' || page === 'notifications' || page === 'settings'
            ? ' active'
            : '')
        }
        aria-label={[
          '更多',
          unreadMessages > 0 ? '有未读消息' : '',
          updateAvailable ? '有可用更新' : '',
        ]
          .filter(Boolean)
          .join('，')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>
          {updateAvailable || unreadMessages > 0 ? (
            <Badge dot type="danger">
              <NavigationArtwork page="more" />
            </Badge>
          ) : (
            <NavigationArtwork page="more" />
          )}
        </span>
        更多
      </button>
    </Dropdown>
  );
}
