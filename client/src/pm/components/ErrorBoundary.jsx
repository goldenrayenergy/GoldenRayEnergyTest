// ────────────────────────────────────────────────────────────────────────────
// ErrorBoundary — the last line of the global safety net.
//
// Catches any render-time crash in the tree below it and shows the FALLBACK
// ErrorCard ("Something went wrong — your work is safe — Report it") instead of
// a white screen. So no raw error / blank page ever reaches a rep, even for
// problems the catalogue doesn't know about yet.
// ────────────────────────────────────────────────────────────────────────────
import { Component } from 'react';
import ErrorCard from './ErrorCard';
import { FALLBACK } from '../utils/errorCatalogue';
import { reportEntry } from '../utils/reportError';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render crash:', error, info?.componentStack);
  }

  handleReport = () => {
    const screen = typeof window !== 'undefined' ? window.location?.pathname : null;
    reportEntry({ ...FALLBACK, code: 'render_crash' }, {
      screen,
      detail: this.state.error?.stack || this.state.error?.message || null,
      // Group by route so distinct crash sites stay distinct.
      fingerprint: `render_crash:${screen || 'unknown'}`,
    });
  };

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 max-w-xl mx-auto">
          <ul className="space-y-2">
            <ErrorCard
              entry={{ ...FALLBACK, code: 'render_crash' }}
              detail={this.state.error?.stack || this.state.error?.message}
              onReport={this.handleReport}
            />
          </ul>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-3 px-3 py-1.5 text-xs font-medium rounded bg-slate-800 text-white hover:bg-slate-700">
            Reload the page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
