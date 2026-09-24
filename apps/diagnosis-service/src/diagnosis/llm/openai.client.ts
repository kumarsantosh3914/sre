import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM } from '@sreai/shared';
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Thin wrapper so the model, temperature and JSON mode are fixed in one
// place (CLAUDE.md: GPT-4o, temperature 0.1) and tests can swap it out.
// OPENAI_BASE_URL is only for pointing at a proxy or local mock.
@Injectable()
export class OpenAiClient {
  private readonly logger = new Logger(OpenAiClient.name);
  private readonly client: OpenAI;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: config.get<string>('OPENAI_BASE_URL') || undefined,
      timeout: 60_000,
      maxRetries: 2,
    });
  }

  async chatJson(messages: ChatMessage[]): Promise<ChatResult> {
    const started = Date.now();
    const res = await this.client.chat.completions.create({
      model: LLM.DIAGNOSIS_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: LLM.TEMPERATURE,
      max_tokens: LLM.MAX_OUTPUT_TOKENS,
    });
    const content = res.choices[0]?.message?.content ?? '';
    const usage = {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
      totalTokens: res.usage?.total_tokens ?? 0,
    };
    this.logger.log('LLM chat completion', {
      model: res.model,
      latencyMs: Date.now() - started,
      ...usage,
      finishReason: res.choices[0]?.finish_reason,
    });
    return { content, model: res.model, usage };
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: LLM.EMBEDDING_MODEL,
      input: text,
      dimensions: LLM.EMBEDDING_DIMENSIONS,
      // Explicit: the SDK otherwise requests base64 and decodes client-side.
      encoding_format: 'float',
    });
    const embedding = res.data[0]?.embedding;
    if (!embedding || embedding.length !== LLM.EMBEDDING_DIMENSIONS) {
      throw new Error('Embedding response had unexpected shape');
    }
    return embedding;
  }
}
