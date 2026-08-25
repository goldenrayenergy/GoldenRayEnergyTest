import { useState, useEffect, useRef } from 'react';
import { MapPin, CheckCircle, Loader2 } from 'lucide-react';

// NZ-only address autocomplete. Routes through our own /api/address/search
// proxy because Nominatim doesn't reliably set CORS headers and their usage
// policy requires a custom User-Agent (which browsers can't set).
// To swap providers later, edit server/routes/address.js — this component
// stays untouched.
//
// onSelect receives a structured address: { formatted, street, suburb, city, postcode }

const PROXY_URL = '/api/address/search';
const DEBOUNCE_MS = 350;
const MIN_QUERY = 4;

async function searchAddresses(query) {
  const res = await fetch(`${PROXY_URL}?q=${encodeURIComponent(query)}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`address proxy ${res.status}`);
  return res.json();
}

function parseSelection(item) {
  const a = item.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const suburb = a.suburb || a.neighbourhood || a.village || a.hamlet || '';
  const city = a.city || a.town || a.municipality || a.county || '';

  // Postcode: prefer the structured field, fall back to extracting a 4-digit
  // NZ postcode from display_name (OSM data is sometimes incomplete on the
  // structured side but consistent in the formatted string).
  //
  // Bug 2 fix (2026-08-24): validate the extracted value against the shared
  // NZ postcode range (0110-9893) so we never persist a 4-digit sequence
  // that isn't a real postcode. Also relaxed the country-suffix guard —
  // OSM display_name sometimes ends with just "New Zealand" without a
  // comma, sometimes with "NZ" only. Try both: the strict lookahead first
  // (highest confidence), then a looser 4-digit match near end-of-string
  // if that fails, then range-validate the result.
  let postcode = a.postcode || '';
  if (!postcode && item.display_name) {
    const strict = item.display_name.match(/\b(\d{4})\b(?=[,\s]+(?:New\s+Zealand|Aotearoa|NZ))/i);
    const loose  = strict ? null : item.display_name.match(/\b(\d{4})\b(?=[^\d]*$)/);
    postcode = (strict?.[1] || loose?.[1] || '');
  }
  // Range-validate: strip anything that's syntactically 4 digits but not a
  // real NZ postcode (0000-0109, 9894-9999). Better to return '' than a
  // fake value that downstream validators would accept.
  if (postcode) {
    const n = Number(postcode);
    if (!(n >= 110 && n <= 9893)) postcode = '';
  }

  return {
    formatted: item.display_name,
    street,
    suburb,
    city,
    postcode,
  };
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Start typing NZ address…',
  className = '',
}) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  // Debounced query — fires on every typed character once long enough
  useEffect(() => {
    if (verified) return;
    if (!value || value.length < MIN_QUERY) {
      setResults([]);
      setOpen(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchAddresses(value);
        setResults(data || []);
        setOpen(true);
        setHighlight(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [value, verified]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePick = (item) => {
    const parsed = parseSelection(item);
    onChange?.({ target: { name: 'address', value: parsed.formatted } });
    onSelect?.(parsed);
    setVerified(true);
    setOpen(false);
    setResults([]);
  };

  const handleInputChange = (e) => {
    setVerified(false);
    onChange?.(e);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); handlePick(results[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
      <input
        name="address"
        type="text"
        value={value || ''}
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
        className="w-full pl-8 pr-9 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition"
      />
      {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 animate-spin" />}
      {verified && !loading && (
        <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
          {results.map((item, i) => (
            <li
              key={item.place_id}
              onMouseDown={(e) => { e.preventDefault(); handlePick(item); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-2 cursor-pointer flex items-start gap-2 text-xs ${i === highlight ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
            >
              <MapPin size={11} className="mt-0.5 text-gray-400 flex-shrink-0" />
              <span className="text-gray-700">{item.display_name}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && value?.length >= MIN_QUERY && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-[11px] text-gray-400">
          No matches — keep typing or enter manually.
        </div>
      )}
    </div>
  );
}
