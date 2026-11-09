import { useEffect, useState } from 'react';
import { ReactDialog } from './ui/react-dialog.js';
import { errorMessage, type ApiClient } from './contracts/shared.js';
import type { AiAttachmentSummary } from '../backend/domain/ai-attachments.js';
import { AI_IMAGE_TYPES } from '../backend/domain/ai-attachments.js';

interface ImageContent {
  mimeType: string;
  data: string;
}
function imageSource(content: ImageContent): string {
  return (AI_IMAGE_TYPES as readonly string[]).includes(content.mimeType) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(content.data)
    ? `data:${content.mimeType};base64,${content.data}`
    : '';
}
function ImagePreview({ src, name, close }: { src: string; name: string; close: () => void }) {
  return (
    <ReactDialog
      size="large"
      open
      title={'图片预览 · ' + name}
      onClose={close}
      className="terminal-ai-image-preview"
    >
      <img src={src} alt={name} />
    </ReactDialog>
  );
}

export function AiAttachmentImage({
  attachment,
  api,
  draft,
}: {
  attachment: AiAttachmentSummary;
  api: ApiClient;
  draft?: string;
}) {
  const { id, name, removed, mimeType } = attachment;
  const [loaded, setLoaded] = useState<{ id: string; src: string; error: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    if (!draft && !removed) {
      void api<ImageContent>('/terminal/ai/attachments/' + encodeURIComponent(id) + '/preview')
        .then((content) => {
          const src = imageSource(content);
          if (!src) throw Error('图片格式不可用');
          if (active) setLoaded({ id, src, error: '' });
        })
        .catch((error) => {
          if (active) setLoaded({ id, src: '', error: errorMessage(error, '图片加载失败') });
        });
    }
    return () => {
      active = false;
    };
  }, [id, draft, removed, api]);
  const src = removed
    ? ''
    : draft
      ? imageSource({ mimeType, data: draft })
      : loaded?.id === id
        ? loaded.src
        : '';
  const error = loaded?.id === id ? loaded.error : '';
  return (
    <>
      {src ? (
        <button
          type="button"
          className="terminal-ai-image-thumb"
          aria-label={'预览图片 ' + name}
          onClick={() => setExpanded(true)}
        >
          <img src={src} alt={name} loading="lazy" />
        </button>
      ) : (
        !removed && <small role="status">{error || '正在加载图片…'}</small>
      )}
      {expanded && src && (
        <ImagePreview key={id} src={src} name={name} close={() => setExpanded(false)} />
      )}
    </>
  );
}
