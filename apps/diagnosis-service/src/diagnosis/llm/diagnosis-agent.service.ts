import { Injectable, Logger } from '@nestjs/common';
import { DiagnosisOutput, DiagnosisOutputSchema } from '@sreai/shared';
import { ChatMessage, OpenAiClient } from './openai.client';
import { DIAGNOSIS_SYSTEM_PROMPT, PROMPT_VERSION, REPAIR_PROMPT, buildUserPrompt } from './prompt';

export class InvalidDiagnosisOutputError extends Error {}

export interface AgentResult {
  output: DiagnosisOutput;
  model: string;
  promptVersion: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  attempts: number;
}

const MAX_ATTEMPTS = 2;

export function parseDiagnosisOutput(content: string): DiagnosisOutput | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = DiagnosisOutputSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// Calls GPT-4o with the versioned system prompt and validates the reply
// against DiagnosisOutputSchema (Zod). One repair round-trip for malformed
// output; after that the job fails and is retried / escalated — an
// unvalidated diagnosis never leaves this class.
@Injectable()
export class DiagnosisAgent {
  private readonly logger = new Logger(DiagnosisAgent.name);

  constructor(private readonly openai: OpenAiClient) {}

  async diagnose(renderedContext: string): Promise<AgentResult> {
    const started = Date.now();
    const messages: ChatMessage[] = [
      { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(renderedContext) },
    ];
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const res = await this.openai.chatJson(messages);
      usage.promptTokens += res.usage.promptTokens;
      usage.completionTokens += res.usage.completionTokens;
      usage.totalTokens += res.usage.totalTokens;

      const output = parseDiagnosisOutput(res.content);
      if (output) {
        return {
          output,
          model: res.model,
          promptVersion: PROMPT_VERSION,
          tokenUsage: usage,
          latencyMs: Date.now() - started,
          attempts: attempt,
        };
      }
      this.logger.warn('LLM returned output that failed schema validation', {
        attempt,
        preview: res.content.slice(0, 300),
      });
      messages.push(
        { role: 'assistant', content: res.content },
        { role: 'user', content: REPAIR_PROMPT },
      );
    }
    throw new InvalidDiagnosisOutputError(
      `LLM output failed DiagnosisOutputSchema validation after ${MAX_ATTEMPTS} attempts`,
    );
  }
}
