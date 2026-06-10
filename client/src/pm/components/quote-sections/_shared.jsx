// Shared form inputs used by every quote section.
// Controlled inputs only — parent owns the spec object via useState/useReducer.

export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {hint && <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}
      <div className="mt-1">{children}</div>
      {error && <span className="block text-xs text-rose-600 mt-1">{error}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, type = 'text', placeholder, step }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value;
        if (type === 'number') {
          onChange(v === '' ? null : Number(v));
        } else {
          onChange(v);
        }
      }}
      placeholder={placeholder}
      step={step}
      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm
                 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
    />
  );
}

export function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value ?? o.sku} value={o.value ?? o.sku}>{o.label}</option>
      ))}
    </select>
  );
}

export function NumberInput(props) {
  return <TextInput {...props} type="number" />;
}

export function CheckBox({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
      />
      {label}
    </label>
  );
}

export function SectionGrid({ children, columns = 2 }) {
  const cls = columns === 1 ? 'grid grid-cols-1 gap-4'
            : columns === 3 ? 'grid grid-cols-1 sm:grid-cols-3 gap-4'
            : 'grid grid-cols-1 sm:grid-cols-2 gap-4';
  return <div className={cls}>{children}</div>;
}

export function SectionHeading({ title, subtitle }) {
  return (
    <div className="mb-4 pb-3 border-b border-slate-200">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}
