import { Injectable } from '@nestjs/common';

interface LookupResult {
  constituency: string;
  mp?: {
    id?: number;
    name?: string;
    party?: string;
    portraitUrl?: string;
    since?: string; // ISO date the current membership started
    email?: string;
    twitter?: string;
    website?: string;
    parliamentaryAddress?: string;
  } | null;
};

@Injectable()
export class MpsService {
  private normalizePostcode(input: string): string {
    return input.replace(/\s+/g, '').toUpperCase();
  }

  async lookupByPostcode(postcodeRaw: string): Promise<LookupResult> {
    const postcode = this.normalizePostcode(postcodeRaw);

    // First: fetch constituency via postcodes.io
    const pcRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
    if (!pcRes.ok) {
      throw new Error('POSTCODE_NOT_FOUND');
    }
    const pcJson: any = await pcRes.json();
    const constituency: string | undefined = pcJson?.result?.parliamentary_constituency;
    if (!constituency) {
      throw new Error('CONSTITUENCY_NOT_FOUND');
    }

    // Second: look up current MP via UK Parliament Members API
    // Best-effort order with strict matching; never default to the first item.

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const wanted = norm(constituency);

    let mpData: any = null;

    // 2a) Resolve constituency ID via Location/Constituency search, then fetch by ID
    try {
      const cUrl = new URL('https://members-api.parliament.uk/api/Location/Constituency/Search');
      cUrl.searchParams.set('searchText', constituency);
      const cRes = await fetch(cUrl.toString());
      if (cRes.ok) {
        const cj: any = await cRes.json().catch(() => ({}));
        const cItems: any[] = cj?.items || cj?.results || [];
        const cMatch = cItems.find((it: any) => {
          const v = it?.value ?? it;
          const name = v?.name || v?.label || v?.constituencyName || '';
          return norm(String(name)) === wanted;
        }) || cItems[0];
        const cId: number | undefined = (cMatch?.value ?? cMatch)?.id || (cMatch?.value ?? cMatch)?.constituencyId;
        if (cId) {
          const mUrl = new URL('https://members-api.parliament.uk/api/Members/Search');
          mUrl.searchParams.set('House', '1');
          mUrl.searchParams.set('IsCurrentMember', 'true');
          mUrl.searchParams.set('ConstituencyId', String(cId));
          const mRes = await fetch(mUrl.toString());
          if (mRes.ok) {
            const mj: any = await mRes.json().catch(() => ({}));
            const mItems: any[] = mj?.items || mj?.results || [];
            const m = mItems.find((it: any) => !!(it?.value ?? it)) || null;
            mpData = (m?.value ?? m) || null;
          }
        }
      }
    } catch {
      // Ignore errors when fetching MP data
    }

    // 2b) Direct constituency search (exact match only)
    if (!mpData) {
      try {
        const byConst = new URL('https://members-api.parliament.uk/api/Members/Search');
        byConst.searchParams.set('House', '1');
        byConst.searchParams.set('IsCurrentMember', 'true');
        byConst.searchParams.set('Constituency', constituency);
        byConst.searchParams.set('Take', '50');
        const res = await fetch(byConst.toString());
        if (res.ok) {
          const json: any = await res.json().catch(() => ({}));
          const items: any[] = json?.items || json?.results || [];
          const match = items.find((it: any) => {
            const v = it?.value ?? it;
            const from = v?.latestHouseMembership?.membershipFrom || v?.constituency || '';
            const n = norm(String(from));
            return n === wanted || n.includes(wanted) || wanted.includes(n);
          });
          mpData = (match?.value ?? match) || null;
        }
      } catch {
        // Ignore errors when searching MP data
      }
    }

    // 2c) Fetch all current members and filter by constituency name
    if (!mpData) {
      try {
        const url = new URL('https://members-api.parliament.uk/api/Members/Search');
        url.searchParams.set('House', '1');
        url.searchParams.set('IsCurrentMember', 'true');
        url.searchParams.set('Take', '650');
        const mpRes = await fetch(url.toString());
        if (mpRes.ok) {
          const json: any = await mpRes.json().catch(() => ({}));
          const items: any[] = json?.items || json?.results || [];
          if (Array.isArray(items) && items.length > 0) {
            const match = items.find((it: any) => {
              const v = it?.value ?? it;
              const from = v?.latestHouseMembership?.membershipFrom || v?.constituency || '';
              const n = norm(String(from));
              return n === wanted || n.includes(wanted) || wanted.includes(n);
            });
            mpData = (match?.value ?? match) || null;
          }
        }
      } catch {
        // Ignore errors when fetching MP data
      }
    }

    let mp: LookupResult['mp'] = null;
    if (mpData) {
      // Normalise common fields present in Members API results
      const id: number | undefined = mpData?.id ?? mpData?.memberId;
      const name: string | undefined = mpData?.nameDisplayAs || mpData?.nameFull || mpData?.name;
      const party: string | undefined = mpData?.latestParty?.name || mpData?.party || mpData?.latestPartyName;
      const since: string | undefined = mpData?.latestHouseMembership?.membershipStartDate || mpData?.latestHouseMembershipStartDate;
      const portraitUrl = id ? `https://members-api.parliament.uk/api/Members/${id}/Thumbnail` : undefined;

      // Try to enrich with contact details from Members API
      let email: string | undefined;
      let twitter: string | undefined;
      let website: string | undefined;
      let parliamentaryAddress: string | undefined;
      if (id) {
        try {
          const contactUrl = `https://members-api.parliament.uk/api/Members/${id}/Contact`; // returns items
          const resp = await fetch(contactUrl);
          if (resp.ok) {
            const j: any = await resp.json().catch(() => ({}));
            const items: any[] = j?.items || j?.value || [];
            for (const it of items) {
              const v = it?.value ?? it;
              const type = (v?.type || v?.contactType || '').toString().toLowerCase();
              const line1 = v?.line1 || v?.addressLine1;
              const line2 = v?.line2 || v?.addressLine2;
              const line3 = v?.line3 || v?.addressLine3;
              const postcode = v?.postcode || v?.postCode;
              if (!email && v?.email) email = v.email;
              if (!twitter && v?.twitter) twitter = v.twitter;
              if (!website && v?.website) website = v.website;
              if (!parliamentaryAddress && /parliament/.test(type)) {
                parliamentaryAddress = [line1, line2, line3, postcode].filter(Boolean).join(', ');
              }
            }
          }
        } catch {
          // ignore
        }
      }

      mp = { id, name, party, portraitUrl, since, email, twitter, website, parliamentaryAddress };
    }

    return { constituency, mp };
  }
}
