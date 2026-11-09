// The fnOS gateway may use HTTP, where the Clipboard API is unavailable.
export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const focused = document.activeElement,
    field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw Error('复制失败');
  } finally {
    field.remove();
    if (focused instanceof document.defaultView!.HTMLElement && focused.isConnected)
      focused.focus({ preventScroll: true });
  }
}
