import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export default function ThemeToggle({ className = '', size = 14 }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors
        ${isDark
          ? 'bg-brand-dark-2 border-white/10 text-amber-400 hover:bg-brand-dark-3 hover:text-amber-300'
          : 'bg-white border-gray-200 text-gray-500 hover:bg-amber-50 hover:text-amber-500 hover:border-amber-200'}
        ${className}`}
    >
      {isDark ? <Sun size={size} /> : <Moon size={size} />}
    </button>
  );
}
