import { z } from "zod";
import { lineKind, marketKey } from "../../markets/types";
import type { OddsQuote, OddsResult, ProviderEvent, UnmappedMarket } from "../types";
import { ODDS_API_IO_MARKETS, toCanonical } from "./mapping";

export const PROVIDER = "odds-api.io";

/**
 * Tolerant schemas: odds-api.io examples show numeric odds as strings in some places and
 * numbers in others, and `updatedAt` as ISO strings or epoch-ms. Unknown fields pass through.
 * These schemas encode the DOCUMENTED shape; they must be checked against recorded responses.
 */
const num = z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? v : Number(v)));
const ts = z.union([z.string(), z.number()]).nullish();

const NamedRef = z.union([z.object({ name: z.string(), slug: z.string().optional() }).passthrough(), z.string()]).optional();

export const EventSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    home: z.string(),
    away: z.string(),
    date: z.string(),
    status: z.string().optional(),
    sport: NamedRef,
    league: NamedRef,
  })
  .passthrough();

const MarketSchema = z
  .object({
    name: z.string(),
    updatedAt: ts,
    odds: z.array(z.record(z.unknown())),
  })
  .passthrough();

export const OddsEventSchema = EventSchema.extend({
  bookmakers: z.record(z.array(MarketSchema)).default({}),
}).passthrough();

export function normaliseTimestamp(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapStatus(s: string | undefined): ProviderEvent["status"] {
  switch ((s ?? "").toLowerCase()) {
    case "pending":
    case "prematch":
    case "scheduled":
      return "scheduled";
    case "live":
      return "live";
    case "settled":
    case "finished":
    case "ended":
      return "finished";
    case "cancelled":
    case "canceled":
    case "postponed":
      return "cancelled";
    default:
      return "unknown";
  }
}

const refName = (r: z.infer<typeof NamedRef>) => (typeof r === "string" ? { name: r } : r ? { name: r.name, slug: r.slug } : { name: "unknown" });

export function parseEvent(raw: unknown): ProviderEvent {
  const e = EventSchema.parse(raw);
  const startsAt = normaliseTimestamp(e.date);
  if (!startsAt) throw new Error(`Event ${e.id} has unparseable date ${e.date}`);
  const sport = refName(e.sport);
  return {
    provider: PROVIDER,
    providerEventId: String(e.id),
    sport: (sport.slug ?? sport.name).toLowerCase(),
    league: refName(e.league),
    home: e.home,
    away: e.away,
    startsAt,
    status: mapStatus(e.status),
    origin: "LIVE_PROVIDER",
  };
}

/** Convert one /v3/odds event payload into canonical quotes + a list of markets we could not map. */
export function parseOddsEvent(raw: unknown, fetchedAt: string): OddsResult {
  const e = OddsEventSchema.parse(raw);
  const event = parseEvent(raw);
  const quotes: OddsQuote[] = [];
  const unmapped: UnmappedMarket[] = [];

  for (const [bookmaker, markets] of Object.entries(e.bookmakers)) {
    for (const m of markets) {
      const rules = ODDS_API_IO_MARKETS[m.name];
      if (!rules) {
        unmapped.push({ bookmaker, providerMarketName: m.name, reason: "no mapping rule", sample: m.odds[0] });
        continue;
      }
      for (const entry of m.odds) {
        const rule = rules.find((r) => (r.requireFields ?? Object.keys(r.fields)).every((f) => entry[f] !== undefined && entry[f] !== null && entry[f] !== ""));
        if (!rule) {
          unmapped.push({ bookmaker, providerMarketName: m.name, reason: "fields do not match any rule", sample: entry });
          continue;
        }
        let line: number | undefined;
        if (rule.lineField) {
          const parsed = num.safeParse(entry[rule.lineField]);
          if (!parsed.success || !Number.isFinite(parsed.data)) {
            unmapped.push({ bookmaker, providerMarketName: m.name, reason: `missing line field ${rule.lineField}`, sample: entry });
            continue;
          }
          line = parsed.data;
          try {
            lineKind(line);
          } catch {
            unmapped.push({ bookmaker, providerMarketName: m.name, reason: `unsupported line ${line}`, sample: entry });
            continue;
          }
        }
        const prices: Record<string, number> = {};
        let bad = false;
        for (const [field, outcome] of Object.entries(rule.fields)) {
          const p = num.safeParse(entry[field]);
          if (!p.success || !Number.isFinite(p.data) || p.data <= 1) {
            bad = true;
            break;
          }
          prices[outcome] = p.data;
        }
        if (bad) {
          unmapped.push({ bookmaker, providerMarketName: m.name, reason: "invalid price value", sample: entry });
          continue;
        }
        const market = toCanonical(rule, line);
        marketKey(market); // validates
        quotes.push({
          provider: PROVIDER,
          providerEventId: event.providerEventId,
          bookmaker,
          providerMarketName: m.name,
          market,
          prices,
          providerUpdatedAt: normaliseTimestamp((entry.updatedAt as string | number | undefined) ?? m.updatedAt),
          fetchedAt,
          settlementVerified: rule.verified,
          origin: "LIVE_PROVIDER",
        });
      }
    }
  }
  return { event, quotes, unmapped };
}
