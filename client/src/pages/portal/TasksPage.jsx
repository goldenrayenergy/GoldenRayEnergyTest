import { useState, useEffect } from 'react';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { NewTaskModal, confirmDelete } from '../../components/portal/CreateModals';
import { fmtDate } from '../../utils/format';
import { CheckCircle, AlertCircle, Clock, Check, Plus, Pencil, Trash2 } from 'lucide-react';

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);

  useEffect(() => { api.get('/tasks').then(r => setTasks(r.data)).finally(() => setLoading(false)); }, []);

  const complete = async (id) => {
    await api.patch(`/tasks/${id}`, { status: 'completed' });
    setTasks(p => p.map(t => t.id === id ? { ...t, status: 'completed' } : t));
  };

  const handleSaved = (t) => setTasks(p => p.map(x => x.id === t.id ? { ...x, ...t } : x));
  const handleDelete = async (t) => {
    if (await confirmDelete({ url: '/tasks', id: t.id, label: `task "${t.title}"` })) {
      setTasks(p => p.filter(x => x.id !== t.id));
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold font-display">Tasks</h2>
          <p className="text-[11px] text-gray-400">Assign follow-ups, calls, and site visits to your team.</p>
        </div>
        <Button icon={Plus} onClick={() => setNewOpen(true)}>New Task</Button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <KPI icon={CheckCircle} label="Total" value={tasks.length} accent="#6366f1" />
        <KPI icon={AlertCircle} label="Overdue" value={tasks.filter(t => t.status === 'overdue').length} accent="#ef4444" />
        <KPI icon={Clock} label="In progress" value={tasks.filter(t => t.status === 'in_progress').length} accent="#f59e0b" />
        <KPI icon={Check} label="Completed" value={tasks.filter(t => t.status === 'completed').length} accent="#10b981" />
      </div>
      <DataTable columns={[
        { label: 'Task', render: r => <div><div className="text-xs font-semibold">{r.title}</div><div className="text-[9px] text-gray-400">{r.task_type}</div></div> },
        { label: 'Assignee', render: r => <span className="text-xs">{r.assignee_name?.split(' ')[0] || '—'}</span> },
        { label: 'Due', render: r => { const od = new Date(r.due_date) < new Date() && r.status !== 'completed'; return <span className={`text-xs ${od ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>{fmtDate(r.due_date)}</span>; } },
        { label: 'Priority', render: r => <Badge color={r.priority === 'high' ? '#ef4444' : r.priority === 'medium' ? '#f59e0b' : '#10b981'}>{r.priority}</Badge> },
        { label: 'Status', render: r => <Badge color={r.status === 'completed' ? '#10b981' : r.status === 'overdue' ? '#ef4444' : '#6366f1'}>{r.status?.replace('_', ' ')}</Badge> },
        { label: 'Actions', render: r => (
          <div className="flex gap-1 items-center">
            {r.status !== 'completed' && <button onClick={() => complete(r.id)} className="bg-emerald-50 text-emerald-600 rounded px-2 py-0.5 text-[9px] font-semibold hover:bg-emerald-100">Done</button>}
            <button onClick={() => setEditTask(r)} title="Edit" className="w-6 h-6 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center"><Pencil size={11} /></button>
            <button onClick={() => handleDelete(r)} title="Delete" className="w-6 h-6 rounded bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center"><Trash2 size={11} /></button>
          </div>
        ) },
      ]} data={tasks} />

      <NewTaskModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={t => setTasks(p => [t, ...p])} />
      <NewTaskModal open={!!editTask} onClose={() => setEditTask(null)} initial={editTask} onSaved={handleSaved} />
    </div>
  );
}
