import appreciationCode from './assets/brand/appreciation-code.jpg';
import { ReactDialog } from './ui/react-dialog.js';
import { UpdateMode } from './update-mode.js';
import { AppUpdate } from './app-update.js';
import type { ApiClient, Toast, AppState } from './contracts/shared.js';
import { errorMessage } from './contracts/shared.js';
import type { UserPreferences } from '../backend/persistence/preferences.repository.js';
import { isPageId } from './menu-definitions.js';
import React from 'react';
import { SwitchControl as Toggle } from './ui/switch-control.js';
import { NativeSelect } from './native-select.js';
import { loadCommandCatalog } from './command-library.js';
import { ConfigBackupDialog } from './config-backup.js';
import {
  loadPreferences,
  getPreferences,
  savePreferences,
  subscribePreferences,
} from './preferences.js';
import { menuTitles } from './navigation.js';
import { AiSkills } from './terminal-ai-skills.js';
import { AiSettings } from './terminal-ai-settings.js';

const h = React.createElement;
export function SettingsPage({
  api,
  toast,
  state,
  active,
  onRestored,
  updateRequest = 0,
}: {
  api: ApiClient;
  toast: Toast;
  state: AppState;
  active: boolean;
  onRestored: () => Promise<void>;
  updateRequest?: number;
}) {
  const [panel, setPanel] = React.useState<
    'skills' | 'ai' | 'export' | 'restore' | 'support' | null
  >(null);
  const restored = async () => {
    await Promise.all([loadPreferences(api), loadCommandCatalog(api, true)]);
    window.dispatchEvent(new Event('deskicons:configrestored'));
    window.dispatchEvent(new Event('deskicons:aiproviderschange'));
    await onRestored();
  };

  const [values, setValues] = React.useState(getPreferences);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => subscribePreferences(setValues), []);
  async function save(patch: Partial<UserPreferences>) {
    if (saving) return;
    setSaving(true);
    try {
      await savePreferences(api, patch);
      toast('设置已保存');
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  const row = (key: string, title: string, control: React.ReactNode) =>
    h(
      'div',
      { className: 'system-settings-row', key },
      h('label', { id: 'setting-' + key }, title),
      control,
    );
  const select = (
    key: 'theme' | 'defaultPage' | 'palette' | 'terminalBackground',
    options: { value: string; label: string }[],
  ) =>
    h(
      'div',
      { className: 'task-form-control system-settings-control' },
      h(NativeSelect, {
        value: values[key],
        optionList: options,
        disabled: saving,
        'aria-labelledby': 'setting-' + key,
        onChange: (value: unknown) => {
          if (key === 'theme' && (value === 'system' || value === 'light' || value === 'dark'))
            void save({ theme: value });
          else if (
            key === 'palette' &&
            (value === 'classic' || value === 'mist' || value === 'teal' || value === 'default')
          )
            void save({ palette: value });
          else if (key === 'terminalBackground' && (value === 'striped' || value === 'solid'))
            void save({ terminalBackground: value });
          else if (
            key === 'defaultPage' &&
            isPageId(value) &&
            value !== 'settings' &&
            value !== 'notifications'
          )
            void save({ defaultPage: value });
        },
      }),
    );
  const toggle = (key: 'navigationMotion' | 'commandHints') =>
    h(Toggle, {
      checked: values[key],
      disabled: saving,
      'aria-labelledby': 'setting-' + key,
      onChange: (value: boolean) => save({ [key]: value }),
    });
  const section = (title: string, rows: React.ReactNode[]) =>
    h(
      'section',
      {
        className: 'system-settings-section',
        key: title,
      },
      h('h2', null, title),
      ...rows,
    );
  const content = h(
    React.Fragment,
    null,
    section('外观', [
      row(
        'theme',
        '显示模式',
        select('theme', [
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ]),
      ),
      row(
        'palette',
        '强调色',
        select('palette', [
          { value: 'default', label: '默认' },
          { value: 'classic', label: '靛蓝' },
          { value: 'mist', label: '鸢尾紫' },
          { value: 'teal', label: '深青' },
        ]),
      ),
      row(
        'terminalBackground',
        '终端背景',
        select('terminalBackground', [
          { value: 'striped', label: '隔行底色' },
          { value: 'solid', label: '纯色背景' },
        ]),
      ),
      row('navigationMotion', '菜单动画', toggle('navigationMotion')),
    ]),
    section('使用偏好', [
      row(
        'defaultPage',
        '默认打开',
        select(
          'defaultPage',
          Object.entries(menuTitles)
            .filter(([key]) => key !== 'settings' && key !== 'notifications')
            .map(([value, label]) => ({ value, label })),
        ),
      ),
      row('commandHints', '终端命令提示', toggle('commandHints')),
    ]),
    section('AI 接入', [
      row(
        'aiSkills',
        'Skills 技能',
        h('button', { type: 'button', onClick: () => setPanel('skills') }, '管理'),
      ),
      row(
        'ai',
        '供应商与模型',
        h('button', { type: 'button', onClick: () => setPanel('ai') }, '配置'),
      ),
    ]),
    section('配置备份', [
      row(
        'backup',
        '备份配置',
        h('button', { type: 'button', onClick: () => setPanel('export') }, '备份'),
      ),
      row(
        'restore',
        '恢复配置',
        h('button', { type: 'button', onClick: () => setPanel('restore') }, '恢复'),
      ),
    ]),
    section('关于应用', [
      row('version', '运行版本', h('span', null, state.version ? 'v' + state.version : '版本未知')),
      row('updateMode', '更新方式', h(UpdateMode, { api, toast, active })),
      row('updateRoute', '下载线路', h(UpdateMode, { api, toast, active, field: 'downloadRoute' })),
      row('updates', '应用更新', h(AppUpdate, { api, request: updateRequest })),
      row(
        'developer',
        '开发者',
        h(
          'a',
          {
            href: 'https://github.com/kaf931/fnos-manager',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'kaf',
        ),
      ),
      row(
        'forum',
        '应用论坛',
        h(
          'a',
          {
            href: 'https://club.fnnas.com/home.php?mod=space&uid=91804',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          '查看',
        ),
      ),
      <div className="system-settings-row media-preview-layout" key="appreciation">
        <button
          type="button"
          className="media-preview-button"
          aria-label="放大查看赞赏码"
          onClick={() => setPanel('support')}
        >
          <img
            className="dialog-media"
            src={appreciationCode}
            alt="微信赞赏码"
            width={1152}
            height={1152}
          />
        </button>
        <div className="media-preview-copy">
          <h3>支持作者</h3>
          <p>如果 NAS 管家对你有帮助，欢迎微信扫码赞赏支持。</p>
          <p>您也可以在赞赏备注中留下新需求，我会优先评估，结合可行性安排开发。</p>
          <button type="button" className="text-button" onClick={() => setPanel('support')}>
            放大查看
          </button>
        </div>
      </div>,
    ]),
  );
  return (
    <section id="settings-page" className="tool-page" hidden={!active} aria-label="系统设置">
      <div id="system-settings-root" data-scroll-inset className="system-settings-content">
        {content}
      </div>
      <ReactDialog
        open={active && panel === 'support'}
        title="赞赏码"
        size="medium"
        onClose={() => setPanel(null)}
      >
        <div className="task-form-body">
          <img
            className="dialog-media"
            src={appreciationCode}
            alt="微信赞赏码"
            width={1152}
            height={1152}
          />
        </div>
      </ReactDialog>
      {panel === 'skills' && <AiSkills api={api} toast={toast} onClose={() => setPanel(null)} />}{' '}
      {panel === 'ai' && (
        <AiSettings
          api={api}
          toast={toast}
          onClose={() => setPanel(null)}
          onSave={() => window.dispatchEvent(new Event('deskicons:aiproviderschange'))}
        />
      )}{' '}
      {(panel === 'export' || panel === 'restore') && (
        <ConfigBackupDialog
          api={api}
          toast={toast}
          mode={panel}
          onClose={() => setPanel(null)}
          onRestored={restored}
        />
      )}
    </section>
  );
}
