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

@Injectable()
export class ParliamentService {
  private readonly logger = new Logger(ParliamentService.name);
  private readonly http: AxiosInstance;

  constructor() {
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

  async fetchCoreDataset(query: CoreDatasetQueryDto): Promise<unknown> {
    const url = createUrl('https://lda.data.parliament.uk', `${query.dataset}.json`);
    appendParams(url, {
      _search: query.searchTerm,
      _page: query.page,
      _pageSize: query.perPage,
    });

    return this.performRequest<unknown>(url);
  }

  async fetchBills(query: BillSearchDto): Promise<unknown> {
    const url = createUrl('https://bills-api.parliament.uk/api', 'Bills');
    appendParams(url, {
      SearchTerm: query.searchTerm,
      House: query.house,
      Session: query.session,
      Parliament: query.parliamentNumber,
    });

    return this.performRequest<unknown>(url);
  }

  async fetchHistoricHansard(
    query: HistoricHansardQueryDto
  ): Promise<unknown> {
    const pathWithExtension = query.path.endsWith('.json')
      ? query.path
      : `${query.path}.json`;
    const url = createUrl(
      'https://api.parliament.uk/historic-hansard',
      `${query.house}/${pathWithExtension}`
    );

    return this.performRequest<unknown>(url);
  }

  async fetchLegislation(query: LegislationSearchDto): Promise<unknown> {
    const type = query.type ?? LegislationDocumentType.All;
    const url = createUrl('https://www.legislation.gov.uk', `${type}/data.json`);
    appendParams(url, {
      title: query.title,
      year: query.year,
    });

    return this.performRequest<unknown>(url);
  }

  private async performRequest<T>(url: URL): Promise<T> {
    try {
      const response = await this.http.get<T>(url.toString());
      return response.data;
    } catch (error) {
      throw this.handleRequestError(url, error);
    }
  }

  private handleRequestError(url: URL, error: unknown) {
    if (axios.isAxiosError(error)) {
      return this.handleAxiosError(url, error);
    }

    this.logger.error(`Unexpected error while calling ${url.toString()}`);
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
}
