import { Card } from "@/components/ui";

export default function CouponBuilderPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Coupon Builder</h1>
      <Card title="Not built yet (Phase 5)">
        <p className="text-sm leading-relaxed text-muted">
          Combination analysis comes after single-selection performance has been measured. It will calculate combined odds and probability, warn when selections depend on the same match (correlation), and explain why a combination usually carries more bookmaker margin than its individual selections.
        </p>
      </Card>
    </div>
  );
}
