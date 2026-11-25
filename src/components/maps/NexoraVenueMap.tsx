import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
  useApiIsLoaded,
} from '@vis.gl/react-google-maps';
import { Navigation, MapPin, Loader2, ExternalLink, Compass, AlertTriangle } from 'lucide-react';
import { Event } from '../../types';
import { formatCurrency } from '../../lib/currencies';
import { useMapsConfig, reportMapsQuotaError } from './NexoraMapsProvider';

interface RouteSummary {
  distanceKm: string;
  durationMinutes: number;
}

interface VenueSingleMapProps {
  mode: 'single';
  venueName: string;
  venueAddress?: string;
  venueCity?: string;
  venueCountry?: string;
  coordinates?: { lat: number; lng: number };
  eventTitle?: string;
  heightClassName?: string;
  theme?: 'light' | 'dark';
  enableDirections?: boolean;
}

interface VenueCatalogMapProps {
  mode: 'catalog';
  events: Event[];
  onSelectEvent: (event: Event) => void;
  currentCurrency?: string;
  heightClassName?: string;
  theme?: 'light' | 'dark';
}

export type NexoraVenueMapProps = VenueSingleMapProps | VenueCatalogMapProps;

const MAPS_INTERNAL_ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];

const SingleEventMarker: React.FC<{
  position: { lat: number; lng: number };
  title: string;
  addressLabel: string;
  mapsHref: string;
  isDark: boolean;
}> = ({ position, title, addressLabel, mapsHref, isDark }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(true);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        title={title}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Pin
          background={isDark ? '#F59E0B' : '#111827'}
          borderColor={isDark ? '#78350F' : '#000000'}
          glyphColor={isDark ? '#000000' : '#FFFFFF'}
          scale={1.15}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={() => setOpen(false)}>
          <div className="p-1 text-black space-y-1">
            <div className="font-bold text-xs leading-snug">{title}</div>
            {addressLabel && <div className="text-[11px] text-neutral-600">{addressLabel}</div>}
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline pt-0.5"
            >
              <span>Open in Google Maps</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const CatalogEventMarker: React.FC<{
  event: Event;
  isSelected: boolean;
  onSelectMarker: () => void;
  onOpenEvent: (event: Event) => void;
  onCloseInfo: () => void;
  currency: string;
}> = ({ event, isSelected, onSelectMarker, onOpenEvent, onCloseInfo, currency }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const coords = event.venue.coordinates;
  if (!coords) return null;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={coords}
        title={`${event.title} — ${event.venue.city}`}
        onClick={onSelectMarker}
      >
        <Pin
          background={isSelected ? '#10B981' : '#F59E0B'}
          borderColor="#111827"
          glyphColor="#000000"
          scale={isSelected ? 1.25 : 1.0}
        />
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={270} onCloseClick={onCloseInfo}>
          <div className="p-1 text-black space-y-2">
            <div className="space-y-0.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                {event.category}
              </div>
              <div className="font-bold text-xs leading-snug">{event.title}</div>
              <div className="text-[11px] text-neutral-600">
                {event.venue.name}, {event.venue.city}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-neutral-200">
              <span className="font-mono font-bold text-xs">
                From {formatCurrency(event.minPriceMinor, currency || event.currency)}
              </span>
              <button
                type="button"
                onClick={() => onOpenEvent(event)}
                className="px-2.5 py-1 rounded-md bg-black text-white text-[11px] font-bold hover:bg-neutral-800 cursor-pointer"
              >
                View Event
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const RouteOverlayController: React.FC<{
  origin: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  travelMode: 'DRIVING' | 'WALKING' | 'TRANSIT';
  onRouteComputed: (summary: RouteSummary | null) => void;
  onRouteError: (msg: string | null) => void;
  onLoadingChange: (loading: boolean) => void;
}> = ({ origin, destination, travelMode, onRouteComputed, onRouteError, onLoadingChange }) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!map || !routesLib || !origin || !destination) {
      onRouteComputed(null);
      return;
    }

    let cancelled = false;
    onLoadingChange(true);
    onRouteError(null);

    const request = {
      origin,
      destination,
      travelMode,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    const RouteClass = routesLib.Route as unknown as {
      computeRoutes: (req: typeof request) => Promise<{
        routes?: Array<{
          createPolylines: () => google.maps.Polyline[];
          viewport?: google.maps.LatLngBounds;
          distanceMeters?: number;
          durationMillis?: number;
        }>;
      }>;
    };

    RouteClass.computeRoutes(request)
      .then((res) => {
        if (cancelled) return;
        const primaryRoute = res.routes?.[0];
        if (!primaryRoute) {
          onRouteComputed(null);
          onRouteError('No route found between your location and this venue.');
          return;
        }

        const newPolylines = primaryRoute.createPolylines();
        newPolylines.forEach((polyline) => {
          polyline.setOptions({
            strokeColor: '#F59E0B',
            strokeWeight: 5,
            strokeOpacity: 0.9,
          });
          polyline.setMap(map);
        });
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }

        const distanceKm = ((primaryRoute.distanceMeters ?? 0) / 1000).toFixed(1);
        const durationMinutes = Math.max(1, Math.round((primaryRoute.durationMillis ?? 0) / 60000));
        onRouteComputed({ distanceKm, durationMinutes });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportMapsQuotaError(err);
        onRouteComputed(null);
        onRouteError(
          err instanceof Error
            ? err.message
            : 'Unable to calculate route. Please check your network or try Google Maps.'
        );
      })
      .finally(() => {
        if (!cancelled) onLoadingChange(false);
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, origin, destination, travelMode, onRouteComputed, onRouteError, onLoadingChange]);

  return null;
};

