import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDateTime } from '../../utils/format';
import {
  ArrowLeft, Sun, Zap, Leaf, DollarSign, TrendingUp, Battery,
  Mail, Phone, MapPin, Home, Calendar, User as UserIcon,
} from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'new',       label: 'New',       color: '#F5A623' },
  { value: 'contacted', label: 'Contacted', color: '#1E90FF' },
  { value: 'qualified', label: 'Qualified', color: '#FF6A00' },
  { value: 'won',       label: 'Won',       color: '#2ECC71' },
  { value: 'lost',      label: 'Lost',      color: '#EF4444' },
];

function StatCard({ icon: Icon, label, value, sub, highlight }) {
  return (
    <div className={`rounded-xl border p-4 text-center ${highlight
      ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200'
      : 'bg-white border-gray-100'}`}>
      {Icon && <Icon size={18} className={highlight ? 'text-emerald-500 mx-auto mb-1' : 'text-amber-500 mx-auto mb-1'} />}
      <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`text-xl font-extrabold mt-1 ${highlight ? 'text-emerald-600' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon size={14} className="text-gray-300 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</div>
        <div className="text-sm text-gray-800 break-words">{value || <span className="text-gray-300">—</span>}</div>
      </div>
    </div>
  );
}

export default function EnquiryDetailPage() {
  const { id } = useParams();
  const [enquiry, setEnquiry] = useState(null);
  const [calc, setCalc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  useEffect(() => {
    api.get(`/enquiries/${id}`)
      .then(r => { setEnquiry(r.data.enquiry); setCalc(r.data.calculation); })
      .catch(e => setError(e.response?.data?.error || 'Failed to load enquiry'))
      .finally(() => setLoading(false));
  }, [id]);

  const updateStatus = async (status) => {
    setStatusSaving(true);
    try {
      const { data } = await api.patch(`/enquiries/${id}`, { status });
      setEnquiry(e => ({ ...e, status: data.status }));
    } finally {
      setStatusSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  }
  if (error) {
    return <div className="p-6"><div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-lg text-sm">{error}</div></div>;
  }
  if (!enquiry) return null;

  const name = [enquiry.first_name, enquiry.last_name].filter(Boolean).join(' ') || 'Website Enquiry';
  const currentStatus = STATUS_OPTIONS.find(s => s.value === (enquiry.status || 'new'));

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/portal/enquiries" className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:border-gray-300 transition">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h2 className="text-lg font-bold font-display">{name}</h2>
            <p className="text-[11px] text-gray-400">Submitted {fmtDateTime(enquiry.created_at)} · Ref <span className="font-mono text-amber-600">{enquiry.id.slice(0, 8)}</span></p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 uppercase font-semibold">Status</span>
          <div className="flex gap-1">
            {STATUS_OPTIONS.map(s => {
              const active = (enquiry.status || 'new') === s.value;
              return (
                <button key={s.value} onClick={() => updateStatus(s.value)} disabled={statusSaving}
                  className="px-2.5 py-1 rounded-md text-[10px] font-semibold transition disabled:opacity-50"
                  style={{
                    background: active ? s.color + '18' : '#f5f5f5',
                    color: active ? s.color : '#9ca3af',
                    boxShadow: active ? `inset 0 0 0 1px ${s.color}55` : 'none',
                  }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* LEFT — Contact + Installation */}
        <div className="lg:col-span-2 space-y-4">
          <Card title="Contact" subtitle="Who submitted the enquiry">
            <InfoRow icon={UserIcon} label="Full Name" value={name} />
            <InfoRow icon={Mail}     label="Email"     value={enquiry.email} />
            <InfoRow icon={Phone}    label="Phone"     value={enquiry.phone} />
            <InfoRow icon={MapPin}   label="Address"   value={enquiry.address} />
          </Card>

          <Card title="Installation" subtitle="Site and system preferences">
            <InfoRow icon={Home}     label="Owns Home"              value={enquiry.owns_home} />
            <InfoRow icon={Home}     label="Floors"                 value={enquiry.floors} />
            <InfoRow icon={Home}     label="Roof Type"              value={enquiry.roof_type} />
            <InfoRow icon={Sun}      label="Installation Type"
              value={enquiry.installation_type
                ? <Badge color="#f59e0b">{enquiry.installation_type}</Badge>
                : null} />
            <InfoRow icon={Battery}  label="Battery Option"         value={enquiry.battery_option} />
            <InfoRow icon={Phone}    label="Call to Discuss"        value={enquiry.call_to_discuss} />
            <InfoRow icon={Calendar} label="Installation Timeframe" value={enquiry.installation_timeframe} />
            <InfoRow icon={DollarSign} label="Monthly Bill"         value={enquiry.monthly_bill ? fmt$(enquiry.monthly_bill) : null} />
          </Card>

          <Card title="Lead Score" subtitle="Form completeness">
            <div className="flex items-center gap-3">
              <div className={`text-3xl font-extrabold ${enquiry.lead_score >= 70 ? 'text-emerald-600' : enquiry.lead_score >= 40 ? 'text-amber-600' : 'text-gray-400'}`}>
                {enquiry.lead_score ?? '—'}
              </div>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500" style={{ width: `${enquiry.lead_score || 0}%` }} />
                </div>
                <div className="text-[10px] text-gray-400 mt-1">0–100 based on captured details</div>
              </div>
            </div>
          </Card>
        </div>

        {/* RIGHT — Solar quote (the old right-side panel, moved here) */}
        <div className="lg:col-span-3 space-y-4">
          {!calc ? (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <Sun size={40} className="text-amber-300 mb-2" />
              <h3 className="text-sm font-bold text-gray-600">No calculation available</h3>
              <p className="text-[11px] text-gray-400 mt-1 max-w-xs">The customer did not provide a monthly bill, so no solar quote was computed.</p>
            </Card>
          ) : (
            <>
              <Card title="System Overview" subtitle={`${calc.systemSize} kW solar system`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard icon={Sun}        label="System Size"   value={`${calc.systemSize} kW`} sub={`${calc.panels} panels`} />
                  <StatCard icon={Zap}        label="Annual Output" value={`${(calc.annualKwh / 1000).toFixed(1)}k`} sub="kWh/year" />
                  <StatCard icon={Battery}    label={calc.batteryKwh > 0 ? 'Battery' : 'Type'}
                    value={calc.batteryKwh > 0 ? `${calc.batteryKwh} kWh` : (enquiry.installation_type || '—')} />
                  <StatCard icon={DollarSign} label="Total Cost"    value={fmt$(calc.totalCost)} />
                </div>
              </Card>

              <Card title="Solar vs Traditional Electricity" subtitle="Lifetime savings picture">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                    <div className="text-[10px] font-bold text-red-600 uppercase">Without Solar</div>
                    <div className="text-2xl font-extrabold text-red-600 mt-1">{fmt$(calc.traditionalCost)}</div>
                    <div className="text-[10px] text-red-400">per year electricity</div>
                    <div className="text-xs text-red-500 font-semibold mt-2">25yr cost: {fmt$(calc.traditionalCost * 25)}</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <div className="text-[10px] font-bold text-emerald-600 uppercase">With Solar</div>
                    <div className="text-2xl font-extrabold text-emerald-600 mt-1">{fmt$(calc.traditionalCost - calc.annualSavings)}</div>
                    <div className="text-[10px] text-emerald-400">remaining annual cost</div>
                    <div className="text-xs text-emerald-600 font-semibold mt-2">Save {fmt$(calc.annualSavings)}/yr ({calc.costReduction}%)</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard icon={DollarSign} label="Monthly Savings"  value={fmt$(calc.monthlySavings)} highlight />
                  <StatCard icon={TrendingUp} label="Payback Period"   value={`${calc.paybackYears} yr`} />
                  <StatCard icon={TrendingUp} label="ROI"              value={`${calc.roi}%`} highlight />
                  <StatCard icon={DollarSign} label="25-Year Savings"  value={fmt$(calc.lifetimeSavings)} highlight />
                </div>
              </Card>

              <Card title="Cost Breakdown" subtitle="Itemised pricing">
                <div className="rounded-lg border border-gray-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left px-3 py-2 font-semibold text-gray-500">Item</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-500">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Solar Panels', calc.panelCost, `${calc.panels} panels × ${fmt$(Math.round(calc.panelCost / Math.max(calc.panels, 1)))}`],
                        ['Inverter', calc.inverterCost, 'Grid-tie inverter'],
                        ['Installation & Labour', calc.laborCost, 'Professional install'],
                        ...(calc.batteryKwh > 0 ? [['Battery Storage', calc.batteryCost, `${calc.batteryKwh} kWh`]] : []),
                        ['Margin', calc.markup, 'Warranty & overheads'],
                        ['GST (15%)', calc.tax, 'Goods & Services Tax'],
                      ].map(([name, cost, detail], i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{name}</div>
                            <div className="text-[10px] text-gray-400">{detail}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{fmt$(cost)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-900 text-white">
                        <td className="px-3 py-2.5 font-bold">Total Investment</td>
                        <td className="px-3 py-2.5 text-right font-extrabold text-base">{fmt$(calc.totalCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Environmental Impact" subtitle="Customer-facing sustainability story">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <Leaf size={18} className="text-emerald-500 mx-auto mb-1" />
                    <div className="text-lg font-extrabold text-emerald-600">{calc.co2TonsYear}t</div>
                    <div className="text-[10px] text-gray-500">CO₂ reduced/year</div>
                    <div className="text-[9px] text-emerald-500 mt-1">Lifetime: {calc.lifetimeCo2}t</div>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <div className="text-2xl">🌳</div>
                    <div className="text-lg font-extrabold text-emerald-600">{calc.treesEquivalent}</div>
                    <div className="text-[10px] text-gray-500">Trees equivalent</div>
                    <div className="text-[9px] text-emerald-500 mt-1">Every year</div>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <Zap size={18} className="text-emerald-500 mx-auto mb-1" />
                    <div className="text-lg font-extrabold text-emerald-600">{(calc.annualKwh / 1000).toFixed(1)}k</div>
                    <div className="text-[10px] text-gray-500">Clean kWh/year</div>
                    <div className="text-[9px] text-emerald-500 mt-1">100% renewable</div>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
