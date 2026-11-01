import { parseMarketKey } from "../markets/types";
import type { BetOutcome } from "./stats";

/**
 * Settle a selection from the final score (90 minutes + stoppage time for FT_REGULAR).
 * Asian lines: whole lines can push; quarter lines split the stake over the two neighbouring
 * half/whole lines (e.g. −0.25 = half on 0, half on −0.5).
 */
export function settleSelection(marketKeyStr: string, outcome: string, homeGoals: number, awayGoals: number): BetOutcome {
  if (![homeGoals, awayGoals].every((g) => Number.isInteger(g) && g >= 0)) throw new RangeError("Scores must be non-negative integers");
  const m = parseMarketKey(marketKeyStr);
  if (m.period !== "FT_REGULAR") throw new Error(`Settlement for period ${m.period} needs period scores (not supported yet)`);
  const h = homeGoals;
  const a = awayGoals;
  const winLose = (cond: boolean): BetOutcome => (cond ? "win" : "loss");

  switch (m.type) {
    case "MATCH_RESULT":
      return winLose(outcome === "home" ? h > a : outcome === "away" ? a > h : outcome === "draw" ? h === a : bad(outcome));
    case "DOUBLE_CHANCE":
      return winLose(outcome === "home_draw" ? h >= a : outcome === "draw_away" ? a >= h : outcome === "home_away" ? h !== a : bad(outcome));
    case "BTTS":
      return winLose(outcome === "yes" ? h > 0 && a > 0 : outcome === "no" ? !(h > 0 && a > 0) : bad(outcome));
    case "TOTAL_GOALS":
    case "TEAM_TOTAL": {
      const goals = m.type === "TOTAL_GOALS" ? h + a : m.team === "home" ? h : a;
      if (outcome !== "over" && outcome !== "under") bad(outcome);
      return outcome === "over" ? asian(goals, -m.line!) : asian(-goals, m.line!);
    }
    case "ASIAN_HANDICAP": {
      // line is from the home perspective; away gets −line.
      if (outcome !== "home" && outcome !== "away") bad(outcome);
      const margin = outcome === "home" ? h - a : a - h;
      const line = outcome === "home" ? m.line! : -m.line!;
      return asian(margin, line);
    }
  }
}

/** Generic Asian settlement of `margin + line` with quarter-line splitting. */
function asian(margin: number, line: number): BetOutcome {
  const frac = Math.round(Math.abs(line * 100)) % 50;
  if (frac === 25) {
    const a = single(margin + line - 0.25);
    const b = single(margin + line + 0.25);
    return combine(a, b);
  }
  return single(margin + line);
}

function single(x: number): "win" | "push" | "loss" {
  const r = Math.round(x * 100) / 100;
  return r > 0 ? "win" : r < 0 ? "loss" : "push";
}

function combine(a: "win" | "push" | "loss", b: "win" | "push" | "loss"): BetOutcome {
  if (a === b) return a;
  const s = new Set([a, b]);
  if (s.has("win") && s.has("push")) return "half_win";
  if (s.has("loss") && s.has("push")) return "half_loss";
  throw new Error("Impossible quarter-line combination"); // win+loss cannot happen with 0.5 apart
}

function bad(outcome: string): never {
  throw new Error(`Unknown outcome ${outcome}`);
}
