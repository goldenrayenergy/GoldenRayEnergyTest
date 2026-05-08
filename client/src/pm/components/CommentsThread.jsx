import { useState } from 'react';
import { pmCommentsAPI } from '../services/pmApi';
import { fmtDateTime } from '../../utils/format';

// Slack-style internal comments thread. No email relay — purely in-app.
// Mentions are stored as a UUID array; @rendering happens client-side
// (resolution to staff-name lookup is a Phase B concern).

export default function CommentsThread({ projectId, lane, itemKey, comments, currentUserId, onChange }) {
  const [body, setBody]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  // Threaded structure: top-level comments first, replies nested
  const topLevel = (comments || []).filter(c => !c.parent_id);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await pmCommentsAPI.create(projectId, { lane, item_key: itemKey, body: body.trim() });
      setBody('');
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this comment?')) return;
    try {
      await pmCommentsAPI.remove(projectId, id);
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
        Discussion <span className="text-slate-400 font-normal">· internal only</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-2 py-1 rounded mb-2 text-xs">
          {error}
        </div>
      )}

      <div className="space-y-2 mb-3 max-h-80 overflow-y-auto">
        {topLevel.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No comments yet. Start a thread for your team.</p>
        ) : (
          topLevel.map(c => (
            <div key={c.id} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  {c.author_user_id?.slice(0, 8) || 'unknown'}
                </span>
                <span className="text-[10px] text-slate-400">{fmtDateTime(c.created_at)}</span>
              </div>
              <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap break-words">{c.body}</p>
              {c.author_user_id === currentUserId && (
                <button
                  onClick={() => remove(c.id)}
                  className="text-[10px] text-red-600 hover:underline mt-1">
                  delete
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
          }}
          placeholder="Add a comment for the team… (Cmd/Ctrl+Enter to post)"
          className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-sm"
        />
        <button
          onClick={post}
          disabled={busy || !body.trim()}
          className="px-3 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs rounded font-medium self-end">
          {busy ? '…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
