export default function DataTable({ columns, data, onRowClick }) {
  return (
    <div className="bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 dark:border-white/5">
            {columns.map((col, i) => (
              <th key={i} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, ri) => (
            <tr key={ri} onClick={() => onRowClick?.(row)}
              className={`border-b border-gray-50 dark:border-white/5 transition-colors ${onRowClick ? 'cursor-pointer hover:bg-gray-50/80 dark:hover:bg-white/5' : ''}`}>
              {columns.map((col, ci) => (
                <td key={ci} className="px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200">{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">No data found</div>}
    </div>
  );
}
