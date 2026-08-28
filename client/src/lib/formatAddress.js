// Format a Google Places / OSM formatted address for customer-facing
// display — keeps street + suburb + city, drops postcode + country.
//
// Fix (2026-08-27): the pre-fix code truncated with
//   formattedAddress.split(',')[0]
// which stripped everything after the street, so "7 Kent Street,
// Queenstown 9300, New Zealand" became just "7 Kent Street" — ambiguous
// (could be Kent Street in any NZ city). Customers looking at a quote
// couldn't visually verify they were seeing THEIR address.
//
// Google Places returns NZ addresses in one of these shapes:
//   "7 Kent Street, Queenstown 9300, New Zealand"          (3 parts)
//   "7 Kent Street, Fernhill, Queenstown 9300, New Zealand" (4 parts, has suburb)
//   "25 Commodore Drive, Lynfield, Auckland 1042, New Zealand"
//   "12 Waimea Road, Nelson South, Nelson 7010, New Zealand"
//
// Rule: drop the last part (country) + strip postcode from the second-
// to-last part (city+postcode). Return the rest joined with ", ".
//
// Non-throwing: bad input just returns the input unchanged.

export function formatAddressForDisplay(formattedAddress) {
  if (!formattedAddress || typeof formattedAddress !== 'string') return '';
  const parts = formattedAddress.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return formattedAddress;
  if (parts.length === 1) return parts[0];

  // Drop the country (last part, usually "New Zealand")
  const withoutCountry = parts.length >= 3 ? parts.slice(0, -1) : parts;

  // Strip trailing postcode (4 digits) from the last remaining part.
  // "Queenstown 9300" → "Queenstown", "Nelson 7010" → "Nelson", etc.
  const idxLast = withoutCountry.length - 1;
  withoutCountry[idxLast] = withoutCountry[idxLast]
    .replace(/\s+\d{4}\s*$/, '')
    .trim();

  return withoutCountry.filter(Boolean).join(', ');
}

// Short version — just street + city (skip suburb). Used where space is
// tight, e.g. sticky commit bar or tier card headings.
export function formatAddressShort(formattedAddress) {
  if (!formattedAddress || typeof formattedAddress !== 'string') return '';
  const parts = formattedAddress.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return formattedAddress;
  if (parts.length === 1) return parts[0];

  const street = parts[0];
  // Find the city part — second-to-last after dropping country, minus postcode
  const withoutCountry = parts.length >= 3 ? parts.slice(0, -1) : parts;
  const cityPart = withoutCountry[withoutCountry.length - 1]
    .replace(/\s+\d{4}\s*$/, '')
    .trim();

  return cityPart && cityPart !== street ? `${street}, ${cityPart}` : street;
}
