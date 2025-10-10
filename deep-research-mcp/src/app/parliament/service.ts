import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  BillSearchDto,
  CoreDatasetQueryDto,
  HistoricHansardQueryDto,
  LegislationDocumentType,
  LegislationSearchDto,
} from './dto';
import { appendParams, createUrl } from './utils';
import { CacheService } from './cache.service';
import { QueryProcessor } from './query-processor';
import { RelevanceScorer } from './relevance-scorer';

interface ResponseMetadata {
  source: string;
  cached: boolean;
  totalResults: number;
  relevanceApplied: boolean;
  searchVariations?: string[];
}

interface EnhancedResponse<T> {
  data: T;
  metadata: ResponseMetadata;
  errors?: Array<{ endpoint: string; message: string }>;
}

interface RequestResult<T> {
  data: T;
  fromCache: boolean;
}

@Injectable()
export class ParliamentService {
  private readonly logger = new Logger(ParliamentService.name);
  private readonly http: AxiosInstance;
  
  // Cache TTL values in seconds
  private readonly cacheTtl = {
    members: Number(process.env.CACHE_TTL_MEMBERS || 3600),
    bills: Number(process.env.CACHE_TTL_BILLS || 1800),
    legislation: Number(process.env.CACHE_TTL_LEGISLATION || 7200),
    hansard: Number(process.env.CACHE_TTL_HANSARD || 3600),
    data: Number(process.env.CACHE_TTL_DATA || 1800),
  };

  constructor(
    private readonly cacheService: CacheService,
    private readonly queryProcessor: QueryProcessor,
    private readonly relevanceScorer: RelevanceScorer
  ) {
    const disableProxy =
      process.env.DEEP_RESEARCH_DISABLE_PROXY?.toLowerCase() === 'true' ||
      process.env.DEEP_RESEARCH_DISABLE_PROXY === '1';

    this.http = axios.create({
      headers: {
        'User-Agent': 'mp-writer-deep-research/1.0 (+https://mp-writer.local)',
        Accept: 'application/json',
      },
      timeout: 15000,
      ...(disableProxy ? { proxy: false } : {}),
    });
  }

  async fetchCoreDataset(
    query: CoreDatasetQueryDto
  ): Promise<EnhancedResponse<unknown>> {
    const searchTerm = query.searchTerm
      ? this.queryProcessor.sanitizeForApi(query.searchTerm)
      : undefined;

    const url = createUrl('https://lda.data.parliament.uk', `${query.dataset}.json`);
    appendParams(url, {
      _search: searchTerm,
      _page: query.page,
      _pageSize: query.perPage,
    });

    const result = await this.performRequestWithRetry<unknown>(
      url,
      this.cacheTtl.data,
      query.enableCache !== false
    );

    return this.enhanceResponse(result.data, {
      source: url.toString(),
      searchTerm,
      applyRelevance: query.applyRelevance,
      relevanceThreshold: query.relevanceThreshold,
      cached: result.fromCache,
    });
  }

  async fetchBills(query: BillSearchDto): Promise<EnhancedResponse<unknown>> {
    const searchTerm = query.searchTerm
      ? this.queryProcessor.sanitizeForApi(query.searchTerm)
      : undefined;

    const url = createUrl('https://bills-api.parliament.uk/api/v1', 'Bills');
    appendParams(url, {
      SearchTerm: searchTerm,
      House: query.house,
      Session: query.session,
      Parliament: query.parliamentNumber,
    });

    // Try primary request
    try {
      const result = await this.performRequestWithRetry<unknown>(
        url,
        this.cacheTtl.bills,
        query.enableCache !== false
      );

      return this.enhanceResponse(result.data, {
        source: url.toString(),
        searchTerm,
        applyRelevance: query.applyRelevance,
        relevanceThreshold: query.relevanceThreshold,
        cached: result.fromCache,
      });
    } catch (error) {
      // Fallback: Try without session/parliament filters if they were provided
      if (query.session || query.parliamentNumber) {
        this.logger.warn('Retrying bills search without session/parliament filters');
        const fallbackUrl = createUrl('https://bills-api.parliament.uk/api/v1', 'Bills');
        appendParams(fallbackUrl, {
          SearchTerm: searchTerm,
          House: query.house,
        });

        try {
          const result = await this.performRequestWithRetry<unknown>(
            fallbackUrl,
            this.cacheTtl.bills,
            query.enableCache !== false
          );

          return this.enhanceResponse(result.data, {
            source: fallbackUrl.toString(),
            searchTerm,
            applyRelevance: query.applyRelevance,
            relevanceThreshold: query.relevanceThreshold,
            cached: result.fromCache,
          });
        } catch (fallbackError) {
          throw error; // Throw original error
        }
      }

      throw error;
    }
  }

