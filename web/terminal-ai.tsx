import { AiProgressView } from './terminal-ai-progress.js';
import { AiAttachmentImage } from './ai-attachment-image.js';
import { AiSkills } from './terminal-ai-skills.js';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Markdown } from './ui/markdown.js';
import { createAiViewModel, aiActivity } from './terminal-ai-model.js';
import { AiSettings } from './terminal-ai-settings.js';
import { AiControls } from './terminal-ai-controls.js';
import { createAiModelDiscovery, aiModelChoice } from './terminal-ai-model-discovery.js';
import { AiHistory } from './terminal-ai-history.js';
import { AiTooltipButton as AiIconButton } from './ai-tooltip.js';
import { readAiFiles, attachmentSize, type DraftAiAttachment } from './ai-attachments.js';
import { imageInputError, type AiAttachmentInput } from '../backend/domain/ai-attachments.js';
import { Loading } from './ai-command-ui.js';
import { errorMessage, type ApiClient, type Toast } from './contracts/shared.js';
import type {
  AiSnapshot,
  AiTarget,
  AiCapture,
  AiModelOption,
  ExecutionMode,
  AiProposal,
  AiPublicProvider,
} from './contracts/ai.js';
const proposalLabels = {
  pending: '待确认',
  running: '执行中',
  completed: '已执行',
  rejected: '已拒绝',
  expired: '已失效',
};
export function TerminalAi({
  api,
  toast,
  target: session,
  open,
  onClose,
}: {
  api: ApiClient;
  toast: Toast;
  target: AiTarget | null;
  open: boolean;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AiSnapshot | null>(null),
    [selectedModel, setSelectedModel] = useState(''),
    [selectedProvider, setSelectedProvider] = useState(''),
    [availableModels, setAvailableModels] = useState<AiModelOption[]>([]),
    [mode, setMode] = useState<ExecutionMode>('review'),
    [input, setInput] = useState(''),
    [statusError, setStatusError] = useState(''),
    [stopping, setStopping] = useState(false),
    [attachments, setAttachments] = useState<DraftAiAttachment[]>([]),
    [readingFiles, setReadingFiles] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [skillsOpen, setSkillsOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [, repaint] = useState(0);
  const model = useRef(createAiViewModel()).current,
    requests = useRef(new Map<string, Promise<unknown>>()).current,
    alive = useRef(true),
    polling = useRef(false),
    settingsChecked = useRef(false),
    fileEpoch = useRef(0),
    fileReading = useRef(false),
    fileInput = useRef<HTMLInputElement | null>(null),
    messageHost = useRef<HTMLDivElement | null>(null),
    atBottom = useRef(true),
    latest = useRef({
      input,
      attachments,
      snapshot,
      open,
      selectedModel,
      selectedProvider,
      refresh: async () => {},
    });
  latest.current = { input, attachments, snapshot, open, selectedModel, selectedProvider, refresh };
  const update = () => {
    if (alive.current) repaint((n) => n + 1);
  };
  const blocked = () => requests.has(model.capture().sessionId);
  const base = (id: string) => '/terminal/sessions/' + encodeURIComponent(id) + '/ai';
  function request<T = unknown>(
    sessionId: string,
    path: string,
    data: unknown,
    origin?: AiCapture,
  ): Promise<T | undefined> {
    const previous = requests.get(sessionId) || Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(() => {
        if (origin && (!alive.current || !model.isCurrent(origin))) return;
        return api<T>(base(sessionId) + path, 'POST', data);
      });
    requests.set(sessionId, pending);
    update();
    void pending
      .finally(() => {
        if (requests.get(sessionId) === pending) {
          requests.delete(sessionId);
          update();
        }
      })
      .catch(() => {});
    return pending;
  }
  function cancel(id: string) {
    void request(id, '/cancel', { confirmed: true }).catch(() => {});
  }
  function clearDraft() {
    ++fileEpoch.current;
    fileReading.current = false;
    setAttachments([]);
    setReadingFiles(false);
    setInput('');
  }
  const discovery = useRef<ReturnType<typeof createAiModelDiscovery> | null>(null);
  useEffect(() => {
    alive.current = true;
    const d = createAiModelDiscovery(
      api,
      (value) => {
        if (!alive.current) return;
        setAvailableModels(value.models);
        if (
          !value.providers.some((p) => p.id === latest.current.selectedProvider) ||
          !latest.current.selectedModel
        ) {
          setSelectedProvider(value.models[0]?.providerId || '');
          setSelectedModel(value.models[0]?.model || '');
        }
      },
      (e) => toast(errorMessage(e)),
    );
    discovery.current = d;
    const changed = () => {
      setSelectedProvider('');
      setSelectedModel('');
      void d.refresh();
    };
    window.addEventListener('deskicons:aiproviderschange', changed);
    return () => {
      alive.current = false;
      ++fileEpoch.current;
      const t = model.capture();
      model.invalidate();
      if (t.sessionId) cancel(t.sessionId);
      d.dispose();
      window.removeEventListener('deskicons:aiproviderschange', changed);
    };
  }, [api]);
  useLayoutEffect(() => {
    const { changed, previous } = model.select(session);
    if (!changed) return;
    if (previous?.id && previous.connected) cancel(previous.id);
    clearDraft();
    setSnapshot(null);
    setMode('review');
    setStatusError('');
    setStopping(false);
    setHistoryOpen(false);
    setSkillsOpen(false);
    update();
  }, [session?.id, session?.generation, session?.connected]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void latest.current.refresh();
    const timer = setInterval(() => void latest.current.refresh(), 750);
    if (!settingsChecked.current) {
      settingsChecked.current = true;
      void discovery.current?.refresh();
      void api<AiPublicProvider[]>('/terminal/ai/providers')
        .then((rows) => {
          if (current && alive.current && !rows.length) setSettingsOpen(true);
        })
        .catch((e) => {
          if (current) toast(errorMessage(e));
        });
    }
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [open, session?.id, session?.generation, session?.connected]);
  useLayoutEffect(() => {
    const el = messageHost.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [snapshot]);
  async function refresh() {
    const target = model.capture();
    if (
      !alive.current ||
      polling.current ||
      !latest.current.open ||
      !target.connected ||
      !target.sessionId ||
      document.hidden
    )
      return;
    polling.current = true;
    try {
      const value = await api<AiSnapshot>(base(target.sessionId) + '/conversation');
      if (!alive.current || !model.isCurrent(target)) return;
      setSnapshot((old) =>
        old?.chatId === value.chatId &&
        old?.revision === value.revision &&
        old?.busy === value.busy &&
        old?.error === value.error
          ? old
          : value,
      );
      setStatusError('');
    } catch (e) {
      if (alive.current && model.isCurrent(target)) setStatusError(errorMessage(e));
    } finally {
      polling.current = false;
    }
  }
  async function switchChat(path: string) {
    const origin = model.capture();
    if (blocked() || !model.beginAction(origin)) throw Error('请先连接 SSH 或等待当前请求结束');
    update();
    try {
      const value = await request<AiSnapshot>(origin.sessionId, path, { confirmed: true }, origin);
      if (!value || !alive.current || !model.isCurrent(origin)) return;
      model.invalidate();
      setSnapshot(value);
      setMode('review');
      setStopping(false);
      clearDraft();
      if (value.providerId) {
        setSelectedProvider(value.providerId);
        setSelectedModel(value.model || latest.current.selectedModel);
      }
    } finally {
      model.finishAction(origin);
      update();
    }
  }
  async function action(
    path: string,
    data: {
      confirmed?: boolean;
      text?: string;
      executionMode?: ExecutionMode;
      model?: string;
      providerId?: string;
      attachments?: AiAttachmentInput[];
    } = { confirmed: true },
    origin = model.capture(),
  ) {
    if (!model.isCurrent(origin) || blocked() || !model.beginAction(origin)) return false;
    update();
    try {
      const accepted = await request(origin.sessionId, path, data, origin);
      if (accepted === undefined || !alive.current || !model.isCurrent(origin)) return false;
      await refresh();
      return true;
    } catch (e) {
      if (alive.current && model.isCurrent(origin)) toast(errorMessage(e));
      return false;
    } finally {
      model.finishAction(origin);
      update();
    }
  }
  function canAttach() {
    return (
      model.capture().connected &&
      !model.busy &&
      !blocked() &&
      !latest.current.snapshot?.busy &&
      !latest.current.snapshot?.proposals.some(
        (p) => p.status === 'pending' || p.status === 'running',
      )
    );
  }
  async function addFiles(files: File[]) {
    if (!files.length || fileReading.current || !canAttach()) return;
    fileReading.current = true;
    const origin = model.capture(),
      epoch = ++fileEpoch.current;
    setReadingFiles(true);
    try {
      const added = await readAiFiles(
        files,
        attachments.length,
        attachments.reduce((n, a) => n + a.size, 0),
      );
      if (alive.current && epoch === fileEpoch.current && model.isCurrent(origin))
        setAttachments((rows) => [...rows, ...added]);
    } catch (e) {
      if (alive.current && epoch === fileEpoch.current && model.isCurrent(origin))
        toast(errorMessage(e));
    } finally {
      if (alive.current && epoch === fileEpoch.current && model.isCurrent(origin)) {
        fileReading.current = false;
        setReadingFiles(false);
      }
    }
  }
  function submit() {
    const text = input.trim();
    if ((!text && !attachments.length) || readingFiles || !canAttach()) return;
    const selected = availableModels.find(
        (p) => p.providerId === selectedProvider && p.model === selectedModel,
      ),
      unsupported =
        attachments.some((a) => a.kind === 'image') && selected?.protocol
          ? imageInputError(selected.protocol, selectedModel)
          : '';
    if (unsupported) {
      toast(unsupported);
      return;
    }
    const origin = model.capture(),
      draftText = input,
      ids = new Set(attachments.map((a) => a.id));
    void action(
      '/messages',
      {
        text,
        ...(attachments.length
          ? {
              attachments: attachments.map(({ name, kind, mimeType, data }) => ({
                name,
                kind,
                mimeType,
                data,
              })),
            }
          : {}),
        executionMode: mode,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedProvider ? { providerId: selectedProvider } : {}),
      },
      origin,
    ).then((accepted) => {
      if (!accepted || !alive.current || !model.isCurrent(origin)) return;
      setInput((current) => (current === draftText ? '' : current));
      setAttachments((rows) => rows.filter((a) => !ids.has(a.id)));
    });
  }
  function chooseModel(value: string) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
        setSelectedProvider(parsed[0]);
        setSelectedModel(parsed[1]);
      }
    } catch {}
  }
  function stop() {
    if (stopping) return;
    const origin = model.capture();
    setStopping(true);
    void action('/cancel', { confirmed: true }, origin).finally(() => {
      if (alive.current && model.isCurrent(origin)) setStopping(false);
    });
  }
  function proposalCard(proposal: AiProposal, origin: AiCapture) {
    const r = proposal.result,
      busy = model.busy || blocked() || !!snapshot?.busy || !model.capture().connected;
    return (
      <div className="terminal-ai-proposal" key={proposal.proposalId}>
        <p>{proposal.explanation}</p>
        <pre className="code-input">{proposal.command}</pre>
        <div className="terminal-ai-actions">
          <span className="help">{proposalLabels[proposal.status]}</span>
          {proposal.status === 'pending' && (
            <>
              <button
                type="button"
                data-ai-proposal-action=""
                disabled={busy}
                onClick={() =>
                  void action(
                    '/proposals/' + encodeURIComponent(proposal.proposalId) + '/reject',
                    { confirmed: true },
                    origin,
                  )
                }
              >
                拒绝
              </button>
              <button
                type="button"
                className="primary"
                data-ai-proposal-action=""
                disabled={busy}
                onClick={() =>
                  void action(
                    '/proposals/' + encodeURIComponent(proposal.proposalId) + '/execute',
                    { confirmed: true },
                    origin,
                  )
                }
              >
                执行命令
              </button>
            </>
          )}
        </div>
        {r && (
          <details>
            <summary>{`${r.status === 'success' ? '完成' : r.status === 'timeout' ? '超时' : r.status === 'cancelled' ? '已取消' : '失败'} · 退出码 ${r.exitCode ?? '—'}${r.truncated ? ' · 输出已截断' : ''}`}</summary>
            <pre className="code-input">{`标准输出\n${r.stdout || '无'}\n\n错误输出\n${r.stderr || '无'}`}</pre>
          </details>
        )}
      </div>
    );
  }

  const target = model.capture(),
    busy = model.busy || blocked() || !!snapshot?.busy,
    pending = !!snapshot?.proposals.some((p) => p.status === 'pending' || p.status === 'running'),
    activity = target.connected ? aiActivity(snapshot, model.busy) : '',
    origin = model.capture();
  const messages = (snapshot?.messages || []).filter(
    (item) =>
      item.content.trim() ||
      item.attachments?.length ||
      snapshot?.proposals.some(
        (p) => p.messageId === item.id && p.status !== 'pending' && p.status !== 'running',
      ),
  );
  const controlModels =
    availableModels.some((p) => p.providerId === selectedProvider && p.model === selectedModel) ||
    !selectedProvider
      ? availableModels
      : [
          { value: aiModelChoice(selectedProvider, selectedModel), label: selectedModel },
          ...availableModels,
        ];
  return (
    <aside id="terminal-ai" className="terminal-assets terminal-ai" hidden={!open}>
      <>
        <div className="terminal-assets-header">
          <strong>AI</strong>
          <AiIconButton label="AI 接口设置" icon="settings" onClick={() => setSettingsOpen(true)} />
          <AiIconButton label="技能管理" icon="skills" onClick={() => setSkillsOpen(true)} />
          <AiIconButton label="AI 历史记录" icon="history" onClick={() => setHistoryOpen(true)} />
          <AiIconButton
            label="新建 AI 会话"
            icon="new"
            disabled={!target.connected || model.busy || blocked()}
            onClick={() => void switchChat('/new').catch((e) => toast(errorMessage(e)))}
          />
          <AiIconButton label="收起 AI" icon="close" onClick={onClose} />
        </div>
        <div
          className="terminal-ai-messages"
          aria-label="AI 对话"
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48;
          }}
          ref={(el) => {
            messageHost.current = el;
          }}
        >
          {!messages.length ? (
            activity ? null : (
              <p className="help">
                {target.connected ? '描述你想检查或处理的任务' : '请先连接 SSH 主机'}
              </p>
            )
          ) : (
            messages.map((item) => (
              <section className={'terminal-ai-message ' + item.role} key={item.id}>
                <small>
                  {item.role === 'user' ? '你' : item.role === 'assistant' ? 'AI' : '提示'}
                </small>
                {item.content &&
                  (item.role === 'assistant' ? (
                    <Markdown text={item.content} />
                  ) : (
                    <div className="terminal-ai-text">{item.content}</div>
                  ))}
                {!!item.attachments?.length && (
                  <div className="terminal-ai-attachments" aria-label="消息附件">
                    {item.attachments.map((a) => (
                      <span className="terminal-ai-attachment" key={a.id} title={a.name}>
                        {a.kind === 'image' && <AiAttachmentImage attachment={a} api={api} />}
                        <span>{a.name}</span>
                        <small>{a.removed ? '已清理' : attachmentSize(a.size)}</small>
                      </span>
                    ))}
                  </div>
                )}
                {snapshot?.proposals
                  .filter(
                    (p) =>
                      p.messageId === item.id && p.status !== 'pending' && p.status !== 'running',
                  )
                  .map((p) => proposalCard(p, origin))}
              </section>
            ))
          )}
          {activity && (
            <section className="terminal-ai-message assistant" aria-label="AI 回复状态">
              <small>AI</small>
              <Loading label={activity} />
            </section>
          )}
        </div>
        <AiProgressView progress={snapshot?.progress} stopping={stopping} />
        <p
          className="help terminal-ai-status"
          role="status"
          hidden={!(snapshot?.error || statusError)}
        >
          {snapshot?.error || statusError}
        </p>
        <div className="terminal-ai-review" aria-label="待审核命令" hidden={!pending}>
          {snapshot?.proposals
            .filter((p) => p.status === 'pending' || p.status === 'running')
            .map((p) => proposalCard(p, origin))}
        </div>
        <form
          className="terminal-ai-composer"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            void addFiles(Array.from(e.dataTransfer.files));
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) =>
              f.type.startsWith('image/'),
            );
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            type="file"
            hidden
            multiple
            aria-label="选择 AI 附件"
            accept=".zip,.txt,.md,.markdown,.log,.sh,.bash,.zsh,.ps1,.bat,.cmd,.json,.jsonl,.yaml,.yml,.toml,.ini,.conf,.cfg,.env,.csv,.tsv,.xml,.html,.css,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.go,.rs,.c,.cpp,.h,.java,.sql,image/png,image/jpeg,image/webp"
            ref={(el) => {
              fileInput.current = el;
            }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              void addFiles(files);
            }}
          />
          {!!attachments.length && (
            <div className="terminal-ai-attachments" aria-label="待发送附件">
              {attachments.map((a) => (
                <span className="terminal-ai-attachment" key={a.id} title={a.name}>
                  {a.kind === 'image' && (
                    <AiAttachmentImage attachment={a} api={api} draft={a.data} />
                  )}
                  <span>{a.name}</span>
                  <small>{attachmentSize(a.size)}</small>
                  <AiIconButton
                    label={'移除附件 ' + a.name}
                    icon="close"
                    disabled={busy}
                    onClick={() => {
                      setAttachments((rows) => rows.filter((f) => f.id !== a.id));
                    }}
                  />
                </span>
              ))}
            </div>
          )}
          {readingFiles && <Loading label="正在读取附件…" />}
          <textarea
            className="form-textarea"
            rows={2}
            maxLength={16384}
            placeholder="描述要处理的问题"
            aria-label="发送给 AI 的消息"
            value={input}
            disabled={!target.connected}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="terminal-ai-toolbar">
            <AiControls
              model={
                selectedProvider && selectedModel
                  ? aiModelChoice(selectedProvider, selectedModel)
                  : ''
              }
              models={controlModels}
              mode={mode}
              busy={busy}
              pending={pending}
              stopping={stopping}
              disabled={!target.connected}
              submitting={model.busy || blocked() || readingFiles}
              onModel={chooseModel}
              onMode={setMode}
              onAttach={() => fileInput.current?.click()}
              onSend={submit}
              onStop={stop}
            />
          </div>
        </form>
      </>
      {settingsOpen && (
        <AiSettings
          api={api}
          toast={toast}
          onClose={() => setSettingsOpen(false)}
          onSave={() => {
            setSelectedProvider('');
            setSelectedModel('');
            const s = model.capture();
            if (s.sessionId) cancel(s.sessionId);
            void refresh();
            void discovery.current?.refresh();
          }}
        />
      )}
      {skillsOpen && (
        <AiSkills
          api={api}
          toast={toast}
          sessionId={() => model.capture().sessionId}
          onClose={() => setSkillsOpen(false)}
        />
      )}
      {historyOpen && (
        <AiHistory
          api={api}
          toast={toast}
          canRestore={target.connected && !busy}
          onRestore={(id) => switchChat('/history/' + encodeURIComponent(id) + '/restore')}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}
