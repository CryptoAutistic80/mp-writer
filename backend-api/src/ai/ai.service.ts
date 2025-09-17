import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  async generate(input: { prompt: string; model?: string }) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = input.model || this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    if (!apiKey) {
      // In dev without key, return a stub so flows work
      return { content: `DEV-STUB: ${input.prompt.slice(0, 120)}...` };
    }
    // Lazy import to avoid startup error if pkg missing in some envs
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: input.prompt }],
      temperature: 0.7,
    });
    const content = resp.choices?.[0]?.message?.content ?? '';
    return { content };
  }

  async refineIssue(input: { brief: string }): Promise<IssueRefinement> {
    const brief = (input.brief || '').trim();
    if (!brief) throw new BadRequestException('Issue brief is required');

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('OPENAI_REFINEMENT_MODEL', 'gpt-4o-mini');
    if (!apiKey) {
      const summary = brief.length > 320 ? `${brief.slice(0, 317)}…` : brief;
      return {
        summary,
        keyPoints: brief
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 4),
        toneSuggestions: ['Respectful', 'Evidence-led'],
        followUpQuestions: [],
        rawOutput: summary,
        model: 'dev-mock',
      } satisfies IssueRefinement;
    }

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });

    const requestPayload: any = {
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You are an assistant helping a constituent prepare to write to their MP. You must read the issue description and produce a concise JSON summary with the key information needed to draft a persuasive letter. Always respond in JSON matching the supplied schema.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Constituent issue description:\n${brief}`,
            },
          ],
        },
      ],
      temperature: 0.3,
      max_output_tokens: 600,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'issue_refinement',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              keyPoints: {
                type: 'array',
                items: { type: 'string' },
              },
              toneSuggestions: {
                type: 'array',
                items: { type: 'string' },
              },
              followUpQuestions: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['summary', 'keyPoints', 'toneSuggestions'],
            additionalProperties: true,
          },
        },
      },
    };

    const response = await client.responses.create(requestPayload);

    const payload = this.extractResponseJson(response);
    return {
      summary: typeof payload.summary === 'string' && payload.summary.trim() ? payload.summary.trim() : brief,
      keyPoints: Array.isArray(payload.keyPoints)
        ? payload.keyPoints.map((item) => `${item}`.trim()).filter((item) => item.length > 0)
        : [brief],
      toneSuggestions: Array.isArray(payload.toneSuggestions)
        ? payload.toneSuggestions.map((item) => `${item}`.trim()).filter((item) => item.length > 0)
        : ['Respectful'],
      followUpQuestions: Array.isArray(payload.followUpQuestions)
        ? payload.followUpQuestions.map((item) => `${item}`.trim()).filter((item) => item.length > 0)
        : [],
      rawOutput: JSON.stringify(payload),
      model,
    } satisfies IssueRefinement;
  }

  private extractResponseJson(response: any): any {
    if (!response) return {};
    if (response.output && Array.isArray(response.output)) {
      for (const item of response.output) {
        if (!item) continue;
        if (Array.isArray(item.content)) {
          for (const chunk of item.content) {
            if (chunk?.type === 'output_text' && chunk.text) {
              try {
                return JSON.parse(chunk.text);
              } catch {
                continue;
              }
            }
            if (chunk?.type === 'text' && chunk.text) {
              try {
                return JSON.parse(chunk.text);
              } catch {
                continue;
              }
            }
          }
        }
        if (item?.type === 'output_text' && item?.text) {
          try {
            return JSON.parse(item.text);
          } catch {
            continue;
          }
        }
      }
    }
    const outputText = (response as any).output_text;
    if (typeof outputText === 'string' && outputText.trim()) {
      try {
        return JSON.parse(outputText);
      } catch {}
    }
    const text = JSON.stringify(response);
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

export type IssueRefinement = {
  summary: string;
  keyPoints: string[];
  toneSuggestions: string[];
  followUpQuestions?: string[];
  rawOutput?: string;
  model: string;
};

