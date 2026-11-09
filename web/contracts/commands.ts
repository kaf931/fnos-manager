export interface CommandEntry {
  id: string;
  command: string;
  description: string;
  category: string;
}
export interface ShellContext {
  prompt: string;
  input: string;
  row: number;
}
