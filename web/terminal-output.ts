interface OutputMessage {
  seq?: number;
  data: string;
}
interface OutputSinkOptions {
  write: (data: Uint8Array, done: () => void) => void;
  ack: (sequence: number) => void;
  onOverflow: () => void;
  limit?: number;
}
// Bound terminal parser backlog, not only the browser/network send buffer.
export function createOutputSink({
  write,
  ack,
  onOverflow,
  limit = 1024 * 1024,
}: OutputSinkOptions) {
  let pending = 0,
    closed = false;
  const dispose = () => {
    closed = true;
    pending = 0;
  };
  const overflow = () => {
    if (closed) return;
    dispose();
    onOverflow();
  };
  return {
    dispose,
    accept(message: OutputMessage) {
      if (closed) return;
      try {
        const sequence = message.seq;
        if (
          typeof sequence !== 'number' ||
          !Number.isSafeInteger(sequence) ||
          sequence < 1 ||
          typeof message.data !== 'string'
        )
          throw new Error('invalid output');
        const raw = atob(message.data),
          data = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        if (pending + data.length > limit) {
          overflow();
          return;
        }
        pending += data.length;
        write(data, () => {
          if (closed) return;
          pending -= data.length;
          ack(sequence);
        });
      } catch {
        overflow();
      }
    },
  };
}
