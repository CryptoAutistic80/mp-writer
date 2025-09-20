import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FollowUpDetailDto } from './dto/generate.dto';

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  async generate(input: {
    prompt: string;
    model?: string;
    tone?: string;
    details?: FollowUpDetailDto[];
    mpName?: string;
    constituency?: string;
    userName?: string;
    userAddressLine?: string;
  }) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    const model = input.model || this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    const tone = (input.tone || '').trim();
    const mpName = (input.mpName || '').trim();
    const constituency = (input.constituency || '').trim();
    const userName = (input.userName || '').trim();
    const userAddressLine = (input.userAddressLine || '').trim();

    const detailLines = (input.details || [])
      .filter((item) => item && item.question && item.answer)
      .map((item) => `- ${item.question.trim()}: ${item.answer.trim()}`)
      .join('\n');

    const audienceLine = mpName
      ? `The letter is addressed to ${mpName}${constituency ? `, Member of Parliament for ${constituency}` : ''}.`
      : 'The letter is addressed to the recipient constituent\'s Member of Parliament.';

    const senderLineParts = [];
    if (userName) senderLineParts.push(`Name: ${userName}`);
    if (userAddressLine) senderLineParts.push(`Address: ${userAddressLine}`);
    const senderLine = senderLineParts.length
      ? `Include the sender information:
${senderLineParts.map((line) => `- ${line}`).join('\n')}`
      : 'Include a space for the sender to add their name and address if they are missing.';

    const toneInstruction = tone
      ? `Write the letter in a ${tone.toLowerCase()} tone.`
      : 'Use a respectful and persuasive tone suitable for contacting an MP.';

    const supportingDetailBlock = detailLines
      ? `Additional background details provided by the user:
${detailLines}`
      : 'No additional background details were provided beyond the summary below.';

    const finalPrompt = `You are MP Writer, an assistant that drafts fact-checked constituency letters with citations.
${audienceLine}
${senderLine}

Follow these rules:
- Produce a concise, well-structured letter ready to send.
- Ground every claim in reputable evidence. Use numbered citations referencing trustworthy UK sources where possible.
- Suggest specific actions for the MP to take on behalf of the constituent.
- Close with an appreciative sign-off.
- Keep the entire response under 500 words.
- Return the output as markdown paragraphs with numbered references like [1], [2], etc.
- After the signature, list the references with their source name and URL.

${toneInstruction}

Issue summary from the user:
${input.prompt.trim()}

${supportingDetailBlock}`;

    if (!apiKey) {
      // In dev without key, return a stub so flows work
      return { content: `DEV-STUB LETTER\n\n${finalPrompt.slice(0, 400)}...` };
    }
    // Lazy import to avoid startup error if pkg missing in some envs
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: finalPrompt }],
      temperature: 0.7,
    });
    const content = resp.choices?.[0]?.message?.content ?? '';
    return { content };
  }
}

