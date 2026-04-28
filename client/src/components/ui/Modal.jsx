import { X } from 'lucide-react';
export default function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
        className={`relative w-[92%] ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[85vh] overflow-auto bg-white rounded-2xl p-6 shadow-2xl animate-fade-in`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold font-display">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
