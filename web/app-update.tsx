import { LoadingIndicator } from './loading-indicator.js';
import { Markdown } from './ui/markdown.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressControl } from './ui/progress-control.js';
import type { ReleaseInfo } from '../backend/updates/releases.js';
import type { UpdateJob } from '../backend/updates/job.js';
import { RELEASES_URL } from '../backend/updates/releases.js';
import { errorMessage, type ApiClient } from './contracts/shared.js';
import { ReactDialog } from './ui/react-dialog.js';
import { formatSize } from './terminal-file-model.js';
interface Status {
  supported: boolean;
  job: UpdateJob | null;
}
const activeJob = (job: UpdateJob | null) =>
  !!job && !['completed', 'failed', 'rolled-back', 'cancelled'].includes(job.phase);
export function AppUpdate({ api, request = 0 }: { api: ApiClient; request?: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReleaseInfo | null>(null);
  const [status, setStatus] = useState<Status>({ supported: false, job: null });
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const pending = useRef(false),
    alive = useRef(true),
    revision = useRef(0),
    statusRead = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const updating = activeJob(status.job);
  const observedUpdate = useRef(false);
  useEffect(() => {
    if (updating) observedUpdate.current = true;
    if (status.job?.phase === 'completed' && observedUpdate.current) {
      observedUpdate.current = false;
      const timer = window.setTimeout(() => window.location.reload(), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [updating, status.job?.phase]);
  useEffect(() => {
    if (!updating) return;
    let disposed = false,
      reading = false;
    const interval = window.setInterval(async () => {
      if (reading || pending.current) return;
      reading = true;
      const ticket = revision.current,
        read = ++statusRead.current;
      try {
        const value = await api<Status>('/updates/status');
        if (!disposed && revision.current === ticket && statusRead.current === read)
          setStatus(value);
      } catch {
        /* During restart the gateway is temporarily unavailable. Keep the last real phase. */
      } finally {
        reading = false;
      }
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [api, updating]);
  useEffect(() => {
    if (!open) return;
    let disposed = false,
      reading = false;
    const refresh = async () => {
      if (reading || pending.current) return;
      reading = true;
      const ticket = revision.current,
        read = ++statusRead.current;
      try {
        const [release, current] = await Promise.all([
          api<ReleaseInfo>('/updates'),
          api<Status>('/updates/status'),
        ]);
        if (!disposed && revision.current === ticket) {
          setResult(release);
          if (statusRead.current === read) setStatus(current);
        }
      } catch {
        /* Keep the current release and task when the network is unavailable. */
      } finally {
        reading = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [api, open]);
  const check = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    setOpen(true);
    try {
      const [release, current] = await Promise.allSettled([
        api<ReleaseInfo>('/updates'),
        api<Status>('/updates/status'),
      ]);
      if (alive.current) {
        if (release.status === 'fulfilled') setResult(release.value);
        else setError(errorMessage(release.reason));
        if (current.status === 'fulfilled') setStatus(current.value);
        else setError(errorMessage(current.reason));
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }, [api]);
  useEffect(() => {
    if (request > 0) void check();
  }, [request, check]);
  async function install() {
    if (pending.current || !result?.latest) return;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    try {
      const job = await api<UpdateJob>('/updates/install', 'POST', { version: result.latest });
      if (alive.current) setStatus({ supported: true, job });
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function stop() {
    if (pending.current || !status.job) return;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    try {
      const job = await api<UpdateJob>('/updates/cancel', 'POST', { id: status.job.id });
      if (alive.current) setStatus((previous) => ({ ...previous, job }));
    } catch (error) {
      if (alive.current) setError(errorMessage(error));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const job = status.job;
  // Completed jobs are persistent history. Only an unreloaded completion of
  // this release may take priority over the current release action.
  const refreshRequired = !!(
    job?.phase === 'completed' &&
    result?.latest &&
    job.version.replace(/^v/, '') === result.latest.replace(/^v/, '') &&
    job.version.replace(/^v/, '') !== result.current.replace(/^v/, '')
  );
  const unrelatedRelease = !!(
    updating &&
    result?.latest &&
    job?.version.replace(/^v/, '') !== result.latest.replace(/^v/, '')
  );
  const canInstall = !!(result?.hasUpdate && result.asset?.sha256 && status.supported);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void check()}>
        {busy ? '检查中…' : '检查更新'}
      </button>
      <ReactDialog
        open={open}
        title="检查更新"
        layout="fixed"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() =>
                window.open(result?.url || RELEASES_URL, '_blank', 'noopener,noreferrer')
              }
            >
              发布页
            </button>
            <button type="button" disabled={busy} onClick={() => void check()}>
              重新检查
            </button>
            {updating && job && ['downloading', 'verifying', 'waiting'].includes(job.phase) && (
              <button type="button" disabled={busy} onClick={() => void stop()}>
                停止更新
              </button>
            )}
            {refreshRequired ? (
              <button className="primary" type="button" onClick={() => window.location.reload()}>
                刷新应用
              </button>
            ) : updating ? (
              <button className="primary" type="button" disabled>
                <LoadingIndicator
                  compact
                  text={
                    job?.phase === 'downloading'
                      ? '更新中…'
                      : job?.phase === 'verifying'
                        ? '校验中…'
                        : job?.phase === 'installing'
                          ? '安装中…'
                          : job?.phase === 'waiting'
                            ? '等待空闲…'
                            : '重启验证中…'
                  }
                />
              </button>
            ) : canInstall ? (
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => void install()}
              >
                {job &&
                job.version === result?.latest?.replace(/^v/, '') &&
                ['failed', 'rolled-back'].includes(job.phase)
                  ? '重试更新'
                  : '立即更新'}
              </button>
            ) : result?.latest && !result.hasUpdate ? (
              <button className="primary" type="button" disabled>
                已是最新版本
              </button>
            ) : (
              result?.asset && (
                <button
                  type="button"
                  onClick={() => window.open(result.asset!.url, '_blank', 'noopener,noreferrer')}
                >
                  下载安装包
                </button>
              )
            )}
          </>
        }
      >
        <div className="task-form-body">
          {busy && !updating && <p role="status">正在处理…</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {job && (job.phase !== 'completed' || refreshRequired) && (
            <div
              role="status"
              className={['failed', 'rolled-back'].includes(job.phase) ? 'notice error' : 'notice'}
            >
              <p>
                任务版本 {job.version}：{job.message}
              </p>
              {job.phase === 'downloading' && (
                <>
                  <ProgressControl
                    percent={
                      job.total ? Math.min(100, Math.floor((job.received / job.total) * 100)) : 0
                    }
                    label="安装包下载进度"
                  />
                  <p>
                    {formatSize(job.received)} / {formatSize(job.total)}
                  </p>
                </>
              )}
            </div>
          )}
          {result && (
            <>
              {result.warning && (
                <p className="notice" role="status">
                  {result.warning}
                </p>
              )}
              <p>
                {unrelatedRelease
                  ? `正在更新 ${job?.version}`
                  : !result.latest
                    ? '暂无正式发布版本'
                    : result.hasUpdate
                      ? `发现新版本 ${result.latest}`
                      : `当前版本 v${result.current}，最新发布 ${result.latest}`}
              </p>
              {canInstall && !updating && !refreshRequired && (
                <p className="help">
                  更新将保留数据并重启应用，当前远程连接会断开；应用中心登记版本不变。
                </p>
              )}
              {result.hasUpdate && result.asset && !canInstall && (
                <p className="help">当前环境或此安装包暂不支持自动更新，可下载后手动安装。</p>
              )}
              {!updating && result.latest && !result.asset && (
                <p className="help">未找到适用于当前架构的安装包，请查看发布页。</p>
              )}
              {result.latest && !unrelatedRelease && (
                <>
                  <h3>更新说明</h3>
                  <Markdown text={result.notes || '此版本未提供更新说明。'} />
                </>
              )}
            </>
          )}
        </div>
      </ReactDialog>
    </>
  );
}
