import React, { useMemo } from 'react';
import { renderAiMarkdown } from '../ai-markdown.js';
/** Shared sanitized Markdown surface for AI replies and release notes. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderAiMarkdown(text), [text]);
  return <div className="ai-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
