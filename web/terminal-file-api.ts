import { retainUpload } from './terminal-transfer-retry.js';
import type { ApiClient } from './contracts/shared.js';
import type {
  RemoteTextFile,
  TextFileVersion,
  SessionIdentity,
  FileListing,
  PermissionsInfo,
  FileActionBody,
  DirectorySize,
  UploadOptions,
} from './contracts/terminal.js';
export function createFileApi({
  api,
  getCsrfToken,
}: {
  api: ApiClient;
  getSession?: () => SessionIdentity;
  getCsrfToken: () => string | undefined;
}) {
  const base = (s: SessionIdentity) =>
    '/terminal/sessions/' + encodeURIComponent(s.id ?? '') + '/files';
  return {
    readText: (s: SessionIdentity, path: string, encoding = 'auto') =>
      api<RemoteTextFile>(base(s) + '/text?' + new URLSearchParams({ path, encoding })),
    saveText: (s: SessionIdentity, path: string, file: RemoteTextFile, backup = true) =>
      api<RemoteTextFile>(base(s) + '/text', 'POST', {
        path,
        content: file.content,
        encoding: file.encoding,
        bom: file.bom,
        revision: file.revision,
        backup,
      }),
    textVersions: (s: SessionIdentity, path: string) =>
      api<{ items: TextFileVersion[] }>(
        base(s) + '/text/versions?' + new URLSearchParams({ path }),
      ),
    readTextVersion: (s: SessionIdentity, path: string, id: string) =>
      api<RemoteTextFile>(
        base(s) + '/text/versions/' + encodeURIComponent(id) + '?' + new URLSearchParams({ path }),
      ),
    deleteTextVersion: (s: SessionIdentity, path: string, id: string) =>
      api<void>(
        base(s) + '/text/versions/' + encodeURIComponent(id) + '?' + new URLSearchParams({ path }),
        'DELETE',
      ),
    permissions: (s: SessionIdentity, path: string, name: string) =>
      api<PermissionsInfo>(base(s) + '/permissions?' + new URLSearchParams({ path, name })),
    list: (s: SessionIdentity, path?: string) =>
      api<FileListing>(base(s) + (path === undefined ? '' : '?path=' + encodeURIComponent(path))),
    action: <T = DirectorySize>(s: SessionIdentity, action: string, data: FileActionBody) =>
      api<T>(base(s) + '/' + action, 'POST', data),
    upload: (
      s: SessionIdentity,
      path: string,
      name: string,
      file: File,
      { signal, onProgress }: UploadOptions = {},
    ) =>
      retainUpload(
        s,
        path,
        name,
        file,
        { signal, onProgress },
        ({ signal, onProgress }, clientId) =>
          new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest(),
              abort = () => xhr.abort();
            xhr.open(
              'POST',
              '/app/deskicons/api' +
                base(s) +
                '/upload?' +
                new URLSearchParams({ path, name, size: String(file.size), clientId }),
            );
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            const csrf = getCsrfToken();
            if (csrf) xhr.setRequestHeader('x-deskicons-token', csrf);
            xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.total);
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else {
                let message = '上传失败';
                try {
                  const response: unknown = JSON.parse(xhr.responseText);
                  if (
                    response &&
                    typeof response === 'object' &&
                    'error' in response &&
                    typeof response.error === 'string'
                  )
                    message = response.error || message;
                } catch {}
                reject(Error(message));
              }
            };
            xhr.onerror = () => reject(Error('上传网络连接失败'));
            xhr.onabort = () => reject(Error('上传已取消'));
            xhr.onloadend = () => signal?.removeEventListener('abort', abort);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) {
              reject(Error('上传已取消'));
              return;
            }
            xhr.send(file);
          }),
      ),
    download: (s: SessionIdentity, path: string) => {
      const a = document.createElement('a');
      a.href = '/app/deskicons/api' + base(s) + '/download?' + new URLSearchParams({ path });
      a.download = '';
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
    },
  };
}