const VenueTextGeocoder: React.FC<{
  query: string;
  shouldResolve: boolean;
  onResolved: (coords: { lat: number; lng: number } | null) => void;
}> = ({ query, shouldResolve, onResolved }) => {
  const placesLib = useMapsLibrary('places');

  useEffect(() => {
    if (!shouldResolve || !placesLib || !query.trim()) return;
    let active = true;

    const PlaceClass = placesLib.Place as unknown as {
      searchByText?: (req: {
        textQuery: string;
        fields: string[];
        maxResultCount?: number;
      }) => Promise<{ places?: Array<{ location?: google.maps.LatLng }> }>;
    };

    if (!PlaceClass?.searchByText) return;

    PlaceClass.searchByText({
      textQuery: query,
      fields: ['location', 'displayName'],
      maxResultCount: 1,
    })
      .then((res) => {
        if (!active) return;
        const loc = res.places?.[0]?.location;
        if (loc) {
          onResolved({ lat: loc.lat(), lng: loc.lng() });
        }
      })
      .catch((err: unknown) => {
        reportMapsQuotaError(err);
      });

    return () => {
      active = false;
    };
  }, [placesLib, query, shouldResolve, onResolved]);

  return null;
};

const CatalogBoundsController: React.FC<{
  positions: Array<{ lat: number; lng: number }>;
  focusPosition: { lat: number; lng: number } | null;
}> = ({ positions, focusPosition }) => {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map) return;
    if (focusPosition) {
      map.panTo(focusPosition);
      map.setZoom(12);
      return;
    }
    if (positions.length === 1) {
      map.panTo(positions[0]);
      map.setZoom(13);
      return;
    }
    if (positions.length > 1 && coreLib?.LatLngBounds) {
      const bounds = new coreLib.LatLngBounds();
      positions.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 48);
    }
  }, [map, coreLib, positions, focusPosition]);

  return null;
};

