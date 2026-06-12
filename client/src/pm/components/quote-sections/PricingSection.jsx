import { Field, TextInput, NumberInput, Select, SectionGrid, SectionHeading, CheckBox } from './_shared';
import { REFERENCE } from '../../services/pmQuotesApi';
import { customerPriceHint, discountHint } from '../../utils/fieldHints';

export default function PricingSection({ spec, update, errors = {}, engineSnapshot, costSnapshot = null }) {
  const p = spec.pricing || {};
  const d = p.discount || { applied_nzd: 0 };
  const setP = (key, val) => update(s => ({ ...s, pricing: { ...s.pricing, [key]: val } }));
  const setD = (key, val) => update(s => ({
    ...s,
    pricing: { ...s.pricing, discount: { ...(s.pricing?.discount || {}), [key]: val } },
  }));

  // Cost snapshot is the active tier's cost block (multi-tier) or root cost
  // (single-tier) — pre-resolved by QuoteFormPage so this component doesn't
  // need to know about tier mode. Falls back to the older engineSnapshot path
  // only if QuoteFormPage hasn't been upgraded to pass costSnapshot yet.
  const cost = costSnapshot
            || engineSnapshot?.engine?.cost
            || null;
  const margin = cost?.totals?.project_margin_pct;
  const status = cost?.margin_floor_status
              || engineSnapshot?.engine?.margin_floor_status
              || engineSnapshot?.margin_floor_status;
  const statusColor = status === 'healthy' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                    : status === 'amber'   ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : status === 'below_floor' ? 'text-rose-700 bg-rose-50 border-rose-200'
                    : 'text-slate-500 bg-slate-50 border-slate-200';

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Pricing & stage"
        subtitle="Customer-facing price + quote stage. Discount intake here — owner approves separately if margin drops below 10%." />

      <SectionGrid columns={2}>
        <Field label="Customer price inc GST (NZD)" required
               hint={customerPriceHint(cost)}
               error={errors['pricing.customer_price_inc_gst']}>
          <NumberInput value={p.customer_price_inc_gst}
                       onChange={v => setP('customer_price_inc_gst', v)} placeholder="45000" />
        </Field>
        <Field label="Quote stage" required>
          <Select value={p.stage} onChange={v => setP('stage', v)} options={REFERENCE.stages} />
        </Field>
      </SectionGrid>

      <div className="flex items-center gap-3">
        <CheckBox checked={p.final_mode}
                  onChange={v => setP('final_mode', v)}
                  label="Final mode" />
        <span className="text-xs text-slate-500">
          When ON, customer PDF hides any applied discount line item. Stage-1 estimates typically OFF.
        </span>
      </div>

      {/* Live margin status (filled when caller passes engineSnapshot/costSnapshot) */}
      {margin != null && (
        <div className={`p-3 border rounded-md text-sm ${statusColor}`}>
          <b>Project margin: {margin.toFixed(1)}%</b> · Floor status:{' '}
          <b className="uppercase tracking-wide">{status}</b>
          {status === 'below_floor' && (
            <span className="ml-1">— owner approval required to ship at this price.</span>
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Discount intake</h3>
        <p className="text-xs text-slate-500 mb-3">
          Record the discount you've offered the customer here. Approval goes through the discount workflow
          (admin-only) — until approved, the spec engine won't accept a non-zero applied amount.
        </p>
        <SectionGrid columns={2}>
          <Field label="Discount applied (NZD inc GST)"
                 hint={discountHint(cost)}>
            <NumberInput value={d.applied_nzd} onChange={v => setD('applied_nzd', v)} placeholder="0" />
          </Field>
          <Field label="Reason" hint="Required if discount > 0">
            <TextInput value={d.reason} onChange={v => setD('reason', v)} placeholder="Repeat customer / referral …" />
          </Field>
        </SectionGrid>
        <div className="mt-3 flex items-center gap-3">
          <CheckBox checked={d.owner_approved}
                    onChange={v => setD('owner_approved', v)}
                    label="Owner has approved this discount" />
          <span className="text-xs text-slate-500">
            Admin role only — flag becomes locked-true after admin runs the approve endpoint.
          </span>
        </div>
      </div>
    </div>
  );
}
