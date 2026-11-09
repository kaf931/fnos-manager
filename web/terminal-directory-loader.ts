export interface DirectoryRequest {
  key: string;
  fresh?: boolean;
}
export type DirectoryJob<I> = I & { pending: boolean; promise?: Promise<void>; sequence?: number };
// Keep directory HTTP requests sequential: cancelling fetch does not cancel SFTP readdir.
// Repeated activation shares one request; only the latest requested location is published.
export function createDirectoryLoader<I extends DirectoryRequest, R>({
  request,
  onStart,
  onSuccess,
  onError,
  onFinish,
}: {
  request: (job: DirectoryJob<I>) => Promise<R>;
  onStart?: (job: DirectoryJob<I>) => void;
  onSuccess?: (result: R, job: DirectoryJob<I>) => void;
  onError?: (error: unknown, job: DirectoryJob<I>) => void;
  onFinish?: (job: DirectoryJob<I>) => void;
}) {
  let tail = Promise.resolve(),
    latest: DirectoryJob<I> | null = null;
  return {
    load(input: I) {
      if (!input.fresh && latest?.pending && latest.key === input.key) return latest.promise!;
      const job: DirectoryJob<I> = { ...input, pending: true };
      latest = job;
      onStart?.(job);
      const work = tail
        .catch(() => {})
        .then(async () => {
          if (job !== latest) return;
          try {
            const result = await request(job);
            if (job === latest) onSuccess?.(result, job);
          } catch (error) {
            if (job === latest) onError?.(error, job);
          }
        })
        .finally(() => {
          job.pending = false;
          if (job === latest) onFinish?.(job);
        });
      job.promise = work;
      tail = work;
      return work;
    },
    invalidate() {
      latest = null;
      tail = Promise.resolve();
    },
  };
}