  async fetchHistoricHansard(
    query: HistoricHansardQueryDto
  ): Promise<EnhancedResponse<unknown>> {
    const pathWithExtension = query.path.endsWith('.json')
      ? query.path
      : `${query.path}.json`;
    const url = createUrl(
      'https://api.parliament.uk/historic-hansard',
      `${query.house}/${pathWithExtension}`
    );

    const result = await this.performRequestWithRetry<unknown>(
      url,
      this.cacheTtl.hansard,
      query.enableCache !== false
    );

    return this.enhanceResponse(result.data, {
      source: url.toString(),
      applyRelevance: false, // Historic Hansard doesn't use search terms in URL
      cached: result.fromCache,
    });
  }

  async fetchLegislation(
    query: LegislationSearchDto
  ): Promise<EnhancedResponse<unknown>> {
    const title = query.title
      ? this.queryProcessor.sanitizeForApi(query.title)
      : undefined;

    const type = query.type ?? LegislationDocumentType.All;
    const url = createUrl('https://www.legislation.gov.uk', 'search/data.feed');
    appendParams(url, {
      type: type !== LegislationDocumentType.All ? type : undefined,
      title,
      year: query.year,
    });

    try {
      const result = await this.performRequestWithRetry<unknown>(
        url,
        this.cacheTtl.legislation,
        query.enableCache !== false,
        true // Accept XML for legislation API
      );

      return this.enhanceResponse(result.data, {
        source: url.toString(),
        searchTerm: title,
        applyRelevance: query.applyRelevance,
        relevanceThreshold: query.relevanceThreshold,
        cached: result.fromCache,
      });
    } catch (error) {
      // Fallback: If specific type fails, try 'all'
      if (type !== LegislationDocumentType.All) {
        this.logger.warn(`Retrying legislation search with type 'all'`);
        const fallbackUrl = createUrl(
          'https://www.legislation.gov.uk',
          'search/data.feed'
        );
        appendParams(fallbackUrl, {
          title,
          year: query.year,
        });

        try {
          const result = await this.performRequestWithRetry<unknown>(
            fallbackUrl,
            this.cacheTtl.legislation,
            query.enableCache !== false,
            true // Accept XML for legislation API
          );

          return this.enhanceResponse(result.data, {
            source: fallbackUrl.toString(),
            searchTerm: title,
            applyRelevance: query.applyRelevance,
            relevanceThreshold: query.relevanceThreshold,
            cached: result.fromCache,
          });
        } catch (fallbackError) {
          throw error; // Throw original error
        }
      }

      throw error;
    }
  }

