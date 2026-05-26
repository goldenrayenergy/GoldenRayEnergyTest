import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { publicApi } from '../services/api';
import { Package, ArrowLeft, Plus, Minus, Loader2, AlertTriangle, FileText, Truck, Clock, ShoppingCart } from 'lucide-react';
import WebsiteFooter from '../components/website/WebsiteFooter';
import TradeCartDrawer from '../components/website/TradeCartDrawer';
import WebsiteNav from '../components/website/WebsiteNav';
import useCart from '../hooks/useCart';

const cartButton = (cart, onClick) => (
  <button onClick={onClick}
    className="relative px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1.5 transition">
    <ShoppingCart size={14} /> Cart
    {cart.count > 0 && (
      <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
        {cart.count > 99 ? '99+' : cart.count}
      </span>
    )}
  </button>
);

const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

export default function ShopProductDetailPage() {
  const { sku } = useParams();
  const cart = useCart();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [qty, setQty]         = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    setLoading(true);
    publicApi.get(`/shop/products/${sku}`)
      .then(r => setProduct(r.data))
      .catch(e => setError(e.response?.status === 404 ? 'Product not found' : (e.response?.data?.error || 'Failed to load')))
      .finally(() => setLoading(false));
  }, [sku]);

  const addToCart = () => {
    if (!product) return;
    cart.add(product, qty);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-amber-500" size={28} /></div>;
  if (error)   return (
    <div className="bg-white min-h-screen">
      <WebsiteNav extras={cartButton(cart, () => setCartOpen(true))} />
      <div className="pt-32 px-6 text-center">
        <div className="text-sm text-gray-500 mb-3">{error}</div>
        <Link to="/shop" className="text-amber-600 underline text-xs">← Back to all products</Link>
      </div>
      <TradeCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} />
    </div>
  );

  const isBackorder = product.stock_status === 'backorder';
  const specEntries = Object.entries(product.specs || {});

  return (
    <div className="bg-white font-body">
      <WebsiteNav extras={cartButton(cart, () => setCartOpen(true))} />

      <section className="pt-24 md:pt-28 pb-12 px-6 md:px-10 bg-gradient-to-br from-amber-50 via-white to-emerald-50">
        <div className="max-w-6xl mx-auto">
          <Link
            to="/shop"
            title="Return to the Trade Shop product list"
            className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-lg bg-white border-2 border-amber-300 text-amber-700 font-bold text-sm shadow-sm hover:bg-amber-50 hover:border-amber-400 hover:shadow transition"
          >
            <ArrowLeft size={16} />
            Back to Trade Shop
          </Link>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Image */}
            <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-amber-100 to-orange-100 aspect-square flex items-center justify-center">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Package size={120} className="text-amber-400 opacity-40" />
              )}
            </div>

            {/* Right column */}
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide font-bold mb-1">{product.brand || '—'}</div>
              <h1 className="text-2xl md:text-3xl font-extrabold font-display mb-2">{product.name}</h1>
              {product.sku && <div className="text-xs font-mono text-gray-400 mb-3">SKU · {product.sku}</div>}

              {product.description && <p className="text-sm text-gray-600 mb-4">{product.description}</p>}

              {/* Spec chips */}
              <div className="flex flex-wrap gap-1.5 mb-5">
                {product.specs?.wattage_w && (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold">{product.specs.wattage_w}W</span>
                )}
                {product.unit && product.unit !== 'EA' && (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">per {product.unit}</span>
                )}
                {product.moq > 1 && (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">MOQ {product.moq}</span>
                )}
              </div>

              {/* Pricing card */}
              <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-lg mb-4">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">Price</div>
                <div className="flex items-end gap-2 mb-1">
                  <div className="text-3xl font-extrabold text-amber-600">{fmt$(product.sell_incl_gst)}</div>
                  <div className="text-[11px] text-gray-400 mb-1">incl GST</div>
                </div>
                <div className="text-[10px] text-gray-500 mb-3">Net {fmt$(product.sell_excl_gst)} · per {product.unit || 'each'}</div>

                {isBackorder && (
                  <div className="px-3 py-2 mb-3 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                    <span>Currently on backorder{product.available_from ? ` — available from ${product.available_from}` : ''}.</span>
                  </div>
                )}

                {/* Qty + Add */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(q => Math.max(1, q - 1))}
                      className="p-2 rounded border border-gray-200 hover:bg-gray-50">
                      <Minus size={12} />
                    </button>
                    <input type="number" min="1" value={qty}
                      onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 text-center text-sm border border-gray-200 rounded py-1.5"
                    />
                    <button onClick={() => setQty(q => q + 1)}
                      className="p-2 rounded border border-gray-200 hover:bg-gray-50">
                      <Plus size={12} />
                    </button>
                  </div>
                  <button onClick={addToCart}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2
                      ${justAdded
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400'}`}>
                    {justAdded ? '✓ Added' : <><Plus size={14} /> Add to cart</>}
                  </button>
                </div>
                {product.moq > 1 && qty < product.moq && (
                  <div className="mt-2 text-[10px] text-amber-700 flex items-start gap-1">
                    <AlertTriangle size={10} className="mt-0.5" />
                    <span>Below MOQ ({product.moq}) — sales will confirm whether smaller orders can be fulfilled.</span>
                  </div>
                )}
              </div>

              {/* Datasheet link */}
              {product.datasheet_url && (
                <a href={product.datasheet_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700">
                  <FileText size={12} /> Datasheet
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Specs section */}
      {specEntries.length > 0 && (
        <section className="py-10 px-6 md:px-10">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-lg font-extrabold font-display mb-3">Specifications</h2>
            <table className="w-full bg-white rounded-xl border border-gray-100 overflow-hidden">
              <tbody className="divide-y divide-gray-100">
                {specEntries.map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2 text-xs text-gray-500 capitalize w-1/3">{k.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-xs font-semibold">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Trust band */}
      <section className="py-8 px-6 md:px-10 border-y border-gray-100 bg-gray-50">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-4">
          <BandItem icon={Truck}    title="Delivery NZ-wide" desc="Auckland to Bluff" />
          <BandItem icon={Clock}    title="Reply ≤ 1 day"     desc="Quote with delivery in 1 business day" />
          <BandItem icon={FileText} title="GST tax invoice"   desc="Provided on every order" />
        </div>
      </section>

      <TradeCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} />
      <WebsiteFooter />
    </div>
  );
}

function BandItem({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
        <Icon size={16} />
      </div>
      <div>
        <div className="text-xs font-bold">{title}</div>
        <div className="text-[10px] text-gray-500">{desc}</div>
      </div>
    </div>
  );
}
