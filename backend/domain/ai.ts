import type { SkillPackageRef } from './ai-skill-packages.js';
import type { AiSkillCall } from './ai-skills.js';
import type { AiAttachment, AiAttachmentSummary } from './ai-attachments.js';
export const AI_PROTOCOLS = [
  'openai',
  'claude',
  'ollama',
  'gemini',
  'glm',
  'minimax',
  'deepseek',
  'mimo',
] as const;
export type AiProtocol = (typeof AI_PROTOCOLS)[number];
export interface AiSettings {
  id?: string;
  name?: string;
  protocol?: AiProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  updatedAt: number;
}
export interface AiPublicSettings {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  apiKey: string;
}
export interface AiSettingsInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}
export interface AiProviderInput extends AiSettingsInput {
  name: string;
  protocol: AiProtocol;
}
export interface AiPublicProvider extends Omit<AiPublicSettings, 'apiKey'> {
  apiKey?: string;
  id: string;
  name: string;
  protocol: AiProtocol;
}
export interface AiCommandCall {
  id: string;
  command: string;
  explanation: string;
  kind?: 'ssh_command';
  skillRefs?: SkillPackageRef[];
}
export interface AiRuntimeCall {
  id: string;
  command: string;
  explanation: string;
  kind: 'prepare_skill_runtime';
  skill: { name: string; revision: number };
  packageRef?: SkillPackageRef;
}
export interface AiInstallSkillCall {
  id: string;
  kind: 'install_skill_package';
  previewId: string;
  command: string;
  explanation: string;
}
export type AiToolCall = AiCommandCall | AiRuntimeCall | AiInstallSkillCall;
export type AiProtocolMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: AiAttachment[] }
  | {
      role: 'assistant';
      content: string | null;
      provider_content?: { protocol: 'gemini' | 'claude'; content: unknown };
      reasoning_content?: string;
      reasoning_details?: unknown[];
      tool_calls?: {
        id: string;
        type: 'function';
        function: {
          name:
            | 'run_ssh_command'
            | 'read_skill'
            | 'list_skill_resources'
            | 'read_skill_resource'
            | 'prepare_skill_runtime'
            | 'inspect_skill_package'
            | 'install_skill_package';
          arguments: string;
        };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface AiTurn {
  skillCalls?: AiSkillCall[];
  content: string;
  toolCalls: AiToolCall[];
  protocolMessage?: Extract<AiProtocolMessage, { role: 'assistant' }>;
}
export interface AiExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status: 'success' | 'failed' | 'timeout' | 'cancelled';
  truncated: boolean;
}
export type AiProposal = AiToolCall & {
  messageId: string;
  proposalId: string;
  status: 'pending' | 'running' | 'completed' | 'rejected' | 'expired';
  result?: AiExecutionResult;
};
export interface AiChatMessage {
  attachments?: AiAttachmentSummary[];
  id: string;
  role: 'user' | 'assistant' | 'notice';
  content: string;
}
export type AiProgressPhase =
  | 'thinking'
  | 'responding'
  | 'skill'
  | 'executing'
  | 'review'
  | 'completed'
  | 'cancelled'
  | 'failed';
export interface AiProgressStep {
  phase: AiProgressPhase;
  label: string;
  startedAt: number;
  finishedAt?: number;
}
export interface AiProgress {
  startedAt: number;
  finishedAt?: number;
  steps: AiProgressStep[];
}
export interface AiSnapshot {
  progress?: AiProgress;
  chatId: string;
  providerId?: string;
  model?: string;
  executionMode: 'review' | 'silent';
  revision: number;
  busy: boolean;
  messages: AiChatMessage[];
  proposals: AiProposal[];
  error: string | null;
}
export interface AiStoredChat {
  id: string;
  owner: string;
  connectionId: string;
  connectionName: string;
  title: string;
  providerId?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messages: AiChatMessage[];
  proposals: AiProposal[];
  history: AiProtocolMessage[];
}
export type AiChatSummary = Omit<AiStoredChat, 'messages' | 'proposals' | 'history' | 'owner'>;
export interface AiProviderContract {
  complete(
    settings: AiSettings,
    messages: AiProtocolMessage[],
    options: { signal: AbortSignal; onText: (text: string) => void },
  ): Promise<AiTurn>;
}
