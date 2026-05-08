import { useState, useEffect, useCallback } from 'react';

// Trade-shop cart, persisted in localStorage. Anonymous (no login required) —
// the cart only matters until the buyer submits a Request Quote.
//
// Stored shape (localStorage key 'gr_trade_cart'):
//   [{ product_id, sku, name, brand, qty, unit_sell_incl_gst }, ...]
//
// We deliberately don't trust the localStorage prices on submit — the server
// re-fetches and recomputes from the products table. The stored prices are
// only for showing the running subtotal in the UI.

const STORAGE_KEY = 'gr_trade_cart';

const readStorage = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStorage = (items) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
};

export default function useCart() {
  const [items, setItems] = useState(readStorage);

  // Cross-tab sync — if the user has the shop open in two tabs, both stay in step
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setItems(readStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Persist on every change
  useEffect(() => { writeStorage(items); }, [items]);

  const add = useCallback((product, qty = 1) => {
    setItems(prev => {
      const existing = prev.find(i => i.product_id === product.id);
      if (existing) {
        return prev.map(i => i.product_id === product.id ? { ...i, qty: i.qty + qty } : i);
      }
      return [
        ...prev,
        {
          product_id:         product.id,
          sku:                product.sku,
          name:               product.name,
          brand:              product.brand,
          qty,
          unit_sell_incl_gst: product.sell_incl_gst,
        },
      ];
    });
  }, []);

  const setQty = useCallback((productId, qty) => {
    if (qty < 1) qty = 1;
    setItems(prev => prev.map(i => i.product_id === productId ? { ...i, qty } : i));
  }, []);

  const remove = useCallback((productId) => {
    setItems(prev => prev.filter(i => i.product_id !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  // Subtotal, item count
  const subtotal = items.reduce((s, i) => s + (i.unit_sell_incl_gst || 0) * i.qty, 0);
  const count    = items.reduce((s, i) => s + i.qty, 0);

  return { items, add, setQty, remove, clear, subtotal, count };
}
