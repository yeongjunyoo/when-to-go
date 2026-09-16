import type { RejectionDashboard } from "./rejectionDashboard";

export default function RejectionDashboardBox({ dashboard }: { dashboard: RejectionDashboard }) {
  return (
    <section aria-label="미연결률 계기판" className="mb-6">
      <div
        role="status"
        className={`rounded-lg border p-3 text-xs ${dashboard.warn ? "border-danger-border bg-danger-bg text-danger-fg" : "border-default bg-surface text-text-muted"}`}
      >
        <p className="font-semibold">
          위치 미연결률: {dashboard.unlinkedRatePercent.toFixed(1)}% ({dashboard.unlinkedCount}/{dashboard.total})
          {dashboard.warn && " — 임계 25% 초과"}
        </p>
        <p className="mt-1">
          후보 0개 {dashboard.zero} · 복수 후보 {dashboard.multiple} · 주소 불일치 {dashboard.addressMismatch} · 연결 성공 {dashboard.singleMatch}
        </p>
      </div>
    </section>
  );
}
