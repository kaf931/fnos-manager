export type {
  AiProtocol,
  AiSettingsInput,
  AiProviderInput,
  AiPublicProvider,
  AiSnapshot,
  AiProposal,
  AiChatSummary,
  AiChatMessage,
} from '../../backend/domain/ai.js';
export interface AiTarget {
  id: string;
  generation: number;
  connected: boolean;
}
export interface AiCapture {
  key: string;
  epoch: number;
  sessionId: string;
  connected: boolean;
}
export type ExecutionMode = 'review' | 'silent';
export interface AiModelOption {
  value: string;
  label: string;
  protocol?: import('../../backend/domain/ai.js').AiProtocol;
  providerId?: string;
  model?: string;
}
