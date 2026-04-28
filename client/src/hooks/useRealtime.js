import { useEffect } from 'react';
import supabase from '../services/supabase';

// ── Subscribe to Supabase Realtime changes on any table ──
// Usage: useRealtime('deals', (payload) => { refetchDeals(); });

export default function useRealtime(table, callback, event = '*') {
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel(`${table}-changes`)
      .on('postgres_changes', { event, schema: 'public', table }, (payload) => {
        console.log(`[Realtime] ${table}:`, payload.eventType, payload.new);
        callback(payload);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [table, event]);
}
