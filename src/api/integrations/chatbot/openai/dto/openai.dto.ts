import { BaseChatbotDto, BaseChatbotSettingDto } from '../../base-chatbot.dto';

/**
 * Which token-limit parameter is sent to the Chat Completions API.
 * - auto (default): max_completion_tokens for o-series / gpt-5 / gpt-6 models, max_tokens otherwise
 * - max_tokens: always the legacy parameter
 * - max_completion_tokens: always the new parameter
 */
export type OpenaiTokenParam = 'auto' | 'max_tokens' | 'max_completion_tokens';

export class OpenaiCredsDto {
  name: string;
  apiKey: string;
}

export class OpenaiDto extends BaseChatbotDto {
  openaiCredsId: string;
  botType: string;
  assistantId?: string;
  functionUrl?: string;
  model?: string;
  systemMessages?: string[];
  assistantMessages?: string[];
  userMessages?: string[];
  maxTokens?: number;
  tokenParam?: OpenaiTokenParam;
  humanResumeMinutes?: number;
  // Media and conversation window: absent/null on the bot = inherit from the default settings
  transcribeAudio?: boolean;
  transcriptionModel?: string;
  maxAudioSeconds?: number;
  readImages?: boolean;
  readDocuments?: boolean;
  maxDocumentMB?: number;
  historyMessages?: number;
}

export class OpenaiSettingDto extends BaseChatbotSettingDto {
  openaiCredsId?: string;
  /** Ethics rules added by the server above the prompt: 'none' or 'advocacia' (Código de Ética da OAB) */
  ethicsProfile?: 'none' | 'advocacia';
  openaiIdFallback?: string;
  speechToText?: boolean;
  tokenParam?: OpenaiTokenParam;
  humanResumeMinutes?: number;
  // Media and conversation window (defaults in OPENAI_MEDIA_DEFAULTS)
  transcribeAudio?: boolean;
  transcriptionModel?: string;
  maxAudioSeconds?: number;
  readImages?: boolean;
  readDocuments?: boolean;
  maxDocumentMB?: number;
  historyMessages?: number;
}