export const NexoraVenueMap: React.FC<NexoraVenueMapProps> = (props) => {
  const { isLoaded: configLoaded, isConfigured } = useMapsConfig();
  const isApiLoaded = useApiIsLoaded();
  const isDark = (props.theme || 'dark') === 'dark';
  const heightClass = props.heightClassName || 'h-[340px] sm:h-[400px]';

  // Single-mode state
  const singleCoordsProp = props.mode === 'single' ? props.coordinates : undefined;
  const [resolvedCoords, setResolvedCoords] = useState<{ lat: number; lng: number } | null>(
    singleCoordsProp || null
  );
  const [userOrigin, setUserOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [travelMode, setTravelMode] = useState<'DRIVING' | 'WALKING' | 'TRANSIT'>('DRIVING');
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  // Catalog-mode state
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [catalogUserFocus, setCatalogUserFocus] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (props.mode === 'single') {
      setResolvedCoords(props.coordinates || null);
      setRouteSummary(null);
      setRouteError(null);
    }
  }, [props.mode, props.mode === 'single' ? props.venueName : '', singleCoordsProp?.lat, singleCoordsProp?.lng]);

  const handleRequestDirections = useCallback(() => {
    if (!navigator.geolocation) {
      setRouteError('Geolocation is not supported by this browser.');
      return;
    }
    setGeoLoading(true);
    setRouteError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        setUserOrigin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setGeoLoading(false);
        setRouteError('Location permission denied. Allow location access to calculate transit time.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const handleNearMeCatalog = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        setCatalogUserFocus({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const catalogEventsWithCoords = useMemo(() => {
    if (props.mode !== 'catalog') return [];
    return props.events.filter(
      (e) =>
        e.venue?.coordinates &&
        typeof e.venue.coordinates.lat === 'number' &&
        typeof e.venue.coordinates.lng === 'number'
    );
  }, [props]);

  const catalogPositions = useMemo(
    () =>
      catalogEventsWithCoords.map((e) => ({
        lat: e.venue.coordinates!.lat,
        lng: e.venue.coordinates!.lng,
      })),
    [catalogEventsWithCoords]
  );

  if (!configLoaded) {
    return (
      <div
        className={`w-full ${heightClass} rounded-2xl border flex items-center justify-center gap-2 text-xs font-mono ${
          isDark ? 'bg-black/40 border-white/10 text-white/60' : 'bg-neutral-100 border-black/10 text-black/60'
        }`}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Initializing Google Maps Platform...</span>
      </div>
    );
  }

  if (!isConfigured) {
    const queryLabel =
      props.mode === 'single'
        ? [props.venueName, props.venueAddress, props.venueCity, props.venueCountry]
            .filter(Boolean)
            .join(', ')
        : 'Events across Africa';
    const externalUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryLabel)}`;

    return (
      <div
        className={`w-full rounded-2xl border p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
          isDark ? 'bg-black/40 border-white/15 text-white' : 'bg-neutral-100 border-black/15 text-black'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold">
            <MapPin className="w-4 h-4 text-amber-400" />
            <span>Interactive Map Requires Google Maps API Key</span>
          </div>
          <p className="text-xs opacity-70 font-mono">
            Add <code className="px-1 py-0.5 rounded bg-white/10">VITE_GOOGLE_MAPS_API_KEY</code> in Settings &gt; Secrets to activate embedded maps and routing.
          </p>
        </div>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shrink-0 ${
            isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
          }`}
        >
          <span>Open in Google Maps</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  if (props.mode === 'single') {
    const queryStr = [props.venueName, props.venueAddress, props.venueCity, props.venueCountry]
      .filter(Boolean)
      .join(', ');
    const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryStr)}`;
    const activeCoords = resolvedCoords || { lat: -33.9249, lng: 18.4241 };

    return (
      <div className="space-y-3">
        <div
          className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border ${
            isDark ? 'border-white/15 bg-[#0A0A0D]' : 'border-black/15 bg-neutral-100'
          }`}
        >
          {!isApiLoaded && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 text-white text-xs font-mono gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading Google Map...</span>
            </div>
          )}

          <GoogleMap
            mapId="DEMO_MAP_ID"
            center={activeCoords}
            defaultZoom={resolvedCoords ? 15 : 11}
            gestureHandling="greedy"
            disableDefaultUI={false}
            internalUsageAttributionIds={MAPS_INTERNAL_ATTRIBUTION_IDS}
            style={{ width: '100%', height: '100%' }}
          >
            <VenueTextGeocoder
              query={queryStr}
              shouldResolve={!props.coordinates && !resolvedCoords}
              onResolved={setResolvedCoords}
            />

            {resolvedCoords && (
              <SingleEventMarker
                position={resolvedCoords}
                title={props.venueName}
                addressLabel={[props.venueAddress, props.venueCity].filter(Boolean).join(', ')}
                mapsHref={mapsHref}
                isDark={isDark}
              />
            )}

            {userOrigin && (
              <AdvancedMarker position={userOrigin} title="Your Location">
                <Pin background="#3B82F6" borderColor="#1E3A8A" glyphColor="#FFFFFF" scale={0.95} />
              </AdvancedMarker>
            )}

            {props.enableDirections !== false && (
              <RouteOverlayController
                origin={userOrigin}
                destination={resolvedCoords}
                travelMode={travelMode}
                onRouteComputed={setRouteSummary}
                onRouteError={setRouteError}
                onLoadingChange={setRouteLoading}
              />
            )}
          </GoogleMap>
        </div>

        {props.enableDirections !== false && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRequestDirections}
                disabled={geoLoading || routeLoading || !resolvedCoords}
                className={`px-3.5 py-2 rounded-xl font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
                  isDark
                    ? 'bg-white text-black hover:bg-neutral-200'
                    : 'bg-black text-white hover:bg-neutral-800'
                }`}
              >
                {geoLoading || routeLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Navigation className="w-3.5 h-3.5" />
                )}
                <span>{userOrigin ? 'Refresh Route' : 'Route from My Location'}</span>
              </button>

              {userOrigin && (
                <div
                  className={`inline-flex items-center rounded-xl p-0.5 border ${
                    isDark ? 'bg-black/50 border-white/15' : 'bg-white border-black/15'
                  }`}
                >
                  {(['DRIVING', 'WALKING', 'TRANSIT'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTravelMode(m)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold cursor-pointer ${
                        travelMode === m
                          ? isDark
                            ? 'bg-white text-black'
                            : 'bg-black text-white'
                          : 'opacity-65 hover:opacity-100'
                      }`}
                    >
                      {m === 'DRIVING' ? 'Drive' : m === 'WALKING' ? 'Walk' : 'Transit'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {routeSummary && (
              <div
                className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold border ${
                  isDark
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {routeSummary.distanceKm} km · ~{routeSummary.durationMinutes} min ({travelMode.toLowerCase()})
              </div>
            )}
          </div>
        )}

        {routeError && (
          <div className="flex items-center gap-2 text-xs text-amber-400 font-mono">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{routeError}</span>
          </div>
        )}
      </div>
    );
  }

  // Catalog Multi-Event Map View
  const defaultCenter = catalogPositions[0] || { lat: -15.0, lng: 25.0 };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-mono opacity-75">
          Showing {catalogEventsWithCoords.length} geolocated event
          {catalogEventsWithCoords.length === 1 ? '' : 's'} on Google Maps
        </div>
        <button
          type="button"
          onClick={handleNearMeCatalog}
          disabled={geoLoading}
          className={`px-3 py-1.5 rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer border ${
            isDark
              ? 'bg-[#101012] border-white/20 text-white hover:border-white/40'
              : 'bg-neutral-100 border-black/15 text-black hover:border-black/40'
          }`}
        >
          {geoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
          <span>Center Near Me</span>
        </button>
      </div>

      <div
        className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border ${
          isDark ? 'border-white/15 bg-[#0A0A0D]' : 'border-black/15 bg-neutral-100'
        }`}
      >
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={defaultCenter}
          defaultZoom={4}
          gestureHandling="greedy"
          internalUsageAttributionIds={MAPS_INTERNAL_ATTRIBUTION_IDS}
          style={{ width: '100%', height: '100%' }}
        >
          <CatalogBoundsController positions={catalogPositions} focusPosition={catalogUserFocus} />

          {catalogUserFocus && (
            <AdvancedMarker position={catalogUserFocus} title="Your Location">
              <Pin background="#3B82F6" borderColor="#1E3A8A" glyphColor="#FFFFFF" scale={1.0} />
            </AdvancedMarker>
          )}

          {catalogEventsWithCoords.map((evt) => (
            <CatalogEventMarker
              key={evt.id}
              event={evt}
              isSelected={selectedEventId === evt.id}
              onSelectMarker={() => setSelectedEventId(evt.id)}
              onCloseInfo={() => setSelectedEventId(null)}
              onOpenEvent={props.onSelectEvent}
              currency={props.currentCurrency || evt.currency}
            />
          ))}
        </GoogleMap>
      </div>
    </div>
  );
};
