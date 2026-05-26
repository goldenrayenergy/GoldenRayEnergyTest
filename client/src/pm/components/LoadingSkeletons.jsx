// ────────────────────────────────────────────────────────────────────────────
// LoadingSkeletons — shared loading + error UI for /pm.
//
// Replaces bare "Loading…" text with shape-matched pulsing placeholders so
// the page layout doesn't shift when data arrives. Errors get a friendly
// banner with a Retry button instead of a wall of text.
//
// Exports:
//   <Skeleton />              — primitive pulsing block (override width/height via className)
//   <SkeletonProjectList />   — table shape for /pm/projects
//   <SkeletonOwnerDashboard /> — 7-zone shape for /pm/owner
//   <SkeletonProjectDetail /> — header + lane cards shape for /pm/projects/:id
//   <LoadError error onRetry /> — banner with retry button
// ────────────────────────────────────────────────────────────────────────────

import { RefreshCw, AlertTriangle } from 'lucide-react';

export function Skeleton({ className = '', style }) {
  return <div className={`bg-slate-200/70 rounded animate-pulse ${className}`} style={style} />;
}

// Header pattern used at the top of most pages — title + subtitle
function SkeletonPageHeader() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-3 w-80" />
    </div>
  );
}

// Owner Dashboard skeleton — 7 zones in roughly the real layout
export function SkeletonOwnerDashboard() {
  return (
    <div className="space-y-5 animate-fade-in">
      <SkeletonPageHeader />

      {/* Action Queue (zone 1) — wide */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>

      {/* Pipeline / Cashflow / Fleet (zones 2-4) — 3-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>

      {/* Velocity (zone 5) — wide */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <Skeleton className="h-4 w-36" />
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 flex-1" />
          ))}
        </div>
      </div>

      {/* Capacity / Red Flags (zones 6-7) — 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <Skeleton className="h-4 w-40" />
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Project list skeleton — table with N rows
export function SkeletonProjectList({ rows = 6 }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <SkeletonPageHeader />
      {/* Filter bar skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      {/* Table skeleton */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex gap-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="border-b border-slate-100 px-4 py-3 flex items-center gap-3">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 flex-1 max-w-[200px]" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Project detail skeleton — header + 5 lane cards
export function SkeletonProjectDetail() {
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header — code + customer */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-3 w-96" />
      </div>

      {/* Action buttons row */}
      <div className="flex gap-2 flex-wrap">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* 5 lane cards (sales / engineering / compliance / operations / finance) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full" />
            <div className="space-y-2 pt-1">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-sm" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Friendly error banner with retry — replaces "{error}" walls of text
export function LoadError({ error, onRetry, title = 'Couldn\'t load this view' }) {
  return (
    <div className="bg-white border border-red-200 rounded-lg p-6 max-w-2xl mx-auto text-center animate-fade-in">
      <AlertTriangle size={36} className="text-red-500 mx-auto mb-3" />
      <h3 className="text-base font-bold text-slate-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-600 mb-4 break-words">{error || 'Something went wrong on our side.'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition">
          <RefreshCw size={14} />
          Try again
        </button>
      )}
    </div>
  );
}
