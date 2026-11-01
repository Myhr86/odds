import { ProviderError, type EventQuery, type OddsProvider, type OddsResult, type ProviderEvent, type ProviderStatus } from "../types";
import { parseEvent, parseOddsEvent, PROVIDER } from "./parse";

/**
 * odds-api.io REST adapter (server-side only).
 *
 * Documented (docs.odds-api.io, via search 2026-11-01 – re-verify with the probe):
 *  - Base URL https://api.odds-api.io/v3, API key as `apiKey` query parameter.
 *  - GET /bookmakers, /sports (documented as usable without key), /events, /odds, /odds/multi (≤10 events,
 *    billed as one request), /historical/odds, /historical/events.
 *  - WebSocket wss://api.odds-api.io/v3/ws, paid plans, 2× REST price → NOT implemented until
 *    Norsk Tipping coverage on the socket is verified.
 *  - The bookmakers returned by /odds are limited to the bookmakers selected on the account.
 */
export interface OddsApiIoConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Some SDK notes say `markets` became required on odds endpoints; pass explicitly if so. */
  markets?: string[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export const ODDS_MULTI_BATCH = 10;

export class OddsApiIoProvider implements OddsProvider {
  readonly name = PROVIDER;
  readonly origin = "LIVE_PROVIDER" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  /** Last seen rate-limit headers (names vary; we capture anything that looks like one). */
  lastRateLimit: Record<string, string> = {};

  constructor(private readonly cfg: OddsApiIoConfig) {
    if (!cfg.apiKey) throw new ProviderError("ODDS_API_IO_KEY is not set", PROVIDER);
    this.baseUrl = (cfg.baseUrl ?? "https://api.odds-api.io/v3").replace(/\/$/, "");
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? (() => new Date());
  }

  /** Raw GET returning parsed JSON. Exposed for the probe script. Never logs the key. */
  async get(path: string, params: Record<string, string | number | undefined> = {}, withKey = true): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    if (withKey) url.searchParams.set("apiKey", this.cfg.apiKey);
    const safe = url.toString().replace(this.cfg.apiKey, "***");
    const maxRetries = this.cfg.maxRetries ?? 3;

    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 15_000);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      } catch (e) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ProviderError(`Network error for ${safe}: ${(e as Error).message}`, PROVIDER, undefined, true);
      }
      clearTimeout(timer);
      this.captureRateLimit(res.headers);
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt));
        continue;
      }
      const body = (await res.text().catch(() => "")).slice(0, 300).replace(this.cfg.apiKey, "***");
      throw new ProviderError(`HTTP ${res.status} for ${safe}: ${body}`, PROVIDER, res.status, retryable);
    }
  }

  private captureRateLimit(h: Headers) {
    const rl: Record<string, string> = {};
    h.forEach((v, k) => {
      if (/rate|limit|remaining|quota|requests/i.test(k)) rl[k] = v;
    });
    if (Object.keys(rl).length) this.lastRateLimit = rl;
  }

  async getBookmakers(): Promise<Array<{ name: string; active?: boolean }>> {
    const raw = await this.get("/bookmakers", {}, false);
    if (!Array.isArray(raw)) throw new ProviderError("Unexpected /bookmakers response shape", PROVIDER);
    return raw.map((b) => (typeof b === "string" ? { name: b } : { name: String((b as { name?: unknown }).name), active: (b as { active?: boolean }).active }));
  }

  async getEvents(q: EventQuery): Promise<ProviderEvent[]> {
    const raw = await this.get("/events", { sport: q.sport, league: q.league, bookmaker: q.bookmaker, status: "pending", limit: q.limit, from: q.from, to: q.to });
    const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);
    const out: ProviderEvent[] = [];
    for (const item of list) {
      try {
        out.push(parseEvent(item));
      } catch {
        /* skip malformed event; surfaced by the probe */
      }
    }
    return out;
  }

  async getOdds(providerEventIds: string[], bookmakers: string[]): Promise<OddsResult[]> {
    const results: OddsResult[] = [];
    const markets = this.cfg.markets?.join(",");
    for (let i = 0; i < providerEventIds.length; i += ODDS_MULTI_BATCH) {
      const batch = providerEventIds.slice(i, i + ODDS_MULTI_BATCH);
      const raw = await this.get("/odds/multi", { eventIds: batch.join(","), bookmakers: bookmakers.join(","), markets });
      const fetchedAt = this.now().toISOString();
      const list = Array.isArray(raw) ? raw : [raw];
      for (const ev of list) results.push(parseOddsEvent(ev, fetchedAt));
    }
    return results;
  }

  async getHistoricalOdds(providerEventId: string, bookmakers: string[]): Promise<OddsResult> {
    const raw = await this.get("/historical/odds", { eventId: providerEventId, bookmakers: bookmakers.join(",") });
    return parseOddsEvent(raw, this.now().toISOString());
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    const t0 = Date.now();
    try {
      await this.get("/sports", {}, false);
      return { provider: PROVIDER, ok: true, checkedAt: this.now().toISOString(), latencyMs: Date.now() - t0, rateLimit: this.lastRateLimit, origin: this.origin };
    } catch (e) {
      return { provider: PROVIDER, ok: false, checkedAt: this.now().toISOString(), latencyMs: null, rateLimit: this.lastRateLimit, message: (e as Error).message, origin: this.origin };
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(16_000, 2000 * 2 ** attempt);
