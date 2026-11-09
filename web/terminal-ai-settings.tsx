import { PasswordField } from './password-field.js';
import { useRef, useReducer, useEffect, useId } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import type { optionRenderProps } from '@douyinfe/semi-ui/lib/es/select';
import { NativeSelect } from './native-select.js';
import { aiProtocols } from './ai-protocols.js';
import { confirmAction } from './confirmation.js';
import { renderSelectActionOption } from './select-action-option.js';
import { Loading } from './ai-command-ui.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type { AiProtocol, AiPublicProvider } from './contracts/ai.js';
export function AiSettings({
  onClose,
  api,
  toast,
  onSave,
}: {
  onClose: () => void;
  api: ApiClient;
  toast: Toast;
  onSave?: () => void;
}) {
  const scope = useId(),
    [, invalidate] = useReducer((n) => n + 1, 0);
  const render = () => invalidate();
  const disposed = useRef(false),
    serial = useRef(0),
    providers = useRef<AiPublicProvider[]>([]),
    id = useRef(''),
    protocol = useRef<AiProtocol>('openai'),
    saving = useRef(false),
    loadingProvider = useRef(false),
    providerFailed = useRef(false),
    providerSerial = useRef(0),
    loadingModels = useRef(false),
    modelSerial = useRef(0),
    models = useRef<string[]>([]),
    name = useRef(''),
    url = useRef(''),
    model = useRef(''),
    key = useRef(''),
    error = useRef(''),
    modelStatus = useRef('');
  const defaults = (value: AiProtocol) => aiProtocols.find((p) => p.value === value)?.baseUrl || '';
  function invalidateModels() {
    modelSerial.current++;
    loadingModels.current = false;
    models.current = [];
    modelStatus.current = '';
  }
  async function choose(provider?: AiPublicProvider) {
    const request = ++providerSerial.current,
      session = serial.current;
    loadingProvider.current = !!provider;
    providerFailed.current = false;
    invalidateModels();
    id.current = provider?.id || '';
    protocol.current = provider?.protocol || 'openai';
    name.current = provider?.name || '';
    url.current = provider?.baseUrl || defaults(protocol.current);
    model.current = provider?.model || '';
    key.current = provider?.apiKey || '';
    error.current = '';
    render();
    if (provider) {
      try {
        const detail = await api<AiPublicProvider>(
          '/terminal/ai/providers/' + encodeURIComponent(provider.id),
        );
        if (disposed.current || request !== providerSerial.current || session !== serial.current)
          return;
        key.current = detail.apiKey || '';
      } catch (e) {
        if (disposed.current || request !== providerSerial.current || session !== serial.current)
          return;
        error.current = errorMessage(e);
        providerFailed.current = true;
        return;
      } finally {
        if (!disposed.current && request === providerSerial.current && session === serial.current) {
          loadingProvider.current = false;
          render();
        }
      }
      void readModels();
    }
  }
  async function readModels() {
    if (
      loadingModels.current ||
      loadingProvider.current ||
      providerFailed.current ||
      saving.current ||
      !url.current
    )
      return;
    try {
      new URL(url.current);
    } catch {
      return;
    }
    const ticket = ++modelSerial.current;
    loadingModels.current = true;
    modelStatus.current = '';
    render();
    try {
      const result = await api<{
        models: string[];
      }>('/terminal/ai/test', 'POST', {
        protocol: protocol.current,
        baseUrl: url.current,
        apiKey: key.current,
      });
      if (disposed.current || ticket !== modelSerial.current) return;
      models.current = result.models;
      if (!model.current && models.current.length) model.current = models.current[0];
      modelStatus.current = models.current.length
        ? `连接成功，读取到 ${models.current.length} 个模型`
        : '接口可访问，未返回模型，可手动输入模型名称';
    } catch (e) {
      if (!disposed.current && ticket === modelSerial.current)
        modelStatus.current = errorMessage(e) + '。可手动输入模型名称。';
    } finally {
      if (!disposed.current && ticket === modelSerial.current) {
        loadingModels.current = false;
        render();
      }
    }
  }
  async function deleteProvider(current: string) {
    const ticket = serial.current;
    if (!current || saving.current) return;
    const ok = await confirmAction({
      title: '删除供应商',
      text: `删除供应商“${providers.current.find((p) => p.id === current)?.name || ''}”？已有对话历史会保留。`,
      danger: true,
      accept: '删除',
    });
    if (
      !ok ||
      disposed.current ||
      serial.current !== ticket ||
      saving.current ||
      !providers.current.some((p) => p.id === current)
    )
      return;
    saving.current = true;
    render();
    try {
      await api('/terminal/ai/providers/' + encodeURIComponent(current), 'DELETE');
      onSave?.();
      if (disposed.current) return;
      if (ticket !== serial.current) return;
      providers.current = providers.current.filter((p) => p.id !== current);
      if (id.current === current) choose(providers.current[0]);
      toast('供应商已删除');
    } catch (e) {
      if (ticket === serial.current) toast(errorMessage(e));
    } finally {
      saving.current = false;
      if (!disposed.current) render();
    }
  }
  async function save() {
    if (saving.current || loadingProvider.current || providerFailed.current) return;
    if (!model.current.trim() || model.current.length > 200) {
      error.current = '请选择或输入有效模型名称';
      render();
      return;
    }
    saving.current = true;
    error.current = '';
    const ticket = serial.current;
    render();
    try {
      await api(
        '/terminal/ai/providers' + (id.current ? '/' + encodeURIComponent(id.current) : ''),
        id.current ? 'PUT' : 'POST',
        {
          name: name.current,
          protocol: protocol.current,
          baseUrl: url.current,
          model: model.current,
          apiKey: key.current,
        },
      );
      onSave?.();
      if (disposed.current) return;
      if (ticket !== serial.current) return;
      onClose();
      toast('供应商已保存');
    } catch (e) {
      if (ticket === serial.current) error.current = errorMessage(e);
    } finally {
      saving.current = false;
      if (!disposed.current) render();
    }
  }
  const close = () => onClose();
  useEffect(() => {
    disposed.current = false;
    void (async () => {
      const ticket = ++serial.current;
      try {
        const list = await api<AiPublicProvider[]>('/terminal/ai/providers');
        if (disposed.current || ticket !== serial.current) return;
        providers.current = list;
        await choose(providers.current[0]);
      } catch (e) {
        if (!disposed.current && ticket === serial.current) toast(errorMessage(e));
      }
    })();
    return () => {
      disposed.current = true;
      serial.current++;
      modelSerial.current++;
      providerSerial.current++;
      key.current = '';
    };
  }, []);
  return (
    <ReactDialog
      size="large"
      open
      title="AI 设置"
      onClose={onClose}
      busy={saving.current}
      className="terminal-dialog"
      footer={null}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="task-form-body">
          <label id={scope + 'ai-provider-label'}>供应商</label>
          <div className="terminal-ai-provider-row">
            <div className="task-form-control">
              <NativeSelect
                zIndex={1100}
                aria-labelledby={scope + 'ai-provider-label'}
                value={id.current || 'new'}
                disabled={saving.current || loadingProvider.current}
                optionList={[
                  ...providers.current.map((p) => ({ value: p.id, label: p.name })),
                  { value: 'new', label: '新供应商' },
                ]}
                renderOptionItem={(option: optionRenderProps) =>
                  renderSelectActionOption({
                    option,
                    actionLabel: `删除供应商 ${option.label}`,
                    disabled: saving.current,
                    onAction:
                      option.value === 'new'
                        ? null
                        : () => void deleteProvider(String(option.value)),
                  })
                }
                onChange={(value: unknown) => choose(providers.current.find((p) => p.id === value))}
              />
            </div>
            <button
              type="button"
              data-new
              title="新增供应商"
              aria-label="新增供应商"
              disabled={saving.current || loadingProvider.current}
              onClick={() => choose()}
            >
              新增
            </button>
          </div>
          <label htmlFor={scope + 'ai-provider-name'}>名称</label>
          <input
            id={scope + 'ai-provider-name'}
            maxLength={80}
            required
            placeholder="供应商名称"
            value={name.current}
            disabled={saving.current || loadingProvider.current || providerFailed.current}
            onChange={(e) => {
              name.current = e.target.value;
              render();
            }}
          />
          <label id={scope + 'ai-protocol-label'}>协议</label>
          <div className="task-form-control">
            <NativeSelect
              zIndex={1100}
              aria-labelledby={scope + 'ai-protocol-label'}
              value={protocol.current}
              disabled={saving.current || loadingProvider.current}
              optionList={aiProtocols.map(({ value, label }) => ({ value, label }))}
              onChange={(value: unknown) => {
                const next = aiProtocols.find((p) => p.value === value);
                if (!next) return;
                const old = protocol.current;
                protocol.current = next.value;
                key.current = '';
                if (!url.current || url.current === defaults(old)) url.current = next.baseUrl;
                invalidateModels();
                render();
                if (id.current) void readModels();
              }}
            />
          </div>
          <label htmlFor={scope + 'ai-api-url'}>API 根地址</label>
          <input
            id={scope + 'ai-api-url'}
            type="url"
            maxLength={2048}
            required
            autoComplete="off"
            value={url.current}
            disabled={saving.current || loadingProvider.current || providerFailed.current}
            placeholder={defaults(protocol.current)}
            onChange={(e) => {
              if (url.current !== e.target.value) {
                key.current = '';
              }
              url.current = e.target.value;
              invalidateModels();
              render();
            }}
            onBlur={() => void readModels()}
          />
          <label htmlFor={scope + 'ai-api-key'}>API Key</label>
          <PasswordField
            key={id.current + ':' + protocol.current + ':' + url.current}
            id={scope + 'ai-api-key'}
            label="API Key"
            maxLength={8192}
            autoComplete="off"
            value={key.current}
            disabled={saving.current || loadingProvider.current || providerFailed.current}
            placeholder="本地无认证服务可留空"
            onChange={(e) => {
              key.current = e.target.value;
              invalidateModels();
              render();
            }}
            onBlur={() => void readModels()}
          />
          <label id={scope + 'ai-model-label'}>默认模型</label>
          <input id={scope + 'ai-model'} type="hidden" value={model.current} />
          <div className="terminal-ai-provider-row">
            <div className="task-form-control">
              <NativeSelect
                key={modelSerial.current + ':' + JSON.stringify(models.current)}

                zIndex={1100}
                aria-labelledby={scope + 'ai-model-label'}
                value={model.current || undefined}
                placeholder="选择或输入模型名称"
                filter
                allowCreate
                disabled={saving.current || loadingProvider.current}
                loading={loadingModels.current}
                optionList={[...new Set([model.current, ...models.current].filter(Boolean))].map(
                  (value) => ({
                    value,
                    label: value,
                  }),
                )}
                onChange={(value: unknown) => {
                  model.current = String(value || '');
                  render();
                }}
              />
            </div>
            <button
              type="button"
              data-test
              title="测试连接"
              aria-label="测试连接"
              disabled={
                saving.current ||
                loadingModels.current ||
                loadingProvider.current ||
                providerFailed.current
              }
              onClick={() => void readModels()}
            >
              测试
            </button>
          </div>
          <div
            className="help"
            data-model-status
            aria-live="polite"
            hidden={!loadingModels.current && !modelStatus.current}
          >
            {loadingModels.current ? (
              <Loading label="正在测试连接并读取模型…" />
            ) : (
              modelStatus.current
            )}
          </div>
          {providerFailed.current && (
            <button
              type="button"
              onClick={() => void choose(providers.current.find((p) => p.id === id.current))}
            >
              重试
            </button>
          )}
          <p className="form-error" role="alert" hidden={!error.current}>
            {error.current}
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" data-cancel onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={saving.current || loadingProvider.current || providerFailed.current}
          >
            保存供应商
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
