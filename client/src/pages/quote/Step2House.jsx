// Step2House — the merged 5-step flow's address confirmation step (B1.3, 2026-08-20).
//
// Two-panel screen:
//   • LEFT — Google-Places autocomplete search input (reuses POC's PlacesAutocomplete).
//   • RIGHT — Leaflet satellite map with draggable pin (reuses POC's PreviewStage).
//
// R1 (bill-address pre-populate): if Step 1 extracted an address from the
// customer's uploaded bill, we seed the search input with it so the customer
// doesn't retype. They still get to drag the pin to the exact house.
//
// PreviewStage is over-scoped for this step (also renders analysis overlay
// when analysing=true) — we deliberately pass analysing=false and null
// pending/error so it degenerates into a pure map+confirm picker. The actual
// roof analysis happens in Step 3 (B1.4). Phase E will extract just the
// map+drag concerns into a smaller shared component.

import { useState, useEffect, useCallback } from 'react';
import { PlacesAutocomplete, PreviewStage } from '../poc/QuotePage.jsx';

/**
 * Step2House — controlled component. Advances to Step 3 once the customer
 * confirms an address on the map.
 *
 * @param {object}   props
 * @param {object}   [props.usage]          — carried from Step 1; may hold extractedAddress
 * @param {object}   [props.address]        — currently-picked address, if returning from Step 3
 * @param {function} props.onChange         — replace address state
 * @param {function} props.onContinue       — advance to Step 3
 * @param {function} props.onBack           — return to Step 1
 */
export default function Step2House({ usage, address, onChange, onContinue, onBack }) {
  // Confirmed place = Google Places result (has lat/lng/place_id). Seeded
  // from the address state if we're returning to this step after having
  // already picked one, otherwise from Step 1's extractedAddress hint.
  const [confirmedPlace, setConfirmedPlace] = useState(address || null);

  // If Step 1 extracted an address AND the customer hasn't picked anything yet,
  // seed the input with the extracted string so they see instant recognition.
  // The autocomplete will re-search on any keystroke, so this is UX only —
  // no state coupling once the customer interacts.
  const initialQuery = confirmedPlace?.formattedAddress
    || usage?.extractedAddress
    || '';

  // When PlacesAutocomplete confirms, we're at the "address search done" stage.
  // PreviewStage takes over: shows the map, lets the customer drag the pin.
  // The FINAL confirmation (with pin position) comes from PreviewStage's
  // onConfirm(pin) callback below.
  const handlePlaceConfirmed = useCallback((place) => {
    setConfirmedPlace(place);
    onChange(place);
  }, [onChange]);

  // Once the customer clicks "Confirm this is my house" in the PreviewStage
  // map, we advance. The pin position (may differ from the geocoded coord)
  // rides along in our address state so Step 3 can use it for roof analysis.
  const handleFinalConfirm = useCallback((pin) => {
    const finalAddress = {
      ...confirmedPlace,
      latitude:  pin.lat,
      longitude: pin.lng,
      pinAdjusted: (pin.lat !== confirmedPlace.latitude || pin.lng !== confirmedPlace.longitude),
    };
    onChange(finalAddress);
    onContinue();
  }, [confirmedPlace, onChange, onContinue]);

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-[#D9531E] font-semibold">
        Step 2 &middot; Your house
      </div>
      <h2 className="font-serif text-3xl md:text-4xl mt-3 tracking-tight text-[#1A1614]">
        {usage?.extractedAddress
          ? 'Confirm this is your address.'
          : 'Where do you live?'}
      </h2>
      <p className="mt-2 text-[#55504A] max-w-2xl">
        {usage?.extractedAddress
          ? 'We pulled this from your bill. Confirm or edit — then drag the pin onto your actual house on the map.'
          : "Start typing your address. We'll show it on satellite and you can drag the pin onto your actual roof."}
      </p>

      {/* Autocomplete search */}
      <div className="mt-6 max-w-2xl">
        <PlacesAutocomplete
          initial={initialQuery}
          confirmedPlace={confirmedPlace}
          onConfirm={handlePlaceConfirmed}
        />
      </div>

      {/* Map + drag pin — only after an address is picked */}
      {confirmedPlace && (
        <div className="mt-6">
          <PreviewStage
            place={confirmedPlace}
            analysing={false}
            analysisError={null}
            pendingAnalysis={null}
            onSeeResults={undefined}
            onConfirm={handleFinalConfirm}
            onBack={onBack}
          />
        </div>
      )}

      {/* If no address picked yet, still show a Back button so the customer
          can retreat to Step 1 (usage) without touching the autocomplete. */}
      {!confirmedPlace && (
        <div className="mt-10 pt-6 border-t border-[#E3D9C4]">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[#E3D9C4] hover:bg-[#F4EEE1] text-sm text-[#55504A]"
          >
            &larr; Back to your usage
          </button>
        </div>
      )}
    </div>
  );
}
