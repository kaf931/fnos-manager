/** Bound module evaluation as well as network loading on embedded WebViews. */
export async function loadVncModule<T>(loader: () => Promise<T>, timeoutMs = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(loader)
        .catch(() => {
          throw new Error('远程桌面组件加载失败，请刷新后重试');
        }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('远程桌面组件加载超时，请刷新后重试')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
