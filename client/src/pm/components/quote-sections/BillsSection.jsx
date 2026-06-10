import { Field, TextInput, NumberInput, SectionGrid, SectionHeading } from './_shared';

export default function BillsSection({ spec, update, errors = {}, quote }) {
  const m = spec.bills?.manual_entry || {};
  const setM = (key, val) => update(s => ({
    ...s,
    bills: { ...s.bills, manual_entry: { ...(s.bills?.manual_entry || {}), [key]: val } },
  }));

  // Derived display: effective blended rate (info only).
  const blended = m.annual_kwh > 0 && m.annual_spend > 0
    ? (m.annual_spend / m.annual_kwh).toFixed(3)
    : '—';

  // Source: bill analysis (Path A) or manual entry (Path B).
  // P5 (A4): if there's a linked analysis, point at the in-PM-Tool read-only
  // view. If not, link to the customer-facing upload flow so the rep can ask
  // the customer to upload bills (or do it themselves with the contact_id).
  const linkedAnalysisId = quote?.bill_analysis_id;
  const billAnalyserHref = linkedAnalysisId
    ? `/pm/quotes/${quote.id}/bill-analysis`
    : (quote?.contact_id
        ? `/bill-analysis?contact_id=${quote.contact_id}`
        : '/bill-analysis');
  const linkOpensExternally = !linkedAnalysisId;   // upload flow opens in new tab

  return (
    <div>
      <SectionHeading
        title="Customer's current power bill"
        subtitle="Either pulled from a parsed bill on file, or manually typed in. The Bill Analyser feature lives elsewhere in the portal." />

      {/* Source banner */}
      <div className="mb-5 p-3 rounded-md border text-xs flex items-start justify-between gap-3"
           style={{ borderColor: linkedAnalysisId ? '#a7f3d0' : '#e2e8f0',
                    background:   linkedAnalysisId ? '#ecfdf5' : '#f8fafc' }}>
        <div className="flex-1">
          {linkedAnalysisId ? (
            <>
              <div className="font-semibold text-emerald-800">✓ Source: parsed bill analysis</div>
              <div className="text-emerald-700/80 mt-0.5">
                Linked analysis <code className="font-mono">{String(linkedAnalysisId).slice(0, 8)}…</code>.
                Edits below override the analysis numbers for this quote only — the original analysis stays untouched.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold text-slate-700">Source: manual entry</div>
              <div className="text-slate-500 mt-0.5">
                No parsed bill linked to this quote. Type the numbers in from the customer's bill, or upload a PDF
                via the Bill Analyser to auto-fill next time.
              </div>
            </>
          )}
        </div>
        <a href={billAnalyserHref}
           target={linkOpensExternally ? '_blank' : undefined}
           rel={linkOpensExternally ? 'noopener noreferrer' : undefined}
           className="shrink-0 px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium">
          {linkedAnalysisId ? 'View analysis →' : 'Upload bill →'}
        </a>
      </div>

      <SectionGrid columns={2}>
        <Field label="Retailer" hint="Mercury, Genesis, Contact, Frank, Electric Kiwi …">
          <TextInput value={m.retailer} onChange={v => setM('retailer', v)} placeholder="Mercury" />
        </Field>
        <Field label="Annual usage (kWh)" required error={errors['bills.manual_entry.annual_kwh']}>
          <NumberInput value={m.annual_kwh} onChange={v => setM('annual_kwh', v)} placeholder="12000" />
        </Field>
        <Field label="Annual spend (NZD inc GST)" required error={errors['bills.manual_entry.annual_spend']}>
          <NumberInput value={m.annual_spend} onChange={v => setM('annual_spend', v)} placeholder="3500" />
        </Field>
        <Field label="Effective blended rate"
               hint={`Computed: $${blended} per kWh inc GST. (Annual spend ÷ kWh)`}>
          <input value={blended === '—' ? '—' : `$${blended}/kWh`} readOnly
                 className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-500" />
        </Field>
        <Field label="Variable rate inc GST ($/kWh)"
               hint="From the bill — use to project new bill post-install"
               error={errors['bills.manual_entry.variable_rate_per_kwh_incl_gst']}>
          <NumberInput step="0.001" value={m.variable_rate_per_kwh_incl_gst}
                       onChange={v => setM('variable_rate_per_kwh_incl_gst', v)} placeholder="0.230" />
        </Field>
        <Field label="Daily fixed charge inc GST ($)"
               hint="The fixed line/network charge per day"
               error={errors['bills.manual_entry.daily_fixed_charge_incl_gst']}>
          <NumberInput step="0.01" value={m.daily_fixed_charge_incl_gst}
                       onChange={v => setM('daily_fixed_charge_incl_gst', v)} placeholder="2.50" />
        </Field>
        <Field label="Buyback rate ($/kWh)"
               hint="Current rate the retailer pays for exported solar"
               error={errors['bills.manual_entry.buyback_rate']}>
          <NumberInput step="0.001" value={m.buyback_rate}
                       onChange={v => setM('buyback_rate', v)} placeholder="0.090" />
        </Field>
      </SectionGrid>
    </div>
  );
}
