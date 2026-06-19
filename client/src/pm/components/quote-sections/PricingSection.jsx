import { Field, TextInput, NumberInput, Select, SectionGrid, SectionHeading, CheckBox } from './_shared';
import { REFERENCE } from '../../services/pmQuotesApi';
import { discountHint } from '../../utils/fieldHints';

// ────────────────────────────────────────────────────────────────────────────
// PricingSection (Phase E — unified discount UX)
//
// One panel for "what the customer pays" with two modes:
//
//   AUTO (default): customer_price_inc_gst = null. The price tracks the live
//                   engine list price. Rep enters a discount in NZD, engine
//                   subtracts → customer total auto-updates.
//
//   LOCKED:         rep types a fixed customer price. The implicit discount
//                   (list − locked_price) is auto-synced into the discount
//                   audit log so reps can't accidentally bypass the reason +
//                   approval workflow.
//
// In both modes: discount > 0 requires a reason text AND owner_approved.
// configValidator enforces those as hard gates; UI surfaces them inline.
// ────────────────────────────────────────────────────────────────────────────

export default function PricingSection({ spec, update, errors = {}, engineSnapshot, costSnapshot = null, discountAllowed = true }) {
  const p = spec.pricing || {};
  const d = p.discount || { applied_nzd: 0 };
  const setP = (key, val) => update(s => ({ ...s, pricing: { ...s.pricing, [key]: val } }));
  const setD = (key, val) => update(s => ({
    ...s,
    pricing: { ...s.pricing, discount: { ...(s.pricing?.discount || {}), [key]: val } },
  }));
  // Atomic two-field updater for syncing customer_price + discount.applied_nzd
  // together when locking below list (avoid race between two setP calls).
  const setPricing = (patch) => update(s => ({
    ...s,
    pricing: {
      ...s.pricing,
      ...patch,
      discount: patch.discount !== undefined
        ? { ...(s.pricing?.discount || {}), ...patch.discount }
        : (s.pricing?.discount || {}),
    },
  }));

  const cost = costSnapshot
            || engineSnapshot?.engine?.cost
            || null;
  const totals = cost?.totals || {};
  const enginePrice = totals.total_list_inc_gst;          // engine's live list price
  const liveCustomerTotal = totals.customer_total_inc_gst; // what customer pays
  const computedDiscount = totals.discount_applied_inc_gst || 0;
  const margin = totals.project_margin_pct;
  const status = cost?.margin_floor_status
              || engineSnapshot?.engine?.margin_floor_status
              || engineSnapshot?.margin_floor_status;

  // Mode flag
  const isLocked = p.customer_price_inc_gst != null;

  // Margin floor status styling
  const statusColor = status === 'healthy' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : status === 'amber'   ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : status === 'below_floor' ? 'text-rose-700 bg-rose-50 border-rose-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200';

  // ── Lock / unlock / auto-sync applied_nzd in lock mode ──────────────────
  function lockAtEnginePrice() {
    if (enginePrice == null) return;
    // Lock at full list with NO discount
    setPricing({ customer_price_inc_gst: Math.round(enginePrice),
                 discount: { applied_nzd: 0 } });
  }
  function unlock() {
    setPricing({ customer_price_inc_gst: null });
  }
  // When user edits the locked customer price, also auto-update applied_nzd so
  // audit log always matches the actual gap.
  function setLockedPrice(v) {
    const newPrice = Number(v) || 0;
    const newDiscount = enginePrice != null && newPrice > 0
      ? Math.max(0, Math.round(enginePrice - newPrice))
      : 0;
    setPricing({
      customer_price_inc_gst: v,
      discount: { applied_nzd: newDiscount },
    });
  }

  // In AUTO mode, user enters discount → just update applied_nzd; engine will
  // subtract on next preview pass.
  function setAutoDiscount(v) {
    setD('applied_nzd', Number(v) || 0);
  }

  const discountVal = isLocked
    ? (computedDiscount || d.applied_nzd || 0)   // derived; show what engine computed
    : (d.applied_nzd || 0);                       // user input

  const needsApproval = computedDiscount > 1 && !d.owner_approved;
  const needsReason = computedDiscount > 1 && !(d.reason || '').trim();

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Pricing"
        subtitle="Customer-facing price + any discount you're giving. Owner approves discounts; engine checks the math." />

      {/* ── Unified pricing panel ──────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
        {/* Header: list price + mode toggle */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Engine list price
            </div>
            <div className="text-lg font-bold text-slate-900">
              {enginePrice != null
                ? `$${Math.round(enginePrice).toLocaleString('en-NZ')} `
                : '$— '}
              <span className="text-xs font-normal text-slate-500">inc GST</span>
            </div>
          </div>
          {isLocked ? (
            <button type="button"
                    onClick={unlock}
                    title="Clear the lock and let the price track the engine."
                    className="px-2.5 py-1.5 text-xs font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              🔓 Unlock — back to auto
            </button>
          ) : (
            enginePrice != null && (
              <button type="button"
                      onClick={lockAtEnginePrice}
                      title="Lock the price at this engine list value. Useful when you quoted a fixed number verbally."
                      className="px-2.5 py-1.5 text-xs font-semibold rounded border border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100">
                🔒 Lock at this price
              </button>
            )
          )}
        </div>

        {/* Body: discount + final price */}
        <div className="p-4 space-y-3">
          {isLocked ? (
            <Field label="Locked customer price (inc GST)"
                   error={errors['pricing.customer_price_inc_gst']}>
              <NumberInput
                value={p.customer_price_inc_gst}
                onChange={setLockedPrice}
                placeholder="28500" />
              <div className="text-[11px] text-sky-700 mt-1">
                🔒 You've fixed the price. The implicit discount is auto-recorded below.
              </div>
            </Field>
          ) : null}

          {!discountAllowed ? (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-2">
              Discounts apply to the <b>recommended tier</b> only. Switch to the recommended tier
              (★) to enter a discount.
            </div>
          ) : (
            <>
              <Field label={isLocked ? 'Implicit discount (auto-derived)' : 'Discount to apply (inc GST)'}
                     hint={discountHint(cost)}>
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={discountVal}
                    onChange={isLocked ? () => {} : setAutoDiscount}
                    disabled={isLocked}
                    placeholder="0" />
                  {isLocked && (
                    <span className="text-[11px] text-slate-500 italic">
                      derived from list − locked price
                    </span>
                  )}
                </div>
              </Field>

              <Field label="Reason" error={errors['pricing.discount.reason']}
                     hint={discountVal > 0 ? 'Required when any discount is applied.' : ''}>
                <TextInput value={d.reason || ''}
                           onChange={v => setD('reason', v)}
                           placeholder="Repeat customer / referral / package deal …" />
              </Field>

              <div className="flex items-center gap-3 flex-wrap">
                <CheckBox checked={d.owner_approved === true}
                          onChange={v => setD('owner_approved', v)}
                          label="Owner has approved this discount" />
                <span className="text-xs text-slate-500">
                  Admin role only — discounts won't ship without this ticked.
                </span>
              </div>
            </>
          )}

          {/* Inline validation hints */}
          {discountAllowed && needsApproval && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
              ⚠ Discount of ${Math.round(computedDiscount).toLocaleString()} applied — needs owner approval before this quote can ship.
              <div className="mt-1 text-rose-800 font-medium">
                Save this spec, then click <b>“Send for owner approval”</b> on the quote detail page.
              </div>
            </div>
          )}
          {discountAllowed && needsReason && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
              ⚠ Reason text is required when a discount is applied.
            </div>
          )}

          {/* Final price + margin */}
          <div className="mt-2 pt-3 border-t border-slate-200 grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Customer pays
              </div>
              <div className="text-xl font-bold text-slate-900">
                {liveCustomerTotal != null
                  ? `$${Math.round(liveCustomerTotal).toLocaleString('en-NZ')}`
                  : '$—'}
                <span className="text-xs font-normal text-slate-500 ml-1">inc GST</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Project margin
              </div>
              <div className={`inline-block px-2 py-0.5 rounded border text-sm font-semibold ${statusColor}`}>
                {margin != null ? `${margin.toFixed(1)}%` : '—'}
                <span className="ml-1 uppercase tracking-wide text-[10px]">{status || ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quote stage + final mode ─────────────────────────────────── */}
      <SectionGrid columns={2}>
        <Field label="Quote stage" required>
          <Select value={p.stage} onChange={v => setP('stage', v)} options={REFERENCE.stages} />
        </Field>
        <div className="flex flex-col gap-2 pt-5">
          <CheckBox checked={p.final_mode}
                    onChange={v => setP('final_mode', v)}
                    label="Hide discount line on customer PDF (final mode)" />
          <span className="text-[11px] text-slate-500">
            ON: customer PDF shows only the final price.{' '}
            OFF: customer PDF shows list + discount + final.
          </span>
        </div>
      </SectionGrid>
    </div>
  );
}
