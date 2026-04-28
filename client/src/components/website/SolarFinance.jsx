import { useState, useMemo } from 'react';
import axios from 'axios';
import {
  Wallet, Sprout, CreditCard, Banknote, CheckCircle2, Loader2, Send, ShieldCheck, Clock, Percent,
} from 'lucide-react';

const PRODUCTS = [
  {
    id: 'green_loan',
    name: 'Bank Green Loan',
    tag: '$0 upfront · 1% p.a.',
    rate: 1.0,
    maxTerm: 5,
    maxAmount: 80000,
    icon: Sprout,
    gradient: 'from-emerald-500 via-teal-500 to-green-500',
    desc: 'Westpac, ANZ & Kiwibank offer low-rate "green" top-ups for solar. Cheapest option for mortgage holders.',
    perks: ['1% fixed for up to 5 yrs', 'No early-repayment fees', 'Up to $80,000'],
  },
  {
    id: 'interest_free',
    name: 'Interest-Free',
    tag: '0% for 36 months',
    rate: 0,
    maxTerm: 3,
    maxAmount: 30000,
    icon: Percent,
    gradient: 'from-amber-500 via-orange-500 to-pink-500',
    desc: 'Pay zero interest for three years on residential solar systems up to $30K. A practical option for homeowners without an existing mortgage facility.',
    perks: ['0% interest for 3 yrs', 'Instant online approval', 'From $99/month'],
  },
  {
    id: 'payment_plan',
    name: 'Payment Plan',
    tag: 'From $45/week',
    rate: 6.95,
    maxTerm: 10,
    maxAmount: 50000,
    icon: CreditCard,
    gradient: 'from-fuchsia-500 via-violet-500 to-indigo-500',
    desc: 'Fixed weekly or fortnightly installments over 3–10 years. No home ownership required, unsecured.',
    perks: ['No deposit required', 'Up to 10 yr term', 'Fast online credit check'],
  },
  {
    id: 'bank_topup',
    name: 'Home Loan Top-Up',
    tag: 'Lowest rate option',
    rate: 6.5,
    maxTerm: 25,
    maxAmount: 100000,
    icon: Banknote,
    gradient: 'from-sky-500 via-blue-500 to-indigo-500',
    desc: 'Add your solar cost to your mortgage at your current home-loan rate. Longest term, lowest monthly cost.',
    perks: ['Lowest effective rate', 'Up to 25 yr term', 'Single monthly payment'],
  },
];

const INCOME_BANDS = [
  { value: 'under_3k',  label: 'Under $3,000/mo' },
  { value: '3k_5k',     label: '$3,000 – $5,000/mo' },
  { value: '5k_8k',     label: '$5,000 – $8,000/mo' },
  { value: '8k_12k',    label: '$8,000 – $12,000/mo' },
  { value: 'over_12k',  label: 'Over $12,000/mo' },
];

// Simple amortization — monthly payment for principal P, annual rate r, n years
const monthly = (P, r, years) => {
  if (!P || years <= 0) return 0;
  const n = years * 12;
  if (r === 0) return P / n;
  const i = (r / 100) / 12;
  return (P * i) / (1 - Math.pow(1 + i, -n));
};

