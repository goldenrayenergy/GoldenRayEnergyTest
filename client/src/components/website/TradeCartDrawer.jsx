import { useState } from 'react';
import axios from 'axios';
import { ShoppingCart, X, Plus, Minus, Trash2, ArrowRight, CheckCircle, Loader2, Building2, User, Mail, Phone, MapPin, FileText } from 'lucide-react';

const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
const GST_RATE = 0.15;

export default function TradeCartDrawer({ open, onClose, cart }) {
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  if (!open) return null;

  const subtotalIncl = cart.subtotal;
  const subtotalExcl = +(subtotalIncl / (1 + GST_RATE)).toFixed(2);
  const gst          = +(subtotalIncl - subtotalExcl).toFixed(2);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between bg-amber-50">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-amber-600" />
            <h3 className="text-sm font-bold font-display">Your cart ({cart.count} {cart.count === 1 ? 'item' : 'items'})</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-amber-100 text-gray-500"><X size={16} /></button>
        </div>

        {submitted ? (
          <SubmittedState submitted={submitted} cart={cart} onClose={onClose} />
        ) : showForm ? (
          <RequestQuoteForm cart={cart} onBack={() => setShowForm(false)} onDone={(res) => { setSubmitted(res); cart.clear(); }} subtotalExcl={subtotalExcl} gst={gst} subtotalIncl={subtotalIncl} />
        ) : (
          <CartContents cart={cart} onCheckout={() => setShowForm(true)} subtotalExcl={subtotalExcl} gst={gst} subtotalIncl={subtotalIncl} />
        )}
      </div>
    </div>
  );
}

function CartContents({ cart, onCheckout, subtotalExcl, gst, subtotalIncl }) {
  if (cart.items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <ShoppingCart size={36} className="text-gray-200 mb-3" />
        <div className="text-sm font-semibold mb-1">Your cart is empty</div>
        <div className="text-xs text-gray-400">Browse the shop and add products to request a quote.</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-gray-100">
          {cart.items.map(i => (
            <li key={i.product_id} className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{i.name}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {[i.brand, i.sku].filter(Boolean).join(' · ')}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">{fmt$(i.unit_sell_incl_gst)} each</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => cart.setQty(i.product_id, i.qty - 1)} disabled={i.qty <= 1}
                  className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30">
                  <Minus size={10} />
                </button>
                <input type="number" min="1" value={i.qty}
                  onChange={e => cart.setQty(i.product_id, parseInt(e.target.value) || 1)}
                  className="w-12 text-center text-xs border border-gray-200 rounded py-0.5"
                />
                <button onClick={() => cart.setQty(i.product_id, i.qty + 1)}
                  className="p-1 rounded border border-gray-200 hover:bg-gray-50">
                  <Plus size={10} />
                </button>
              </div>
              <div className="w-20 text-right text-xs font-bold flex-shrink-0">{fmt$((i.unit_sell_incl_gst || 0) * i.qty)}</div>
              <button onClick={() => cart.remove(i.product_id)} title="Remove"
                className="p-1 text-gray-300 hover:text-red-500 flex-shrink-0">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 space-y-1.5">
        <Row label="Sub-total (excl GST)" value={fmt$(subtotalExcl)} />
        <Row label="GST 15%"               value={fmt$(gst)} />
        <Row label="Total (incl GST)"      value={fmt$(subtotalIncl)} accent />
        <button onClick={onCheckout}
          className="mt-3 w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm flex items-center justify-center gap-2 hover:from-amber-400 hover:to-orange-400">
          Request a Quote <ArrowRight size={14} />
        </button>
        <p className="text-[9px] text-gray-400 text-center mt-1">No payment now · sales replies within 1 business day</p>
      </div>
    </>
  );
}

function RequestQuoteForm({ cart, onBack, onDone, subtotalExcl, gst, subtotalIncl }) {
  const [form, setForm] = useState({
    businessName: '', contactName: '', email: '', phone: '',
    gstNumber: '', deliveryAddress: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handle = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const items = cart.items.map(i => ({ product_id: i.product_id, qty: i.qty }));
      const { data } = await axios.post('/api/shop/request-quote', { ...form, items });
      onDone(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] text-amber-600 font-semibold hover:text-amber-700 mb-1">← Back to cart</button>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-700">
        Submit your details and we'll respond with a tailored quote (incl. delivery) within one business day. No payment now.
      </div>

      {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>}

      <Field label="Business name *"   name="businessName"    value={form.businessName}    onChange={handle} icon={Building2} required />
      <Field label="Contact name *"    name="contactName"     value={form.contactName}     onChange={handle} icon={User}      required />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Email *"         name="email"            type="email" value={form.email} onChange={handle} icon={Mail}  required />
        <Field label="Phone"           name="phone"            type="tel"   value={form.phone} onChange={handle} icon={Phone} />
      </div>
      <Field label="GST number"        name="gstNumber"        value={form.gstNumber}       onChange={handle} hint="Optional — speeds up tax-invoice setup" />
      <Field label="Delivery address" name="deliveryAddress"  value={form.deliveryAddress} onChange={handle} icon={MapPin} hint="Optional" />
      <Field label="Notes (optional)" name="notes"            type="textarea" value={form.notes} onChange={handle} icon={FileText} hint="Lead time needs, project deadlines, anything else useful" />

      {/* Order recap */}
      <div className="border-t border-gray-100 pt-3 space-y-1">
        <Row label={`${cart.count} item${cart.count === 1 ? '' : 's'} · sub-total excl GST`} value={fmt$(subtotalExcl)} />
        <Row label="GST 15%" value={fmt$(gst)} />
        <Row label="Total incl GST" value={fmt$(subtotalIncl)} accent />
      </div>

      <button type="submit" disabled={busy}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : <>Submit Request <ArrowRight size={14} /></>}
      </button>
    </form>
  );
}

function SubmittedState({ submitted, cart, onClose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
        <CheckCircle size={32} className="text-emerald-500" />
      </div>
      <h3 className="text-base font-bold font-display mb-1">Request received</h3>
      <p className="text-xs text-gray-500 mb-4 max-w-xs">
        Thanks — we've got your request. A specialist will reply with a quote (incl. delivery) within one business day.
      </p>
      <button onClick={onClose}
        className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold">
        Continue browsing
      </button>
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div className="flex justify-between text-xs">
      <span className={accent ? 'font-bold' : 'text-gray-500'}>{label}</span>
      <span className={accent ? 'font-extrabold text-amber-700 text-base' : 'font-semibold'}>{value}</span>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text', icon: Icon, hint, required }) {
  if (type === 'textarea') {
    return (
      <div>
        <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
        <textarea name={name} value={value} onChange={onChange} rows={2}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400" />
        {hint && <div className="text-[9px] text-gray-400 mt-0.5">{hint}</div>}
      </div>
    );
  }
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</label>
      <div className="relative mt-1">
        {Icon && <Icon size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />}
        <input name={name} value={value} onChange={onChange} type={type} required={required}
          className={`w-full pr-3 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 ${Icon ? 'pl-8' : 'pl-3'}`} />
      </div>
      {hint && <div className="text-[9px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}
