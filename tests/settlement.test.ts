import { describe, expect, it } from "vitest";
import { settleSelection } from "@/lib/core/settlement";

const K = {
  mr: "football|MATCH_RESULT|FT_REGULAR|-|-",
  dc: "football|DOUBLE_CHANCE|FT_REGULAR|-|-",
  btts: "football|BTTS|FT_REGULAR|-|-",
  ou: (l: number) => `football|TOTAL_GOALS|FT_REGULAR|${l}|-`,
  ah: (l: number) => `football|ASIAN_HANDICAP|FT_REGULAR|${l}|-`,
  tt: (l: number, t: string) => `football|TEAM_TOTAL|FT_REGULAR|${l}|${t}`,
};

describe("settlement", () => {
  it("1X2 and double chance", () => {
    expect(settleSelection(K.mr, "home", 2, 1)).toBe("win");
    expect(settleSelection(K.mr, "draw", 2, 1)).toBe("loss");
    expect(settleSelection(K.mr, "draw", 1, 1)).toBe("win");
    expect(settleSelection(K.dc, "home_draw", 1, 1)).toBe("win");
    expect(settleSelection(K.dc, "home_away", 1, 1)).toBe("loss");
    expect(settleSelection(K.dc, "draw_away", 0, 2)).toBe("win");
  });
  it("BTTS", () => {
    expect(settleSelection(K.btts, "yes", 1, 1)).toBe("win");
    expect(settleSelection(K.btts, "no", 3, 0)).toBe("win");
  });
  it("totals incl. whole and quarter lines", () => {
    expect(settleSelection(K.ou(2.5), "over", 2, 1)).toBe("win");
    expect(settleSelection(K.ou(2.5), "under", 2, 1)).toBe("loss");
    expect(settleSelection(K.ou(3), "over", 2, 1)).toBe("push");
    expect(settleSelection(K.ou(2.75), "over", 2, 1)).toBe("half_win"); // 2.5 wins, 3 pushes
    expect(settleSelection(K.ou(2.25), "over", 1, 1)).toBe("half_loss"); // 2 pushes, 2.5 loses
    expect(settleSelection(K.ou(2.25), "under", 1, 1)).toBe("half_win");
  });
  it("Asian handicap from the home perspective", () => {
    expect(settleSelection(K.ah(-0.5), "home", 1, 0)).toBe("win");
    expect(settleSelection(K.ah(-1), "home", 1, 0)).toBe("push");
    expect(settleSelection(K.ah(-1), "away", 1, 0)).toBe("push");
    expect(settleSelection(K.ah(-0.25), "home", 1, 1)).toBe("half_loss");
    expect(settleSelection(K.ah(-0.25), "away", 1, 1)).toBe("half_win");
    expect(settleSelection(K.ah(0), "home", 1, 1)).toBe("push"); // draw no bet
    expect(settleSelection(K.ah(-1.75), "home", 3, 1)).toBe("half_win"); // −1.5 wins, −2 pushes
  });
  it("team totals", () => {
    expect(settleSelection(K.tt(1.5, "home"), "over", 2, 0)).toBe("win");
    expect(settleSelection(K.tt(0.5, "away"), "under", 2, 0)).toBe("win");
  });
  it("rejects bad input", () => {
    expect(() => settleSelection(K.mr, "home", -1, 0)).toThrow();
    expect(() => settleSelection(K.mr, "yes", 1, 0)).toThrow();
    expect(() => settleSelection("football|MATCH_RESULT|H1|-|-", "home", 1, 0)).toThrow(/period/);
  });
});
