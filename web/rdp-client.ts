import Guacamole from '../third-party/guacamole/index.js';
export function mountRdpClient(
  target: HTMLElement,
  instance: Guacamole.Client,
  active: () => boolean,
  onClipboard: (text: string) => void,
) {
  const display = instance.getDisplay(),
    element = display.getElement();
  target.replaceChildren(element);
  element.tabIndex = 0;
  const scale = () => {
    const w = display.getWidth(),
      h = display.getHeight();
    if (w && h) display.scale(Math.min(target.clientWidth / w, target.clientHeight / h, 1));
  };
  display.onresize = scale;
  const observer = new ResizeObserver(scale);
  observer.observe(target);
  const keyboard = new Guacamole.Keyboard(element),
    pressedKeys = new Set<number>();
  keyboard.onkeydown = (key) => {
    if (active()) {
      pressedKeys.add(key);
      instance.sendKeyEvent(1, key);
      return false;
    }
  };
  keyboard.onkeyup = (key) => {
    // A tab can become inactive before Keyboard.reset() releases its held keys.
    if (pressedKeys.delete(key)) instance.sendKeyEvent(0, key);
  };
  const mouse = new Guacamole.Mouse(element),
    touch = new Guacamole.Mouse.Touchscreen(element);
  for (const input of [mouse, touch])
    input.onEach(['mousedown', 'mouseup', 'mousemove'], (event) => {
      if (active()) {
        element.focus();
        if (event instanceof Guacamole.Mouse.Event) instance.sendMouseState(event.state, true);
      }
    });
  instance.onclipboard = (stream, mimetype) => {
    if (mimetype !== 'text/plain') {
      stream.sendAck('Unsupported type', 256);
      return;
    }
    let value = '',
      overflow = false;
    const reader = new Guacamole.StringReader(stream);
    reader.ontext = (part) => {
      if (overflow) return;
      if (value.length + part.length > 262144) {
        overflow = true;
        value = '';
        stream.sendAck('Too large', 256);
        return;
      }
      value += part;
    };
    reader.onend = () => {
      if (!overflow) onClipboard(value);
    };
  };
  return {
    keyboard,
    scale,
    dispose() {
      observer.disconnect();
      keyboard.reset();
      instance.onerror = null;
      instance.onstatechange = null;
      instance.onclipboard = null;
      instance.disconnect();
      target.replaceChildren();
    },
  };
}
export function bindRdpEvents(
  instance: Guacamole.Client,
  onError: (code: number, message?: string) => void,
  onState: (state: number) => void,
) {
  instance.onerror = (error) => onError(error.code, error.message);
  instance.onstatechange = onState;
}
