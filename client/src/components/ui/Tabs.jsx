export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-1 mb-4">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all
            ${active === t.id ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'text-gray-500 hover:text-gray-700'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
