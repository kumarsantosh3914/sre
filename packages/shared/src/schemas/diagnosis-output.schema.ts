import { z } from 'zod';

export const DiagnosisOutputSchema = z.object({
  hypothesis: z.string().min(10).max(500),
  confidence: z.number().min(0).max(1),
  evidence: z
    .array(
      z.object({
        claim: z.string(),
        source: z.enum(['logs', 'metrics', 'deploy', 'dependency', 'similar_incident']),
        reference: z.string().min(3),
      }),
    )
    .min(1),
  recommended_action: z.string(),
  action_tier: z.enum(['auto', 'draft', 'escalate']),
  reasoning: z.string(),
});

export type DiagnosisOutput = z.infer<typeof DiagnosisOutputSchema>;
