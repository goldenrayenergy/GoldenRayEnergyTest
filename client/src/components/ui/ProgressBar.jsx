export default function ProgressBar({ value, max = 100, color = '#f59e0b', height = 6 }) {
  const pct = max ? Math.min(Math.round((value / max) * 100), 100) : 0;
  return (
    <div className="rounded-full overflow-hidden bg-gray-100" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
