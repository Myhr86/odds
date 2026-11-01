import { ProviderError, type EventQuery, type OddsProvider, type OddsResult, type ProviderEvent, type ProviderStatus } from "../types";
import { parseEvent, parseOddsEvent, PROVIDER, TheOddsApiSport } from "./parse";

/**
 * The Odds API v4 adapter (server-side only). Used for REFERENCE bookmakers only – it does not
 * carry Norsk Tipping (option A: Norsk Tipping odds are entered manually).
 *
 * Credit model (docs): /sports and /sports/{sport}/events are free; /sports/{sport}/odds costs
 * markets × regions per call and returns ALL events of that sport/league. Free plan: 500 credits/month.
 * Usage headers: x-requests-remaining, x-requests-used, x-requests-last.
 */
export interface TheOddsApiConfig {
  apiKey: string;
  baseUrl?: string;
  regions?: string[];
  markets?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface Usage {
  remaining: number | null;
  used: number | null;
  last: number | null;
}

export class TheOddsApiProvider implements OddsProvider {
  readonly name = PROVIDER;
  readonly origin = "LIVE_PROVIDER" as const;
  usage: Usage = { remaining: null, used: null, last: null };
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly cfg: TheOddsApiConfig) {
    if (!cfg.apiKey) throw new ProviderError("THE_ODDS_API_KEY is not set", PROVIDER);
    this.baseUrl = (cfg.baseUrl ?? "https://api.the-odds-api.com/v4").replace(/\/$/, "");
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? (() => new Date());
  }

  get regions() {
    return this.cfg.regions ?? ["eu"];
  }
  get markets() {
    return this.cfg.markets ?? ["h2h", "totals"];
  }
  /** Credits one /odds call will cost. */
  get creditsPerOddsCall() {
    return this.regions.length * this.markets.length;
  }

  async get(path: string, params: Record<string, string | undefined> = {}): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    url.searchParams.set("apiKey", this.cfg.apiKey);
    const safe = url.toString().replace(this.cfg.apiKey, "***");
    const maxRetries = this.cfg.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 15_000);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      } catch (e) {
        clearTimeout(t);
        if (attempt < maxRetries) {
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        throw new ProviderError(`Network error for ${safe}: ${(e as Error).message}`, PROVIDER, undefined, true);
      }
      clearTimeout(t);
      const num = (h: string) => {
        const v = res.headers.get(h);
        return v === null || v === "" ? null : Number(v);
      };
      if (res.headers.has("x-requests-remaining")) this.usage = { remaining: num("x-requests-remaining"), used: num("x-requests-used"), last: num("x-requests-last") };
      if (res.ok) return res.json();
      // 429 = rate limited (retry); 401 with quota message = out of credits (do not retry).
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      const body = (await res.text().catch(() => "")).slice(0, 300).replace(this.cfg.apiKey, "***");
      throw new ProviderError(`HTTP ${res.status} for ${safe}: ${body}`, PROVIDER, res.status, res.status === 429);
    }
  }

  /** Free. Football leagues currently in season. */
  async getFootballLeagues(): Promise<TheOddsApiSport[]> {
    const raw = await this.get("/sports");
    return TheOddsApiSport.array().parse(raw).filter((s) => s.group === "Soccer" && s.active && !s.has_outrights);
  }

  /** Free. `q.league` is a sport key such as soccer_epl or soccer_norway_eliteserien. */
  async getEvents(q: EventQuery): Promise<ProviderEvent[]> {
    if (!q.league) throw new ProviderError("The Odds API needs a league (sport key)", PROVIDER);
    const raw = await this.get(`/sports/${encodeURIComponent(q.league)}/events`, { dateFormat: "iso", commenceTimeFrom: q.from, commenceTimeTo: q.to });
    const out: ProviderEvent[] = [];
    for (const r of raw as unknown[]) {
      try {
        out.push(parseEvent(r));
      } catch {
        /* outrights / malformed */
      }
    }
    return out;
  }

  /** Costs markets × regions credits per call. `ids` are "<sportKey>:<eventId>" or plain ids with cfg league. */
  async getOdds(ids: string[], bookmakers: string[] = []): Promise<OddsResult[]> {
    const bySport = new Map<string, string[]>();
    for (const id of ids) {
      const [sport, ev] = id.includes(":") ? id.split(":") : [undefined, id];
      if (!sport) throw new ProviderError(`Event id must be "<sportKey>:<eventId>", got ${id}`, PROVIDER);
      bySport.set(sport, [...(bySport.get(sport) ?? []), ev!]);
    }
    const out: OddsResult[] = [];
    for (const [sport, evIds] of bySport) out.push(...(await this.getLeagueOdds(sport, evIds, bookmakers)));
    return out;
  }

  async getLeagueOdds(sportKey: string, eventIds?: string[], bookmakers: string[] = []): Promise<OddsResult[]> {
    const raw = await this.get(`/sports/${encodeURIComponent(sportKey)}/odds`, {
      regions: this.regions.join(","),
      markets: this.markets.join(","),
      oddsFormat: "decimal",
      dateFormat: "iso",
      eventIds: eventIds?.join(","),
      bookmakers: bookmakers.length ? bookmakers.join(",") : undefined,
    });
    const fetchedAt = this.now().toISOString();
    const out: OddsResult[] = [];
    for (const r of raw as unknown[]) {
      try {
        out.push(parseOddsEvent(r, fetchedAt));
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  async getHistoricalOdds(): Promise<OddsResult> {
    throw new ProviderError("Historical odds require a paid The Odds API plan (10× credits); not used in option A", PROVIDER);
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    const t0 = Date.now();
    try {
      await this.get("/sports");
      const rl: Record<string, string> = {};
      if (this.usage.remaining !== null) rl["x-requests-remaining"] = String(this.usage.remaining);
      if (this.usage.used !== null) rl["x-requests-used"] = String(this.usage.used);
      return { provider: PROVIDER, ok: true, checkedAt: this.now().toISOString(), latencyMs: Date.now() - t0, rateLimit: rl, origin: this.origin };
    } catch (e) {
      return { provider: PROVIDER, ok: false, checkedAt: this.now().toISOString(), latencyMs: null, rateLimit: {}, message: (e as Error).message, origin: this.origin };
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
