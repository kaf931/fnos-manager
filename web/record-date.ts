const compactDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function compactRecordDate(value: string | null) {
  return value ? compactDate.format(new Date(value)) : '—';
}