  private async performRequestWithRetry<T>(
    url: URL,
    cacheTtl: number,
    useCache = true,
    acceptXml = false
  ): Promise<RequestResult<T>> {
    // Try cache first
    if (useCache) {
      const cacheKey = this.cacheService.generateKey(url.toString());
      const cached = await this.cacheService.get<T>(cacheKey);
      if (cached !== null) {
        return { data: cached, fromCache: true };
      }
    }

    // Retry configuration
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const headers = acceptXml
          ? { Accept: 'application/atom+xml,application/xml,text/xml' }
          : undefined;
        
        const response = await this.http.get<T>(url.toString(), { headers });
        
        // Cache successful response
        if (useCache && this.isSuccessfulResponse(response.data)) {
          const cacheKey = this.cacheService.generateKey(url.toString());
          await this.cacheService.set(cacheKey, response.data, cacheTtl);
        }

        return { data: response.data, fromCache: false };
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          this.logger.debug(
            `Retry ${attempt}/${maxRetries} after ${delay}ms for ${url.toString()}`
          );
          await this.sleep(delay);
        }
      }
    }

    throw this.handleRequestError(url, lastError!);
  }

  private isSuccessfulResponse(data: unknown): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check LDA API response format
    if ('result' in data) {
      const result = (data as { result: unknown }).result;
      if (result && typeof result === 'object' && 'items' in result) {
        const items = (result as { items: unknown[] }).items;
        return Array.isArray(items) && items.length > 0;
      }
    }

    // Check Bills API response format
    if ('items' in data) {
      const items = (data as { items: unknown[] }).items;
      return Array.isArray(items) && items.length > 0;
    }

    // Default: consider it successful if it's an object
    return true;
  }

  private enhanceResponse<T>(
    data: T,
    options: {
      source: string;
      searchTerm?: string;
      applyRelevance?: boolean;
      relevanceThreshold?: number;
      searchVariations?: string[];
      cached?: boolean;
    }
  ): EnhancedResponse<T> {
    const metadata: ResponseMetadata = {
      source: options.source,
      cached: options.cached ?? false,
      totalResults: this.extractTotalResults(data),
      relevanceApplied: false,
      searchVariations: options.searchVariations,
    };

    // Apply relevance scoring if requested and search term is provided
    if (options.applyRelevance && options.searchTerm) {
      const items = this.extractItems(data);
      if (items && items.length > 0) {
        const scored = this.relevanceScorer.scoreAndFilter(
          items,
          options.searchTerm,
          options.relevanceThreshold
        );

        // Replace items with scored results
        const enhancedData = this.replaceItems(data, scored);
        metadata.relevanceApplied = true;
        metadata.totalResults = scored.length;

        return {
          data: enhancedData as T,
          metadata,
        };
      }
    }

    return {
      data,
      metadata,
    };
  }

  private extractTotalResults(data: unknown): number {
    if (!data || typeof data !== 'object') {
      return 0;
    }

    // LDA API format
    if ('result' in data) {
      const result = (data as { result: unknown }).result;
      if (result && typeof result === 'object') {
        if ('totalResults' in result) {
          return Number((result as { totalResults: number }).totalResults) || 0;
        }
        if ('items' in result) {
          const items = (result as { items: unknown[] }).items;
          return Array.isArray(items) ? items.length : 0;
        }
      }
    }

    // Bills API format
    if ('items' in data) {
      const items = (data as { items: unknown[] }).items;
      return Array.isArray(items) ? items.length : 0;
    }

    return 0;
  }

  private extractItems(data: unknown): unknown[] | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    // LDA API format
    if ('result' in data) {
      const result = (data as { result: unknown }).result;
      if (result && typeof result === 'object' && 'items' in result) {
        const items = (result as { items: unknown[] }).items;
        return Array.isArray(items) ? items : null;
      }
    }

    // Bills API format
    if ('items' in data) {
      const items = (data as { items: unknown[] }).items;
      return Array.isArray(items) ? items : null;
    }

    return null;
  }

  private replaceItems<T>(data: T, newItems: unknown[]): T {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const dataCopy = { ...data };

    // LDA API format
    if ('result' in dataCopy) {
      const result = (dataCopy as { result: unknown }).result;
      if (result && typeof result === 'object') {
        (dataCopy as { result: { items: unknown[] } }).result = {
          ...(result as object),
          items: newItems,
        };
      }
    }

    // Bills API format
    if ('items' in dataCopy) {
      (dataCopy as { items: unknown[] }).items = newItems;
    }

    return dataCopy;
  }

  private handleRequestError(url: URL, error: Error) {
    if (axios.isAxiosError(error)) {
      return this.handleAxiosError(url, error);
    }

    this.logger.error(
      `Unexpected error while calling ${url.toString()}: ${error.message}`
    );
    return new BadGatewayException('Unexpected error contacting data service');
  }

  private handleAxiosError(url: URL, error: AxiosError) {
    const status = error.response?.status;
    const statusText = error.response?.statusText ?? 'Unknown error';

    this.logger.warn(
      `Upstream request to ${url.toString()} failed with status ${status ?? 'N/A'}: ${statusText}`
    );

    return new BadGatewayException({
      message: 'Failed to query upstream parliamentary data service',
      status,
      upstream: url.toString(),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
