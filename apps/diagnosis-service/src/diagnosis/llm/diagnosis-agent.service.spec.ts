import {
  DiagnosisAgent,
  InvalidDiagnosisOutputError,
  parseDiagnosisOutput,
} from './diagnosis-agent.service';
import { OpenAiClient } from './openai.client';

const valid = {
  hypothesis: 'Redis connection pool exhausted after deploy a1b2c3d reduced the pool size.',
  confidence: 0.82,
  evidence: [{ claim: 'Pool exhausted', source: 'logs', reference: 'connection pool exhausted' }],
  recommended_action: 'REDEPLOY: roll back a1b2c3d',
  action_tier: 'draft',
  reasoning: 'Errors began two minutes after the deploy.',
};

function client(...contents: string[]) {
  const chatJson = jest.fn();
  for (const content of contents) {
    chatJson.mockResolvedValueOnce({
      content,
      model: 'gpt-4o',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
  }
  return { chatJson } as unknown as OpenAiClient & { chatJson: jest.Mock };
}

describe('parseDiagnosisOutput', () => {
  it('accepts schema-valid JSON only', () => {
    expect(parseDiagnosisOutput(JSON.stringify(valid))).toEqual(valid);
    expect(parseDiagnosisOutput('not json')).toBeNull();
    expect(parseDiagnosisOutput(JSON.stringify({ ...valid, evidence: [] }))).toBeNull();
    expect(parseDiagnosisOutput(JSON.stringify({ ...valid, confidence: 1.4 }))).toBeNull();
  });
});

describe('DiagnosisAgent', () => {
  it('returns a validated diagnosis with usage and prompt version', async () => {
    const result = await new DiagnosisAgent(client(JSON.stringify(valid))).diagnose('ctx');
    expect(result.output).toEqual(valid);
    expect(result.promptVersion).toBe('diagnosis-v1');
    expect(result.attempts).toBe(1);
  });

  it('asks once for a repair when the output is malformed', async () => {
    const openai = client('{"hypothesis":"x"}', JSON.stringify(valid));
    const result = await new DiagnosisAgent(openai).diagnose('ctx');
    expect(result.attempts).toBe(2);
    expect(result.tokenUsage.totalTokens).toBe(300);
    const secondCall = openai.chatJson.mock.calls[1][0] as { role: string }[];
    expect(secondCall.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('gives up rather than pass an unvalidated diagnosis downstream', async () => {
    await expect(new DiagnosisAgent(client('nope', 'still nope')).diagnose('ctx')).rejects.toThrow(
      InvalidDiagnosisOutputError,
    );
  });
});
