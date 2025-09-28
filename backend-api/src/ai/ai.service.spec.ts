import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';

type ConfigValues = Record<string, string | undefined>;

class ConfigServiceStub {
  constructor(private readonly values: ConfigValues = {}) {}

  get<T = string>(key: string, defaultValue?: T): T | undefined {
    if (Object.prototype.hasOwnProperty.call(this.values, key)) {
      return this.values[key] as unknown as T;
    }
    return defaultValue;
  }
}

describe('AiService - buildDeepResearchRequestExtras', () => {
  const createService = (values: ConfigValues = {}) => {
    const config = new ConfigServiceStub(values) as unknown as ConfigService;
    return new AiService(config, {} as any, {} as any, {} as any);
  };

  it('includes reasoning defaults when env is not set', () => {
    const service = createService();
    const extras = (service as any).buildDeepResearchRequestExtras();

    expect(extras.reasoning).toEqual({ summary: 'auto', effort: 'medium' });
  });

  it('applies env overrides for reasoning summary and effort', () => {
    const service = createService({
      OPENAI_DEEP_RESEARCH_ENABLE_WEB_SEARCH: 'false',
      OPENAI_DEEP_RESEARCH_REASONING_SUMMARY: 'off',
      OPENAI_DEEP_RESEARCH_REASONING_EFFORT: 'high',
    });

    const extras = (service as any).buildDeepResearchRequestExtras();

    expect(extras.reasoning).toEqual({ summary: null, effort: 'high' });
    expect(extras.tools).toBeUndefined();
  });
});
