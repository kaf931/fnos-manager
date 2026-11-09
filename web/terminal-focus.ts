// Terminal presentation follows view visibility, not SSH connection lifetime.
export function setTerminalFocus(visible: boolean, root = document.documentElement) {
  root.classList.toggle('terminal-focused', visible);
}
