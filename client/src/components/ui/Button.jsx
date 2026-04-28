import clsx from 'clsx';
export default function Button({ children, onClick, variant = 'primary', size = 'md', icon: Icon, disabled, block, className }) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold font-body rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-orange-200/70 hover:shadow-xl hover:shadow-orange-300/70 hover:-translate-y-0.5 animate-gradient dark:shadow-orange-900/40',
    dark: 'bg-gradient-to-r from-gray-900 to-brand-dark text-white hover:from-brand-dark-2 hover:to-brand-dark-3 shadow-md',
    ghost: 'bg-gray-100 text-gray-600 hover:bg-amber-50 dark:bg-brand-dark-2 dark:text-gray-300 dark:hover:bg-brand-dark-3',
    success: 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 shadow-md shadow-emerald-200 dark:shadow-emerald-900/40',
    danger: 'bg-gradient-to-r from-rose-500 to-red-500 text-white hover:from-rose-400 hover:to-red-400 shadow-md shadow-rose-200 dark:shadow-rose-900/40',
    outline: 'border-2 border-gray-200 bg-white text-gray-700 hover:border-amber-400 hover:text-amber-600 dark:bg-brand-dark-1 dark:border-white/10 dark:text-gray-300 dark:hover:border-amber-500/60 dark:hover:text-amber-400',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
  return (
    <button onClick={onClick} disabled={disabled}
      className={clsx(base, variants[variant], sizes[size], block && 'w-full flex', className)}>
      {Icon && <Icon size={size === 'sm' ? 12 : size === 'lg' ? 18 : 15} />}
      {children}
    </button>
  );
}
