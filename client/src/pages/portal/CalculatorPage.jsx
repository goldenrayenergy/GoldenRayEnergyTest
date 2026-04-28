import { useState, useCallback } from 'react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { fmt$ } from '../../utils/format';
import api from '../../services/api';
import {
  Calculator, Sun, Zap, Leaf, Download, Mail, MessageCircle,
  TrendingUp, Battery, DollarSign, ArrowRight, CheckCircle, Loader2
} from 'lucide-react';

const SYSTEM_TYPES = [
  { value: 'on-grid', label: 'On-Grid', desc: 'Connected to the grid, sell excess power back' },
  { value: 'hybrid', label: 'Hybrid', desc: 'Grid + battery backup for power outages' },
  { value: 'off-grid', label: 'Off-Grid', desc: 'Fully independent solar — optional battery storage' },
  { value: 'ppa', label: 'PPA', desc: 'Power Purchase Agreement — pay-per-kWh, no upfront cost' },
];

const BATTERY_OPTIONS = [
  { value: 'with-battery', label: 'With Battery', desc: 'Sized to cover nighttime/overcast use' },
  { value: 'without-battery', label: 'Without Battery', desc: 'Daytime-only generation, no storage' },
];

function StatCard({ icon: Icon, label, value, sub, highlight }) {
  return (
    <div className={`rounded-xl border p-4 text-center ${highlight
      ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200'
      : 'bg-white border-gray-100'}`}>
      <Icon size={18} className={highlight ? 'text-emerald-500 mx-auto mb-1' : 'text-amber-500 mx-auto mb-1'} />
      <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`text-xl font-extrabold mt-1 ${highlight ? 'text-emerald-600' : 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function CalculatorPage() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', location: '',
    monthlyBill: '', electricityRate: '0.32', systemType: 'on-grid',
    batteryOption: 'with-battery',
  });
  const [calc, setCalc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState('');
  const [sent, setSent] = useState({});

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const calculate = useCallback(async () => {
    if (!form.monthlyBill) return;
    setLoading(true);
    try {
      const { data } = await api.post('/quote/calculate', {
        monthlyBill: parseFloat(form.monthlyBill),
        electricityRate: parseFloat(form.electricityRate),
        systemType: form.systemType,
        batteryOption: form.systemType === 'off-grid' ? form.batteryOption : undefined,
      });
      setCalc(data);
      setSent({});
    } catch (e) {
      console.error('Calculation failed:', e);
    } finally {
      setLoading(false);
    }
  }, [form.monthlyBill, form.electricityRate, form.systemType]);

  const downloadPDF = async () => {
    setSending('pdf');
    try {
      const res = await api.post('/quote/pdf', {
        customer: form,
        calculation: calc,
      }, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `GoldenRay-Quote-${(form.name || 'Customer').replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setSent(s => ({ ...s, pdf: true }));
    } catch (e) {
      console.error('PDF download failed:', e);
    } finally {
      setSending('');
    }
  };

  const sendEmail = async () => {
    if (!form.email) return alert('Please enter an email address');
    setSending('email');
    try {
      await api.post('/quote/send-email', { customer: form, calculation: calc });
      setSent(s => ({ ...s, email: true }));
    } catch (e) {
      console.error('Email send failed:', e);
    } finally {
      setSending('');
    }
  };

  const sendWhatsApp = async () => {
    if (!form.phone) return alert('Please enter a phone number');
    setSending('whatsapp');
    try {
      const { data } = await api.post('/quote/whatsapp-link', { customer: form, calculation: calc });
      window.open(data.url, '_blank');
      setSent(s => ({ ...s, whatsapp: true }));
    } catch (e) {
      console.error('WhatsApp link failed:', e);
    } finally {
      setSending('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold font-display flex items-center gap-2">
            <Calculator size={22} className="text-amber-500" />
            Solar Quote Calculator
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Generate detailed quotes with savings analysis</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT: Form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer Details */}
          <Card title="Customer Details" subtitle="Enter client information">
            <div className="space-y-3">
              {[
                { name: 'name', label: 'Full Name', placeholder: 'John Smith', type: 'text' },
                { name: 'email', label: 'Email Address', placeholder: 'john@example.com', type: 'email' },
                { name: 'phone', label: 'Phone Number', placeholder: '+64 21 123 4567', type: 'tel' },
                { name: 'location', label: 'Location', placeholder: 'Auckland, NZ', type: 'text' },
              ].map(f => (
                <div key={f.name}>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{f.label}</label>
                  <input name={f.name} type={f.type} placeholder={f.placeholder} value={form[f.name]}
                    onChange={handleChange}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition" />
                </div>
              ))}
            </div>
          </Card>

          {/* System Configuration */}
          <Card title="System Configuration" subtitle="Customize the solar setup">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Monthly Electricity Bill (NZD) *</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-semibold">$</span>
                  <input name="monthlyBill" type="number" min="50" step="10" placeholder="250"
                    value={form.monthlyBill} onChange={handleChange}
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Electricity Rate ($/kWh)</label>
                <input name="electricityRate" type="number" min="0.10" max="1.00" step="0.01"
                  value={form.electricityRate} onChange={handleChange}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition" />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">System Type</label>
                <div className="space-y-2">
                  {SYSTEM_TYPES.map(t => (
                    <label key={t.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                        ${form.systemType === t.value
                          ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
                          : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="radio" name="systemType" value={t.value}
                        checked={form.systemType === t.value} onChange={handleChange}
                        className="accent-amber-500" />
                      <div>
                        <div className="text-sm font-semibold">{t.label}</div>
                        <div className="text-[10px] text-gray-400">{t.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {form.systemType === 'off-grid' && (
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Battery Option</label>
                  <div className="grid grid-cols-2 gap-2">
                    {BATTERY_OPTIONS.map(b => (
                      <label key={b.value}
                        className={`flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-all
                          ${form.batteryOption === b.value
                            ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
                            : 'border-gray-200 hover:bg-gray-50'}`}>
                        <div className="flex items-center gap-2">
                          <input type="radio" name="batteryOption" value={b.value}
                            checked={form.batteryOption === b.value} onChange={handleChange}
                            className="accent-amber-500" />
                          <span className="text-sm font-semibold">{b.label}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 pl-6">{b.desc}</div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Button onClick={calculate} variant="primary" size="lg" block icon={loading ? Loader2 : Zap}
                disabled={!form.monthlyBill || loading}>
                {loading ? 'Calculating...' : 'Generate Quote'}
              </Button>
            </div>
          </Card>
        </div>

        {/* RIGHT: Results */}
        <div className="lg:col-span-3 space-y-4">
          {!calc ? (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <Sun size={48} className="text-amber-300 mb-3" />
              <h3 className="text-sm font-bold text-gray-600">Enter your electricity details</h3>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                Fill in the monthly bill and system preferences, then click "Generate Quote" to see your personalized solar savings analysis.
              </p>
            </Card>
          ) : (
            <>
              {/* System Overview */}
              <Card title="System Overview" subtitle={`${calc.systemSize}kW ${form.systemType} solar system`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard icon={Sun} label="System Size" value={`${calc.systemSize} kW`} sub={`${calc.panels} panels`} />
                  <StatCard icon={Zap} label="Annual Output" value={`${(calc.annualKwh / 1000).toFixed(1)}k`} sub="kWh/year" />
                  <StatCard icon={Battery} label={calc.batteryKwh > 0 ? 'Battery' : 'Type'} value={calc.batteryKwh > 0 ? `${calc.batteryKwh} kWh` : form.systemType} />
                  <StatCard icon={DollarSign} label="Total Cost" value={fmt$(calc.totalCost)} />
                </div>
              </Card>

              {/* Savings vs Traditional */}
              <Card title="Solar vs Traditional Electricity" subtitle="See how much you save">
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
                  <StatCard icon={DollarSign} label="Monthly Savings" value={fmt$(calc.monthlySavings)} highlight />
                  <StatCard icon={TrendingUp} label="Payback Period" value={`${calc.paybackYears} yr`} />
                  <StatCard icon={TrendingUp} label="ROI" value={`${calc.roi}%`} highlight />
                  <StatCard icon={DollarSign} label="25-Year Savings" value={fmt$(calc.lifetimeSavings)} highlight />
                </div>
              </Card>

              {/* Cost Breakdown */}
              <Card title="Cost Breakdown" subtitle="Detailed pricing">
                <div className="rounded-lg border border-gray-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50">
                      <th className="text-left px-3 py-2 font-semibold text-gray-500">Item</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500">Cost</th>
                    </tr></thead>
                    <tbody>
                      {[
                        ['Solar Panels', calc.panelCost, `${calc.panels} panels × ${fmt$(Math.round(calc.panelCost / calc.panels))}`],
                        ['Inverter', calc.inverterCost, `Grid-tie inverter`],
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

              {/* Environmental Impact */}
              <Card title="Environmental Impact" subtitle="Your contribution to a greener planet">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <div className="text-2xl mb-1">🏭</div>
                    <div className="text-lg font-extrabold text-emerald-600">{calc.co2TonsYear}t</div>
                    <div className="text-[10px] text-gray-500">CO₂ reduced/year</div>
                    <div className="text-[9px] text-emerald-500 mt-1">Lifetime: {calc.lifetimeCo2}t</div>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <div className="text-2xl mb-1">🌳</div>
                    <div className="text-lg font-extrabold text-emerald-600">{calc.treesEquivalent}</div>
                    <div className="text-[10px] text-gray-500">Trees equivalent</div>
                    <div className="text-[9px] text-emerald-500 mt-1">Every year</div>
                  </div>
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-4 text-center">
                    <div className="text-2xl mb-1">⚡</div>
                    <div className="text-lg font-extrabold text-emerald-600">{(calc.annualKwh / 1000).toFixed(1)}k</div>
                    <div className="text-[10px] text-gray-500">Clean kWh/year</div>
                    <div className="text-[9px] text-emerald-500 mt-1">100% renewable</div>
                  </div>
                </div>
              </Card>

              {/* Share / Export */}
              <Card title="Share Quote" subtitle="Send this quote to the customer">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button onClick={downloadPDF} disabled={sending === 'pdf'}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all font-semibold text-sm
                      ${sent.pdf ? 'border-emerald-400 bg-emerald-50 text-emerald-600' : 'border-gray-200 hover:border-amber-400 hover:bg-amber-50 text-gray-700'}`}>
                    {sending === 'pdf' ? <Loader2 size={16} className="animate-spin" /> : sent.pdf ? <CheckCircle size={16} /> : <Download size={16} />}
                    {sent.pdf ? 'Downloaded!' : 'Download PDF'}
                  </button>

                  <button onClick={sendEmail} disabled={sending === 'email' || !form.email}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all font-semibold text-sm
                      ${sent.email ? 'border-emerald-400 bg-emerald-50 text-emerald-600' : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700'}
                      ${!form.email ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {sending === 'email' ? <Loader2 size={16} className="animate-spin" /> : sent.email ? <CheckCircle size={16} /> : <Mail size={16} />}
                    {sent.email ? 'Sent!' : 'Email Quote'}
                  </button>

                  <button onClick={sendWhatsApp} disabled={sending === 'whatsapp' || !form.phone}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 transition-all font-semibold text-sm
                      ${sent.whatsapp ? 'border-emerald-400 bg-emerald-50 text-emerald-600' : 'border-gray-200 hover:border-green-400 hover:bg-green-50 text-gray-700'}
                      ${!form.phone ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {sending === 'whatsapp' ? <Loader2 size={16} className="animate-spin" /> : sent.whatsapp ? <CheckCircle size={16} /> : <MessageCircle size={16} />}
                    {sent.whatsapp ? 'Opened!' : 'WhatsApp'}
                  </button>
                </div>
                {!form.email && !form.phone && (
                  <p className="text-[10px] text-amber-500 mt-2 text-center">Enter email/phone in customer details to enable sharing</p>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
