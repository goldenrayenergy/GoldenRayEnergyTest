import clsx from 'clsx';
export default function Badge({ children, color = '#6366f1', className }) {
  return (
    <span className={clsx('inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', className)}
      style={{ background: color + '12', color }}>{children}</span>
  );
}
