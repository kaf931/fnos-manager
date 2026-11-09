// Local status text must never pass remote control sequences to the terminal parser.
export function createTerminalRetry({
  write,
  retry,
  canRetry,
}: {
  write: (text: string) => void;
  retry: () => void;
  canRetry: () => boolean;
}) {
  let ready = false,
    prompted = false,
    errorLineOpen = false;
  const errors = new Set<string>();
  return {
    error(message: string) {
      const text = message.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
      if (!text || errors.has(text)) return;
      errors.add(text);
      write(`\r\n\x1b[31m${text}\x1b[0m`);
      errorLineOpen = true;
    },
    disconnected() {
      if (prompted) return;
      prompted = ready = true;
      const prompt = errorLineOpen ? ' · 按回车重试' : '\r\n连接已结束，按回车重试';
      write(`\x1b[31m${prompt}\x1b[0m\r\n`);
      errorLineOpen = false;
    },
    finishLine() {
      if (errorLineOpen) write('\r\n');
      errorLineOpen = false;
    },
    input(data: string) {
      if (!ready || !canRetry() || !/^(?:\r\n|\r|\n)$/.test(data)) return false;
      ready = false;
      retry();
      return true;
    },
    reset() {
      ready = prompted = errorLineOpen = false;
      errors.clear();
    },
  };
}
