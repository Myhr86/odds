const osloDateTime = new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const osloTime = new Intl.DateTimeFormat("nb-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** All storage is UTC; display is Norwegian local time. */
export const fmtOslo = (iso: string | Date) => osloDateTime.format(new Date(iso));
export const fmtOsloTime = (iso: string | Date) => osloTime.format(new Date(iso));
export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
export const odds = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x.toFixed(2));

const OUTCOME_LABEL: Record<string, string> = {
  home: "H (home)", draw: "U (draw)", away: "B (away)", over: "Over", under: "Under", yes: "Yes", no: "No",
  home_draw: "1X", home_away: "12", draw_away: "X2",
};
export const outcomeLabel = (o: string) => OUTCOME_LABEL[o] ?? o;

export function marketLabel(key: string): string {
  const [, type, period, line, team] = key.split("|");
  const p = period === "H1" ? " 1st half" : "";
  switch (type) {
    case "MATCH_RESULT": return `1X2 (HUB)${p}`;
    case "DOUBLE_CHANCE": return `Double chance${p}`;
    case "TOTAL_GOALS": return `Goals O/U ${line}${p}`;
    case "BTTS": return `Both teams to score${p}`;
    case "ASIAN_HANDICAP": return line === "0" ? `Draw no bet${p}` : `Asian handicap ${line}${p}`;
    case "TEAM_TOTAL": return `${team} goals O/U ${line}${p}`;
    default: return key;
  }
}
