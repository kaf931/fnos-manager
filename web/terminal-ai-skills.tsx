import { useState, useRef, useEffect, useId } from 'react';
import { AiSkillResources } from './terminal-ai-skill-resources.js';
import { AiSkillAuth } from './terminal-ai-skill-auth.js';
import { ReactDialog } from './ui/react-dialog.js';
import type { optionRenderProps } from '@douyinfe/semi-ui/lib/es/select';
import { NativeSelect } from './native-select.js';
import { renderSelectActionOption } from './select-action-option.js';
import { Loading } from './ai-command-ui.js';
import { confirmAction } from './confirmation.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type { AiSkill, AiSkillSummary } from '../backend/domain/ai-skills.js';
const template =
  '---\nname: my-skill\ndescription: 说明技能的用途及适用场景\n---\n\n# 操作流程\n\n1. 先检查当前状态。\n2. 按用户要求处理，并验证结果。\n';
export function AiSkills({
  api,
  toast,
  sessionId = () => '',
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  sessionId?: () => string;
  onClose: () => void;
}) {
  const scope = useId(),
    [items, setItems] = useState<AiSkillSummary[]>([]),
    [id, setId] = useState(''),
    [markdown, setMarkdown] = useState(template),
    [enabled, setEnabled] = useState(false),
    [error, setError] = useState(''),
    [packageSkill, setPackageSkill] = useState<AiSkill | null>(null),
    [working, setWorking] = useState(false),
    [loading, setLoading] = useState(true),
    [editable, setEditable] = useState(false),
    [resources, setResources] = useState(''),
    [authorization, setAuthorization] = useState('');
  const alive = useRef(true),
    serial = useRef(0),
    lock = useRef(false);
  const current = (ticket: number) => alive.current && serial.current === ticket;
  async function choose(value: string) {
    if (lock.current) return;
    const ticket = ++serial.current,
      key = value === 'new' ? '' : value;
    setId(key);
    setError('');
    setPackageSkill(null);
    setMarkdown(key ? '' : template);
    setEnabled(false);
    setLoading(!!key);
    setEditable(!key);
    if (!key) return;
    try {
      const skill = await api<AiSkill>('/terminal/ai/skills/' + encodeURIComponent(key));
      if (!current(ticket)) return;
      setPackageSkill(skill.kind === 'package' ? skill : null);
      setMarkdown(skill.document);
      setEnabled(skill.enabled);
      setEditable(true);
    } catch (e) {
      if (current(ticket)) setError(errorMessage(e));
    } finally {
      if (current(ticket)) setLoading(false);
    }
  }
  useEffect(() => {
    const ticket = ++serial.current;
    void api<AiSkillSummary[]>('/terminal/ai/skills')
      .then(async (rows) => {
        if (!current(ticket)) return;
        setItems(rows);
        if (rows.length) await choose(rows[0].id);
        else {
          setLoading(false);
          setEditable(true);
        }
      })
      .catch((e) => {
        if (current(ticket)) {
          setLoading(false);
          setError(errorMessage(e));
        }
      });
    return () => {
      alive.current = false;
      ++serial.current;
    };
  }, [api]);
  async function remove(value: string) {
    if (lock.current || loading) return;
    const selected = items.find((s) => s.id === value);
    if (!selected) return;
    await confirmAction({
      title: '删除技能',
      text: '删除 ' + selected.name + '？',
      danger: true,
      accept: '删除',
      onAccept: async () => {
        if (lock.current || !alive.current) return;
        lock.current = true;
        setWorking(true);
        const ticket = serial.current;
        try {
          await api('/terminal/ai/skills/' + encodeURIComponent(value), 'DELETE');
          if (!current(ticket)) return;
          setItems((rows) => rows.filter((s) => s.id !== value));
          if (id === value) {
            setId('');
            setPackageSkill(null);
            setMarkdown(template);
            setEnabled(false);
            setEditable(true);
          }
          toast('技能已删除');
        } finally {
          lock.current = false;
          if (alive.current) setWorking(false);
        }
      },
    });
  }
  async function save() {
    if (lock.current || loading || !editable || !alive.current) return;
    lock.current = true;
    setWorking(true);
    setError('');
    const ticket = serial.current;
    try {
      const saved = await api<AiSkill>(
        '/terminal/ai/skills' +
          (id ? '/' + encodeURIComponent(id) : '') +
          (packageSkill ? '/enabled' : ''),
        id ? 'PUT' : 'POST',
        packageSkill ? { enabled } : { document: markdown, enabled },
      );
      if (!current(ticket)) return;
      setId(saved.id);
      setMarkdown(saved.document);
      setEnabled(saved.enabled);
      setItems((rows) =>
        [...rows.filter((s) => s.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      toast('技能已保存');
    } catch (e) {
      if (current(ticket)) setError(errorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setWorking(false);
    }
  }
  return (
    <>
      <ReactDialog
        size="large"
        open
        title="技能管理"
        busy={working}
        onClose={onClose}
        className="terminal-dialog"
      >
        {' '}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="task-form-body">
            <label id={scope + 'label'}>技能</label>
            <div className="terminal-ai-provider-row">
              <div className="task-form-control">
                <NativeSelect
                  aria-labelledby={scope + 'label'}

                  zIndex={1100}
                  value={id || 'new'}
                  disabled={working || loading}
                  optionList={[
                    ...items.map((s) => ({
                      value: s.id,
                      label: s.name + (s.enabled ? '' : '（已禁用）'),
                    })),
                    { value: 'new', label: '新技能' },
                  ]}
                  renderOptionItem={(option: optionRenderProps) =>
                    renderSelectActionOption({
                      option,
                      actionLabel: '删除技能 ' + String(option.label),
                      disabled: working || loading,
                      onAction:
                        option.value === 'new' ? null : () => void remove(String(option.value)),
                    })
                  }
                  onChange={(value) => void choose(value)}
                />
              </div>
              <button
                type="button"
                disabled={working || loading}
                onClick={() => void choose('new')}
              >
                新增
              </button>
            </div>
            <div className="terminal-ai-provider-row">
              {packageSkill && (
                <button
                  type="button"
                  disabled={working || loading || !enabled}
                  onClick={() => setResources(packageSkill!.id)}
                >
                  查看资源
                </button>
              )}
              {packageSkill && sessionId() && (
                <button
                  type="button"
                  disabled={working || loading || !enabled}
                  onClick={() => setAuthorization(packageSkill!.id)}
                >
                  飞牛授权
                </button>
              )}
            </div>
            {loading && <Loading label="正在读取技能…" />}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <label htmlFor={scope + 'document'}>SKILL.md</label>
            <textarea
              id={scope + 'document'}
              className="form-textarea code-input"
              rows={12}
              maxLength={65536}
              value={markdown}
              disabled={working || loading || !editable}
              readOnly={!!packageSkill}
              spellCheck={false}
              onChange={(e) => {
                setMarkdown(e.target.value);
              }}
            />
            <div className="form-check-row">
              {' '}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={working || loading || !editable}
                  onChange={(e) => {
                    setEnabled(e.target.checked);
                  }}
                />
                启用技能
              </label>
            </div>
          </div>
          <div className="dialog-footer">
            <span />
            <button type="button" disabled={working} onClick={onClose}>
              关闭
            </button>
            <button type="submit" className="primary" disabled={working || loading || !editable}>
              {working ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </ReactDialog>
      {resources && <AiSkillResources api={api} id={resources} onClose={() => setResources('')} />}{' '}
      {authorization && (
        <AiSkillAuth
          api={api}
          toast={toast}
          sessionId={sessionId}
          skillId={authorization}
          onClose={() => setAuthorization('')}
        />
      )}
    </>
  );
}
