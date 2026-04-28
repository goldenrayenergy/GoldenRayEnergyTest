export default function Card({ title, subtitle, children, action, className = '' }) {
  return (
    <div className={`bg-white dark:bg-brand-dark-1 rounded-xl border border-gray-100 dark:border-white/5 p-5 transition-colors ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between mb-4">
          <div>
            {title && <h3 className="text-sm font-bold font-display text-gray-900 dark:text-gray-100">{title}</h3>}
            {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
