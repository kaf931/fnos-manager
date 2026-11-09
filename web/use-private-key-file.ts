import { useEffect, useRef, useState } from 'react';

export function usePrivateKeyFile(
  onRead: (text: string) => void,
  onError: (message: string) => void,
) {
  const [reading, setReading] = useState(false);
  const serial = useRef(0),
    pending = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++serial.current;
    };
  }, []);
  function cancel() {
    ++serial.current;
    pending.current = false;
    setReading(false);
  }
  async function read(file: File | undefined) {
    if (!file) return;
    const ticket = ++serial.current;
    pending.current = false;
    setReading(false);
    onError('');
    if (file.size > 65536) {
      onError('私钥文件不能超过 64 KB');
      return;
    }
    pending.current = true;
    setReading(true);
    try {
      const text = await file.text();
      if (alive.current && ticket === serial.current) onRead(text);
    } catch {
      if (alive.current && ticket === serial.current)
        onError('私钥文件读取失败，请重新选择或粘贴内容');
    } finally {
      if (alive.current && ticket === serial.current) {
        pending.current = false;
        setReading(false);
      }
    }
  }
  return { read, cancel, reading, isReading: () => pending.current };
}
