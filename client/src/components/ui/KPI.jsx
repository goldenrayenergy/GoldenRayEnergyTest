export default function KPI({ icon: Icon, label, value, sub, accent = '#f59e0b', trend }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accent + '12' }}>
            <Icon size={15} color={accent} />
          </div>
          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{label}</span>
        </div>
        {trend != null && (
          <span className={`text-xs font-semibold ${trend > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {trend > 0 ? '↑' : '↓'}{Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold font-display text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