export default function SolarFinance() {
  const [selected, setSelected] = useState('green_loan');
  const [amount, setAmount] = useState(15000);
  const [term, setTerm] = useState(5);

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', address: '',
    homeOwnership: '', monthlyIncomeBand: '', employmentType: '', existingBank: '',
    creditConsent: false, notes: '',
  });
  const [state, setState] = useState({ loading: false, done: false, error: '', id: '' });

  const product = PRODUCTS.find(p => p.id === selected);
  const cappedAmount = Math.min(Math.max(1000, Number(amount) || 0), product.maxAmount);
  const cappedTerm = Math.min(Math.max(1, Number(term) || 1), product.maxTerm);

  const monthlyPmt = useMemo(() => monthly(cappedAmount, product.rate, cappedTerm), [cappedAmount, cappedTerm, product]);
  const totalPaid = monthlyPmt * cappedTerm * 12;
  const totalInterest = Math.max(0, totalPaid - cappedAmount);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true, done: false, error: '', id: '' });
    try {
      const payload = {
        ...form,
        product: selected,
        loanAmount: cappedAmount,
        termYears: cappedTerm,
        estimatedMonthly: Math.round(monthlyPmt * 100) / 100,
      };
      const { data } = await axios.post('/api/finance/apply', payload);
      setState({ loading: false, done: true, error: '', id: data.id });
    } catch (err) {
      setState({ loading: false, done: false, error: err.response?.data?.error || 'Submission failed. Please try again.', id: '' });
    }
  };

  return (
    <section id="finance" className="py-24 px-6 md:px-16 bg-gradient-to-br from-emerald-50 via-white to-amber-50 relative overflow-hidden">
      <div className="absolute -top-20 right-0 w-96 h-96 rounded-full bg-gradient-to-br from-emerald-300 to-teal-400 opacity-20 blur-3xl animate-blob" />
      <div className="absolute bottom-0 -left-20 w-96 h-96 rounded-full bg-gradient-to-br from-amber-300 to-pink-400 opacity-20 blur-3xl animate-blob-delay-2" />

      <div className="text-center mb-12 relative">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/15 via-amber-500/15 to-pink-500/15 border border-emerald-200 mb-4 backdrop-blur">
          <Sprout size={13} className="text-emerald-500" />
          <span className="text-xs font-extrabold text-gradient-cool">$0 UPFRONT · NZ SOLAR FINANCE</span>
        </div>
        <h2 className="text-4xl font-extrabold font-display">
          Go Solar with <span className="text-gradient-warm">Zero Upfront Cost</span>
        </h2>
        <p className="text-sm text-gray-500 mt-3 max-w-2xl mx-auto leading-relaxed">
          Choose the finance option that suits you — from bank green-loan top-ups at <b>1% p.a.</b> through to interest-free payment plans.
          For most households, the monthly bill savings cover the repayment from day one.
        </p>
      </div>

      {/* ── Product cards ── */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-4 mb-10 relative">
        {PRODUCTS.map(p => {
          const active = selected === p.id;
          const Icon = p.icon;
          return (
            <button key={p.id} onClick={() => { setSelected(p.id); setTerm(Math.min(term, p.maxTerm)); setAmount(Math.min(amount, p.maxAmount)); }}
              className={`text-left bg-white rounded-2xl border-2 overflow-hidden transition-all duration-300
                ${active ? 'border-transparent ring-4 ring-amber-200/50 shadow-xl -translate-y-1' : 'border-gray-100 hover:border-gray-200 hover:-translate-y-0.5 hover:shadow-md'}`}>
              <div className={`h-20 flex items-center justify-between px-4 bg-gradient-to-br ${p.gradient} text-white`}>
                <Icon size={28} className="drop-shadow" />
                {active && <CheckCircle2 size={18} className="text-white" />}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <h4 className="text-sm font-bold font-display">{p.name}</h4>
                </div>
                <p className={`text-[11px] font-bold mb-2 bg-gradient-to-r ${p.gradient} bg-clip-text text-transparent`}>{p.tag}</p>
                <p className="text-[11px] text-gray-500 leading-relaxed mb-3">{p.desc}</p>
                <ul className="space-y-1">
                  {p.perks.map(perk => (
                    <li key={perk} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                      <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" /> {perk}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Calculator + Application ── */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-6 relative">
        {/* LEFT — loan calculator */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <h3 className="text-sm font-bold font-display mb-4 flex items-center gap-2">
              <Wallet size={14} className="text-amber-500" /> Repayment Estimate
            </h3>

            <div className="mb-4">
              <div className="flex justify-between text-[10px] font-semibold text-gray-500 uppercase mb-1">
                <span>Amount to finance</span>
                <span className="text-amber-600 font-extrabold">${cappedAmount.toLocaleString()}</span>
              </div>
              <input type="range" min={1000} max={product.maxAmount} step={500} value={cappedAmount}
                onChange={e => setAmount(Number(e.target.value))}
                className="w-full accent-amber-500" />
              <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                <span>$1,000</span><span>${product.maxAmount.toLocaleString()}</span>
              </div>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-[10px] font-semibold text-gray-500 uppercase mb-1">
                <span>Loan term</span>
                <span className="text-amber-600 font-extrabold">{cappedTerm} {cappedTerm === 1 ? 'year' : 'years'}</span>
              </div>
              <input type="range" min={1} max={product.maxTerm} step={1} value={cappedTerm}
                onChange={e => setTerm(Number(e.target.value))}
                className="w-full accent-amber-500" />
              <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                <span>1 yr</span><span>{product.maxTerm} yrs</span>
              </div>
            </div>

            <div className={`rounded-xl p-4 mb-3 bg-gradient-to-br ${product.gradient} text-white shadow-md`}>
              <div className="text-[10px] font-semibold uppercase opacity-80">Estimated monthly</div>
              <div className="text-3xl font-extrabold font-display leading-tight">
                ${monthlyPmt.toLocaleString('en-NZ', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[10px] opacity-85 mt-1">
                at {product.rate}% p.a. · {product.name}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-400 uppercase font-semibold">Total paid</div>
                <div className="text-sm font-extrabold">${totalPaid.toLocaleString('en-NZ', { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-400 uppercase font-semibold">Total interest</div>
                <div className="text-sm font-extrabold text-pink-600">${totalInterest.toLocaleString('en-NZ', { maximumFractionDigits: 0 })}</div>
              </div>
            </div>
          </div>

          {/* Benefits */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <h3 className="text-sm font-bold font-display mb-3 flex items-center gap-2">
              <ShieldCheck size={14} className="text-emerald-500" /> Why finance with GoldenRay?
            </h3>
            <ul className="space-y-2">
              {[
                ['Bill savings often beat the repayment', 'from day one'],
                ['Panel Tier-1 + 25-yr performance warranty', 'included'],
                ['We handle the lender paperwork', 'you just sign'],
                ['Pre-approval in 24 hours', 'no obligation'],
              ].map(([t, sub], i) => (
                <li key={i} className="flex gap-2 items-start">
                  <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold">{t}</div>
                    <div className="text-[10px] text-gray-400">{sub}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* RIGHT — application form */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 p-7 shadow-sm">
          {state.done ? (
            <div className="text-center py-10">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                <CheckCircle2 size={28} className="text-white" />
              </div>
              <h3 className="text-xl font-extrabold font-display mb-2">Application received!</h3>
              <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6">
                A Goldenray finance specialist will email you within <b>24 hours</b> with a pre-approval and next steps.
                Reference <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{state.id.slice(0, 8)}</span>.
              </p>
              <div className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                <Clock size={11} /> Typical turnaround: 24–48 hours
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h3 className="text-sm font-bold font-display flex items-center gap-2">
                  <Send size={14} className="text-amber-500" /> Apply for {product.name}
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">No credit check yet — just an enquiry. We'll confirm eligibility with you before any lender check.</p>
              </div>

              {state.error && (
                <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs">{state.error}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <TextField label="First name" name="firstName" value={form.firstName} onChange={handleChange} />
                <TextField label="Last name" name="lastName" value={form.lastName} onChange={handleChange} />
                <TextField label="Email" name="email" type="email" value={form.email} onChange={handleChange} />
                <TextField label="Phone" name="phone" value={form.phone} onChange={handleChange} placeholder="+64 21..." />
                <div className="col-span-2">
                  <TextField label="Installation address" name="address" value={form.address} onChange={handleChange} />
                </div>
                <SelectField label="Home ownership" name="homeOwnership" value={form.homeOwnership} onChange={handleChange}
                  options={[
                    { value: 'own', label: 'Own outright' },
                    { value: 'mortgage', label: 'Own with mortgage' },
                    { value: 'renting', label: 'Renting' },
                    { value: 'other', label: 'Other' },
                  ]} />
                <SelectField label="Monthly household income" name="monthlyIncomeBand" value={form.monthlyIncomeBand} onChange={handleChange} options={INCOME_BANDS} />
                <SelectField label="Employment" name="employmentType" value={form.employmentType} onChange={handleChange}
                  options={[
                    { value: 'full_time', label: 'Full-time' },
                    { value: 'part_time', label: 'Part-time' },
                    { value: 'self_employed', label: 'Self-employed' },
                    { value: 'retired', label: 'Retired' },
                    { value: 'other', label: 'Other' },
                  ]} />
                <SelectField label="Your bank (for top-up)" name="existingBank" value={form.existingBank} onChange={handleChange}
                  options={['ANZ','ASB','BNZ','Westpac','Kiwibank','TSB','Heartland','Other'].map(v => ({ value: v, label: v }))} />
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Anything else we should know?</label>
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400 resize-y min-h-[56px]"
                  placeholder="E.g. roof type, urgency, preferred lender..." />
              </div>

              <label className="flex items-start gap-2 text-[11px] text-gray-600 cursor-pointer">
                <input type="checkbox" name="creditConsent" checked={form.creditConsent} onChange={handleChange}
                  className="mt-0.5 w-3.5 h-3.5 accent-amber-500" />
                <span>I consent to Goldenray Energy NZ sharing this application with approved lenders (Westpac, ANZ, Kiwibank, Harmoney) for a soft credit assessment. A hard credit check only runs after I accept an offer.</span>
              </label>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <div className="text-[10px] text-gray-400">
                  Selected: <b className="text-gray-700">{product.name}</b> · ${cappedAmount.toLocaleString()} over {cappedTerm}yr · ~${monthlyPmt.toLocaleString('en-NZ',{maximumFractionDigits:0})}/mo
                </div>
                <button type="submit" disabled={state.loading || !form.creditConsent}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 text-white font-bold text-sm shadow-lg shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 hover:-translate-y-0.5 transition-transform">
                  {state.loading ? <><Loader2 size={15} className="animate-spin" /> Submitting...</> : <><Send size={15} /> Submit Application</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Mini helpers ──
const TextField = ({ label, name, value, onChange, type = 'text', placeholder }) => (
  <div>
    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
    <input type={type} name={name} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400 transition" />
  </div>
);

const SelectField = ({ label, name, value, onChange, options }) => (
  <div>
    <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</label>
    <select name={name} value={value} onChange={onChange}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-amber-400 transition bg-white">
      <option value="">Select...</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);
