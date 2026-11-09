import React, { useEffect, useState } from 'react';
import type { AiProgress } from '../backend/domain/ai.js';

function duration(startedAt: number, finishedAt: number) {
  const seconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function AiProgressView({
  progress,
  stopping,
}: {
  progress?: AiProgress;
  stopping: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const running = !!progress && !progress.finishedAt;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, progress?.startedAt]);
  if (!progress && !stopping) return null;
  const last = progress?.steps.at(-1);
  return (
    <div className="terminal-ai-progress">
      <p className="help" role="status" aria-live="polite">
        {stopping ? '正在发送停止请求…' : last?.label || '正在准备请求'}
        {progress && (
          <span aria-live="off">
            {' '}
            · 已用时{' '}
            {duration(progress.startedAt, progress.finishedAt ?? Math.max(now, progress.startedAt))}
          </span>
        )}
      </p>
      {!!progress?.steps.length && (
        <details>
          <summary className="help">处理步骤（{progress.steps.length}）</summary>
          <ol className="help">
            {progress.steps.map((step, index) => (
              <li key={`${step.startedAt}:${index}`}>
                {step.label} ·{' '}
                {duration(step.startedAt, step.finishedAt ?? Math.max(now, step.startedAt))}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
