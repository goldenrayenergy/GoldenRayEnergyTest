import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../services/api';
import {
  Search, ShoppingCart, Package, Phone, Lock, ArrowRight, Loader2, Plus,
  AlertTriangle, Truck, FileText, Clock,
} from 'lucide-react';
import WebsiteFooter from '../components/website/WebsiteFooter';
import TradeCartDrawer from '../components/website/TradeCartDrawer';
import WebsiteNav from '../components/website/WebsiteNav';
import useCart from '../hooks/useCart';

const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

export default function ShopPage() {
  const cart = useCart();
  const [products, setProducts] = useState([]);
  const [facets, setFacets] = useState({ categories: [], brands: [] });
  const [filters, setFilters] = useState({ q: '', category: '', brand: '' });
  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (filters.q) params.q = filters.q;
      if (filters.category) params.category = filters.category;
      if (filters.brand) params.brand = filters.brand;
      const { data } = await publicApi.get('/shop/products', { params });
      setProducts(data.products || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const t = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.category, filters.brand]);

  useEffect(() => {
    publicApi.get('/shop/facets').then(r => setFacets(r.data)).catch(() => {});
  }, []);

  return (
    <div className="bg-white font-body">
      <WebsiteNav extras={
        <button onClick={() => setCartOpen(true)}
          className="relative px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1.5 transition">
          <ShoppingCart size={14} /> Cart
          {cart.count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
              {cart.count > 99 ? '99+' : cart.count}
            </span>
          )}
        </button>
      } />

      {/* Hero */}
      <section className="pb-10 px-6 md:px-10 bg-gradient-to-br from-amber-50 via-white to-emerald-50">
        <div className="max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold mb-4">
            <Package size={11} /> Trade Shop · For NZ Electricians
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold font-display leading-tight mb-3">
            Solar parts for the trade.
          </h1>
          <p className="text-sm md:text-base text-gray-500 max-w-2xl mx-auto">
            Browse panels, inverters, batteries, racking, and accessories. Build a cart, request a quote — we reply with delivery-included pricing within one business day.
          </p>
        </div>
      </section>

      {/* Trust band */}
      <section className="py-6 px-6 md:px-10 border-y border-gray-100">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          <BandItem icon={Truck}    title="Delivery NZ-wide"   desc="Auckland to Bluff" />
          <BandItem icon={Clock}    title="Reply ≤ 1 day"      desc="Business days" />
          <BandItem icon={Package}  title="Tier-1 brands"      desc="Fronius, REC, Phono, Tesla" />
          <BandItem icon={FileText} title="GST tax invoice"    desc="On every order" />
        </div>
      </section>

      {/* Filters + grid */}
      <section className="py-10 px-6 md:px-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap gap-2 items-center mb-5">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
              <input
                value={filters.q}
                onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
                placeholder="Search SKU, name, brand…"
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:border-amber-400"
              />
            </div>
            <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs">
              <option value="">All categories</option>
              {facets.categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filters.brand} onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs">
              <option value="">All brands</option>
              {facets.brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <div className="ml-auto text-[11px] text-gray-400">
              {loading ? 'Loading…' : `${products.length} ${products.length === 1 ? 'product' : 'products'}`}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="animate-spin text-amber-500" size={28} /></div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No products match these filters. Try clearing them.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map(p => <ProductCard key={p.id} product={p} cart={cart} />)}
            </div>
          )}
        </div>
      </section>

      <TradeCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} />
      <WebsiteFooter />
    </div>
  );
}

function ProductCard({ product, cart }) {
  const [adding, setAdding] = useState(false);

  const handleAdd = (e) => {
    e.preventDefault(); e.stopPropagation();
    setAdding(true);
    cart.add(product, 1);
    setTimeout(() => setAdding(false), 600);
  };

  const isBackorder = product.stock_status === 'backorder';

  return (
    <Link to={product.sku ? `/shop/${product.sku}` : '#'}
      className="group bg-white rounded-xl border border-gray-100 hover:border-amber-300 hover:shadow-lg transition-all flex flex-col">
      <div className="aspect-[4/3] rounded-t-xl bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center overflow-hidden">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <Package size={36} className="text-amber-300" />
        )}
      </div>
      <div className="p-3 flex flex-col flex-1">
        <div className="text-[10px] text-gray-400 truncate mb-0.5">{product.brand || '—'}</div>
        <div className="text-xs font-semibold mb-1 line-clamp-2">{product.name}</div>
        {product.sku && <div className="text-[10px] font-mono text-gray-400 mb-1.5">SKU {product.sku}</div>}

        <div className="flex flex-wrap gap-1 mb-2">
          {product.specs?.wattage_w && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold">{product.specs.wattage_w}W</span>
          )}
          {isBackorder && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold flex items-center gap-0.5">
              <AlertTriangle size={9} /> Backorder
            </span>
          )}
          {product.moq > 1 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">MOQ {product.moq}</span>
          )}
        </div>

        <div className="mt-auto flex justify-between items-end gap-2 pt-2 border-t border-gray-50">
          <div>
            <div className="text-base font-extrabold text-amber-600">{fmt$(product.sell_incl_gst)}</div>
            <div className="text-[9px] text-gray-400">incl GST · per {product.unit || 'each'}</div>
          </div>
          <button onClick={handleAdd}
            className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[10px] font-bold flex items-center gap-1 transition disabled:opacity-50"
            disabled={adding}>
            {adding ? '✓' : <><Plus size={10} /> Add</>}
          </button>
        </div>
      </div>
    </Link>
  );
}

function BandItem({ icon: Icon, title, desc }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber-50 text-amber-600 mb-2">
        <Icon size={16} />
      </div>
      <div className="text-xs font-bold mb-0.5">{title}</div>
      <div className="text-[10px] text-gray-500">{desc}</div>
    </div>
  );
}

export function Nav({ cart, onOpenCart }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-4 md:px-10 h-16 flex items-center justify-between backdrop-blur-md shadow-lg shadow-black/20"
      style={{ background: 'linear-gradient(90deg, rgba(11,15,26,0.96) 0%, rgba(17,23,42,0.96) 50%, rgba(11,15,26,0.96) 100%)' }}>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500" />
      <Link to="/" className="flex items-center gap-3">
        <div className="bg-white rounded-xl p-1.5 shadow-lg ring-2 ring-amber-300/40">
          <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-9 md:h-11 w-auto object-contain" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-extrabold font-display tracking-tight text-white">GOLDENRAY <span className="text-amber-400">NZ</span></div>
          <div className="text-[9px] text-amber-200 italic">Sustainable Future</div>
        </div>
      </Link>
      <div className="flex items-center gap-3">
        <Link to="/" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300">Home</Link>
        <Link to="/solar-packages" className="hidden md:block text-xs font-semibold text-white/80 hover:text-amber-300">Packages</Link>
        <button onClick={onOpenCart}
          className="relative px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold flex items-center gap-1.5 transition">
          <ShoppingCart size={12} /> Cart
          {cart.count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
              {cart.count > 99 ? '99+' : cart.count}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
