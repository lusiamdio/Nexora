import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin, Loader2, CheckCircle2 } from 'lucide-react';
import { useMapsConfig, reportMapsQuotaError } from './NexoraMapsProvider';

export interface ResolvedVenuePlace {
  name: string;
  address: string;
  city: string;
  country: string;
  coordinates?: { lat: number; lng: number };
}

interface VenuePlaceAutocompleteProps {
  onPlaceResolved: (place: ResolvedVenuePlace) => void;
  placeholder?: string;
}

/**
 * Modern Places API (New) Autocomplete component using:
 * - AutocompleteSessionToken
 * - AutocompleteSuggestion.fetchAutocompleteSuggestions
 * - Place.fetchFields
 */
export const VenuePlaceAutocomplete: React.FC<VenuePlaceAutocompleteProps> = ({
  onPlaceResolved,
  placeholder = 'Search verified venue or street address on Google Maps...',
}) => {
  const { isConfigured } = useMapsConfig();
  const placesLib = useMapsLibrary('places');

  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const resetSession = useCallback(() => {
    sessionTokenRef.current = null;
    setSuggestions([]);
  }, []);

  useEffect(() => {
    if (!isConfigured || !placesLib) return;
    const trimmed = inputValue.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken();
      }

      setIsLoading(true);
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmed,
        sessionToken: sessionTokenRef.current,
      })
        .then((res: { suggestions: google.maps.places.AutocompleteSuggestion[] }) => {
          if (cancelled) return;
          setSuggestions(res.suggestions || []);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          reportMapsQuotaError(err);
          setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isConfigured, placesLib, inputValue]);

  const handleSelectSuggestion = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    try {
      setIsLoading(true);
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'addressComponents'],
      });

      const components = place.addressComponents || [];
      const findComponent = (types: string[]) =>
        components.find((c: google.maps.places.AddressComponent) =>
          types.some((t) => c.types.includes(t))
        )?.longText || '';

      const city =
        findComponent(['locality', 'postal_town', 'administrative_area_level_2']) ||
        findComponent(['administrative_area_level_1']);
      const country = findComponent(['country']);

      const resolved: ResolvedVenuePlace = {
        name: place.displayName || prediction.text.text || inputValue,
        address: place.formattedAddress || prediction.text.text || '',
        city,
        country,
        coordinates: place.location
          ? { lat: place.location.lat(), lng: place.location.lng() }
          : undefined,
      };

      setResolvedLabel(resolved.name);
      setInputValue('');
      resetSession();
      onPlaceResolved(resolved);
    } catch (err: unknown) {
      reportMapsQuotaError(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConfigured) {
    return null;
  }

  return (
    <div className="relative space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          <span>Google Places Quick Lookup</span>
        </label>
        {resolvedLabel && (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span>Synced: {resolvedLabel}</span>
          </span>
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3.5 py-2.5 pr-9 rounded-xl bg-black/50 border border-amber-500/30 text-xs text-white placeholder-white/40 focus:outline-hidden focus:border-amber-400"
        />
        {isLoading && (
          <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {suggestions.length > 0 && (
        <ul className="absolute z-40 left-0 right-0 mt-1 rounded-xl bg-[#0F141C] border border-white/20 shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
          {suggestions.map((suggestion, index) => {
            const label = suggestion.placePrediction?.text.text;
            if (!label) return null;
            return (
              <li key={`${label}-${index}`}>
                <button
                  type="button"
                  onClick={() => void handleSelectSuggestion(suggestion)}
                  className="w-full text-left px-3.5 py-2.5 text-xs text-white/90 hover:bg-white/10 border-b border-white/5 last:border-b-0 flex items-center gap-2 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
