import { useRef, useReducer, useEffect } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { Loading } from './ai-command-ui.js';
import { NativeSelect } from './native-select.js';
import { errorMessage, type ApiClient } from './contracts/shared.js';
import type {
  SkillPackageManifest,
  SkillResourcePage,
} from '../backend/domain/ai-skill-packages.js';
export function AiSkillResources({
  api,
  id,
  onClose,
}: {
  api: ApiClient;
  id: string;
  onClose: () => void;
}) {
  const [, invalidate] = useReducer((n) => n + 1, 0),
    render = () => invalidate();
  const disposed = useRef(false);
  const manifest = useRef<SkillPackageManifest | null>(null),
    file = useRef(''),
    text = useRef(''),
    next = useRef<number | null>(null),
    busy = useRef(false),
    error = useRef(''),
    serial = useRef(0);
  async function read(path: string, offset = 0) {
    const t = ++serial.current;
    busy.current = true;
    error.current = '';
    file.current = path;
    if (!offset) {
      text.current = '';
      next.current = null;
    }
    if (manifest.current?.files.find((f) => f.path === path)?.text === false) {
      text.current = '二进制资源，可下载查看。';
      next.current = null;
      busy.current = false;
      render();
      return;
    }
    render();
    try {
      const p = await api<SkillResourcePage>(
        '/terminal/ai/skills/' +
          encodeURIComponent(id) +
          '/resource?' +
          new URLSearchParams({ path, offset: String(offset) }),
      );
      if (t === serial.current && !disposed.current) {
        text.current = offset ? text.current + p.text : p.text;
        next.current = p.nextOffset;
      }
    } catch (e) {
      if (t === serial.current && !disposed.current) error.current = errorMessage(e);
    } finally {
      if (t === serial.current && !disposed.current) {
        busy.current = false;
        render();
      }
    }
  }
  useEffect(() => {
    disposed.current = false;
    void (async () => {
      const t = ++serial.current;
      try {
        const m = await api<SkillPackageManifest>(
          '/terminal/ai/skills/' + encodeURIComponent(id) + '/resources',
        );
        if (t !== serial.current || disposed.current) return;
        manifest.current = m;
        render();
        const first = m.files.find((f) => f.path === 'SKILL.md') || m.files.find((f) => f.text);
        if (first) await read(first.path);
      } catch (e) {
        if (t === serial.current) {
          error.current = errorMessage(e);
          render();
        }
      }
    })();
    return () => {
      disposed.current = true;
      serial.current++;
    };
  }, [id]);
  return (
    <ReactDialog
      size="large"
      open
      title="技能资源"
      onClose={onClose}
      className="terminal-dialog"
      footer={null}
    >
      <form onSubmit={(e) => e.preventDefault()}>
        <div className="task-form-body">
          <div className="task-form-control">
            <NativeSelect
              aria-label="资源文件"
              value={file.current}
              optionList={(manifest.current?.files || []).map((f) => ({
                value: f.path,
                label: f.path,
              }))}
              onChange={(v) => void read(v)}
            />
          </div>
          {busy.current && <Loading label="正在读取资源…" />}
          {error.current && (
            <p className="form-error" role="alert">
              {error.current}
            </p>
          )}
          <textarea
            className="form-textarea code-input"
            rows={16}
            value={text.current}
            readOnly
            aria-label="资源内容"
          />
          {next.current !== null && (
            <button
              type="button"
              disabled={busy.current}
              onClick={() => void read(file.current, next.current!)}
            >
              加载更多
            </button>
          )}
        </div>
        <div className="dialog-footer">
          {file.current && (
            <button
              type="button"
              onClick={() =>
                window.open(
                  '/app/deskicons/api/terminal/ai/skills/' +
                    encodeURIComponent(id) +
                    '/resource/file?' +
                    new URLSearchParams({ path: file.current }),
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              下载资源
            </button>
          )}
          <button type="button" onClick={() => onClose()}>
            关闭
          </button>
        </div>
      </form>
    </ReactDialog>
  );
}
