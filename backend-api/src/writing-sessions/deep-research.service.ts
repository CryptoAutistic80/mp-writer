import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IssueRefinement } from '../ai/ai.service';
import { WritingSessionCitation } from './schemas/writing-session.schema';

export type DeepResearchResult = {
  letterBody: string;
  citations: WritingSessionCitation[];
  rawOutput?: string;
  model: string;
};

@Injectable()
export class DeepResearchService {
  constructor(private readonly config: ConfigService) {}

  async run(input: {
    brief: string;
    refinement: IssueRefinement | null | undefined;
    mpSnapshot: any;
    addressSnapshot: any;
  }): Promise<DeepResearchResult> {
    const refinement = input.refinement;
    const summary = refinement?.summary ?? input.brief;
    const keyPoints = Array.isArray(refinement?.keyPoints) && refinement?.keyPoints.length
      ? refinement!.keyPoints
      : [input.brief];
    const tone = Array.isArray(refinement?.toneSuggestions) && refinement.toneSuggestions.length
      ? refinement.toneSuggestions.join(', ')
      : 'Respectful';

    const userAddressBlock = this.formatAddress(input.addressSnapshot);
    const mpAddressBlock = this.formatMpAddress(input.mpSnapshot);
    const mpName = this.extractMpName(input.mpSnapshot);
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = this.config.get<string>('OPENAI_RESEARCH_MODEL', 'o4-mini');

    if (!apiKey) {
      const letterBody = this.buildDevLetter({
        summary,
        keyPoints,
        tone,
        userAddressBlock,
        mpAddressBlock,
        mpName,
      });
      return {
        letterBody,
        citations: [
          {
            label: 'Example citation — replace with real research when OpenAI API is configured.',
            note: 'Set OPENAI_API_KEY to enable live deep research.',
          },
        ],
        rawOutput: letterBody,
        model: 'dev-mock',
      };
    }

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });
    const timeoutMs = Number(this.config.get('RESEARCH_TIMEOUT_MS') ?? 180000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs > 0 ? timeoutMs : 180000);

    try {
      const requestPayload: any = {
        model,
        temperature: 0.2,
        max_output_tokens: 2000,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'You are an expert researcher drafting letters from UK constituents to their Members of Parliament.',
                  'Conduct any necessary research using your tools and produce a complete letter ready for mailing.',
                  'The letter must start with the constituent\'s mailing address on separate lines, then a blank line,',
                  'then the current date written out (e.g. 12 March 2025), another blank line, then the MP\'s mailing address.',
                  'After the addresses include an appropriate salutation and produce a persuasive letter body that references',
                  'credible sources. Conclude with a polite closing. Return your answer as JSON matching the schema.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  `Original issue description:\n${input.brief}`,
                  `\nRefined summary:\n${summary}`,
                  `\nKey points:\n${keyPoints.map((p) => `- ${p}`).join('\n')}`,
                  `\nPreferred tone: ${tone}`,
                  `\nConstituent mailing address:\n${userAddressBlock || 'Not provided'}`,
                  `\nMP details:\n${mpName}\n${mpAddressBlock}`,
                ].join('\n'),
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'research_letter',
            schema: {
              type: 'object',
              properties: {
                letterBody: { type: 'string' },
                citations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      url: { type: 'string' },
                      note: { type: 'string' },
                    },
                    required: ['label'],
                    additionalProperties: true,
                  },
                },
              },
              required: ['letterBody'],
              additionalProperties: true,
            },
          },
        },
      };

      const response = await client.responses.create(requestPayload, { signal: controller.signal });

      const payload = this.extractResponseJson(response);
      const letterBody = typeof payload.letterBody === 'string' && payload.letterBody.trim()
        ? payload.letterBody.trim()
        : this.buildDevLetter({ summary, keyPoints, tone, userAddressBlock, mpAddressBlock, mpName });
      const citations = Array.isArray(payload.citations)
        ? payload.citations
            .map((item: any) => ({
              label: `${item?.label ?? ''}`.trim(),
              url: item?.url ? `${item.url}`.trim() : undefined,
              note: item?.note ? `${item.note}`.trim() : undefined,
            }))
            .filter((item: WritingSessionCitation) => item.label.length > 0)
        : [];

      return {
        letterBody,
        citations,
        rawOutput: JSON.stringify(payload),
        model,
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Deep research timed out. Try again in a moment.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
    return {};
  }

  private buildDevLetter(input: {
    summary: string;
    keyPoints: string[];
    tone: string;
    userAddressBlock: string;
    mpAddressBlock: string;
    mpName: string;
  }): string {
    const date = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const greeting = input.mpName ? `Dear ${input.mpName},` : 'Dear Member of Parliament,';
    const closing = 'Yours faithfully,';
    const keyPointParagraph = input.keyPoints
      .map((point) => `• ${point}`)
      .join('\n');
    return [
      input.userAddressBlock,
      '',
      date,
      '',
      input.mpName,
      input.mpAddressBlock,
      '',
      greeting,
      '',
      input.summary,
      '',
      'Key points to emphasise:',
      keyPointParagraph,
      '',
      `Please respond to the concerns above in a ${input.tone.toLowerCase()} manner.`,
      '',
      closing,
      '',
      'Your constituent',
    ]
      .filter((line) => line !== undefined && line !== null)
      .join('\n');
  }

  private formatAddress(address: any): string {
    if (!address) return '';
    const parts = [address.line1, address.line2, address.city, address.county, address.postcode]
      .map((part: any) => (part ? `${part}`.trim() : ''))
      .filter((part: string) => part.length > 0);
    return parts.join('\n');
  }

  private formatMpAddress(mpSnapshot: any): string {
    if (mpSnapshot?.mp?.parliamentaryAddress) {
      return `${mpSnapshot.mp.parliamentaryAddress}`.trim();
    }
    return 'House of Commons\nLondon\nSW1A 0AA';
  }

  private extractMpName(mpSnapshot: any): string {
    if (mpSnapshot?.mp?.name) {
      return `${mpSnapshot.mp.name}`.trim();
    }
    return 'Member of Parliament';
  }
}
