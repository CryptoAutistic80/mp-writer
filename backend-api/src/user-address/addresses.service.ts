import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '@mp-writer/nest-modules';

export interface NormalizedAddress {
  id: string;
  line1: string;
  line2?: string;
  city?: string;
  county?: string;
  postcode: string;
  label: string;
};

function normalizePostcode(input: string) {
  const tight = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(tight)) return null;
  return `${tight.slice(0, -3)} ${tight.slice(-3)}`;
}

@Injectable()
export class AddressesService {
  private static readonly LOOKUP_CACHE_TTL_SECONDS = 60 * 60;
  private static readonly ADDRESS_CACHE_TTL_SECONDS = 60 * 60;

  constructor(
    private readonly config: ConfigService,
    private readonly redisClientService: RedisClientService,
  ) {}

  private getSuggestionCacheKey(normalizedPostcode: string): string {
    const tight = normalizedPostcode.replace(/\s+/g, '').toUpperCase();
    return `addresses:suggestions:${tight}`;
  }

  private getAddressCacheKey(id: string): string {
    return `addresses:details:${id}`;
  }

  private async readCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redisClientService.getClient().get(key);
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch {
      return null;
    }
  }

  private async writeCache<T>(key: string, payload: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redisClientService
        .getClient()
        .set(key, JSON.stringify(payload), 'EX', ttlSeconds);
    } catch {
      // Ignore cache write failures
    }
  }

  private async deleteCache(key: string): Promise<void> {
    try {
      await this.redisClientService.getClient().del(key);
    } catch {
      // Ignore cache invalidation failures
    }
  }

  private async readSuggestionsCache(postcode: string): Promise<NormalizedAddress[] | null> {
    return this.readCache<NormalizedAddress[]>(this.getSuggestionCacheKey(postcode));
  }

  private async writeSuggestionsCache(postcode: string, addresses: NormalizedAddress[]): Promise<void> {
    await this.writeCache(
      this.getSuggestionCacheKey(postcode),
      addresses,
      AddressesService.LOOKUP_CACHE_TTL_SECONDS,
    );
  }

  private async readAddressCache(id: string): Promise<NormalizedAddress | null> {
    return this.readCache<NormalizedAddress>(this.getAddressCacheKey(id));
  }

  private async writeAddressCache(id: string, address: NormalizedAddress): Promise<void> {
    await this.writeCache(
      this.getAddressCacheKey(id),
      address,
      AddressesService.ADDRESS_CACHE_TTL_SECONDS,
    );
  }

  async clearSuggestionsCache(postcode: string): Promise<void> {
    const normalized = normalizePostcode(postcode || '');
    if (!normalized) return;
    await this.deleteCache(this.getSuggestionCacheKey(normalized));
  }

  async clearAddressCache(id: string): Promise<void> {
    if (!id) return;
    await this.deleteCache(this.getAddressCacheKey(id));
  }

  async lookup(postcode: string): Promise<NormalizedAddress[]> {
    const pc = normalizePostcode(postcode || '');
    if (!pc) return [];

    const cached = await this.readSuggestionsCache(pc);
    if (cached) {
      return cached;
    }

    const getAddressKey = this.config.get<string>('GETADDRESS_API_KEY');
    const debug = this.config.get<string>('ADDRESS_DEBUG') === '1';
    // Single provider: getAddress.io
    if (getAddressKey) {
      const attemptAutocomplete = async (pcParam: string) => {
        const url = `https://api.getaddress.io/autocomplete/${encodeURIComponent(pcParam)}?api-key=${encodeURIComponent(getAddressKey)}`;
        const logUrl = `https://api.getaddress.io/autocomplete/${encodeURIComponent(pcParam)}`;
        if (debug) console.log(`[addresses] GET ${logUrl}`);
        const res = await fetch(url);
        if (debug) console.log(`[addresses] <= ${res.status}`);
        return { res, url: logUrl };
      };

      try {
        // First try with spaced format; fall back to tight format on 404
        let { res } = await attemptAutocomplete(pc);
        if (res.status === 404) {
          const tight = pc.replace(/\s+/g, '');
          ({ res } = await attemptAutocomplete(tight));
        }
        if (res.status === 404) {
          if (debug) console.log('[addresses] No results for postcode');
          await this.writeSuggestionsCache(pc, []);
          return [];
        }
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          if (debug) console.log(`[addresses] Error body: ${msg?.slice?.(0, 300)}`);
          throw new BadGatewayException(`Address provider error${msg ? `: ${msg}` : ''}`);
        }

        const autocompleteData: any = await res.json();
        const suggestions: any[] = Array.isArray(autocompleteData?.suggestions) ? autocompleteData.suggestions : [];
        if (debug) console.log(`[addresses] Found ${suggestions.length} suggestions`);

        // IMPORTANT: Do NOT call provider's get endpoint for every suggestion.
        // Only return lightweight suggestions (id + label). Client will
        // fetch details for the selected id via getById().
        const addresses: NormalizedAddress[] = suggestions
          .filter((s: any) => s?.id && (s?.address || s?.text))
          .map((s: any) => {
            const label = (s.address || s.text || '').toString();
            return {
              id: s.id.toString(),
              line1: '',
              line2: '',
              city: '',
              county: '',
              postcode: pc,
              label,
            } as NormalizedAddress;
          });

        if (debug) console.log(`[addresses] Returning ${addresses.length} suggestions (no prefetch)`);
        await this.writeSuggestionsCache(pc, addresses);
        return addresses;
      } catch (e) {
        if (e instanceof BadGatewayException) throw e;
        throw new BadGatewayException('Address provider error');
      }
    }

    // No key configured — return dev-friendly mock so UI works locally
    if (!getAddressKey && process.env.NODE_ENV !== 'production') {
      const mock: NormalizedAddress[] = [
        { id: 'm1', line1: '1 Example Street', line2: '', city: 'Exampletown', county: 'Example County', postcode: pc, label: `1 Example Street, Exampletown, Example County, ${pc}` },
        { id: 'm2', line1: '2 Sample Road', line2: 'Flat 3', city: 'Sampleton', county: 'Sample County', postcode: pc, label: `2 Sample Road, Flat 3, Sampleton, Sample County, ${pc}` },
      ];
      await this.writeSuggestionsCache(pc, mock);
      return mock;
    }

    // In production, return empty list
    await this.writeSuggestionsCache(pc, []);
    return [];
  }

  async getAddressById(id: string, defaultPostcode?: string): Promise<NormalizedAddress | null> {
    const getAddressKey = this.config.get<string>('GETADDRESS_API_KEY');
    const debug = this.config.get<string>('ADDRESS_DEBUG') === '1';
    if (!getAddressKey) return null;
    if (!id) return null;

    const cached = await this.readAddressCache(id);
    if (cached) {
      return cached;
    }

    const url = `https://api.getaddress.io/get/${encodeURIComponent(id)}?api-key=${encodeURIComponent(getAddressKey)}`;
    const logUrl = `https://api.getaddress.io/get/${encodeURIComponent(id)}`;
    if (debug) console.log(`[addresses] GET ${logUrl}`);
    const res = await fetch(url);
    if (debug) console.log(`[addresses] <= ${res.status}`);
    if (!res.ok) return null;

    const full: any = await res.json();
    const line1 = (full.line_1 || `${full.building_number || ''} ${full.thoroughfare || ''}`).trim();
    const line2 = (full.line_2 || '').trim();
    const city = full.town_or_city || '';
    const county = full.county || '';
    const postcode = full.postcode || defaultPostcode || '';
    const label = [line1, line2, city, county, postcode].filter(Boolean).join(', ');

    const address: NormalizedAddress = {
      id: id.toString(),
      line1,
      line2,
      city,
      county,
      postcode,
      label,
    };

    await this.writeAddressCache(id, address);
    return address;
  }
}
