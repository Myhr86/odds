import { Card } from "@/components/ui";

export default function MatchAnalyzerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Match Analyzer</h1>
      <Card title="Not built yet (Phase 4)">
        <p className="text-sm leading-relaxed text-muted">
          The statistical model (Poisson, then Dixon–Coles, with walk-forward validation and calibration against the closing market) needs historical results and team data.
          Planned sources: football-data.co.uk (free historical results and closing odds) and API-Football (fixtures, injuries, lineups).
          This page stays empty until the model has been validated, so it never shows invented statistics or predictions.
        </p>
      </Card>
    </div>
  );
}
