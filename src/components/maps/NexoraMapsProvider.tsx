import React, { createContext, useContext, useEffect, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';

interface MapsConfigContextValue {
  apiKey: string;
  isLoaded: boolean;
  isConfigured: boolean;
}

const MapsConfigContext = createContext<MapsConfigContextValue>({
  apiKey: '',
  isLoaded: false,
  isConfigured: false,
});

export function useMapsConfig(): MapsConfigContextValue {
  return useContext(MapsConfigContext);
}

let cachedRuntimeKey: string | null = null;
let pendingRuntimeFetch: Promise<string> | null = null;

async function resolveRuntimeMapsKey(): Promise<string> {
  const buildKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (buildKey && buildKey !== 'MY_GOOGLE_MAPS_API_KEY') {
    return buildKey;
  }
  if (cachedRuntimeKey !== null) {
    return cachedRuntimeKey;
  }
  if (!pendingRuntimeFetch) {
    pendingRuntimeFetch = fetch('/api/config/maps', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return '';
        const data = (await res.json()) as { apiKey?: string };
        const key = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
        cachedRuntimeKey = key;
        return key;
      })
      .catch(() => '')
      .finally(() => {
        pendingRuntimeFetch = null;
      });
  }
  return pendingRuntimeFetch;
}

/**
 * Tier 2 Demo Key Quota Exhaustion Detector:
 * Dispatches top-level 'gmp-quota-exceeded' event if a Maps REST/JS/WebComponent call
 * fails due to HTTP 429, RESOURCE_EXHAUSTED, OVER_QUERY_LIMIT, or OverQuotaMapError.
 */
export function reportMapsQuotaError(err: unknown, httpStatus?: number): void {
  if (httpStatus === 429) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    return;
  }
  const text =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === 'string'
        ? err
        : JSON.stringify(err || '');

  if (
    text.includes('RESOURCE_EXHAUSTED') ||
    text.includes('OVER_QUERY_LIMIT') ||
    text.includes('OverQuotaMapError') ||
    text.includes('QuotaExceededError') ||
    text.includes('429')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

export const NexoraMapsProvider: React.FC<{
  children: React.ReactNode;
  region?: string;
}> = ({ children, region = 'ZA' }) => {
  const initialBuildKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const hasBuildKey = Boolean(initialBuildKey && initialBuildKey !== 'MY_GOOGLE_MAPS_API_KEY');

  const [apiKey, setApiKey] = useState<string>(hasBuildKey ? initialBuildKey : '');
  const [isLoaded, setIsLoaded] = useState<boolean>(hasBuildKey);

  useEffect(() => {
    if (hasBuildKey) return;
    let active = true;
    void resolveRuntimeMapsKey().then((resolved) => {
      if (!active) return;
      setApiKey(resolved);
      setIsLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [hasBuildKey]);

  const isConfigured = Boolean(apiKey && apiKey !== 'MY_GOOGLE_MAPS_API_KEY');

  return (
    <MapsConfigContext.Provider value={{ apiKey, isLoaded, isConfigured }}>
      {isConfigured ? (
        <APIProvider
          apiKey={apiKey}
          libraries={['places', 'marker', 'routes', 'core']}
          language="en"
          region={region}
        >
          {children}
        </APIProvider>
      ) : (
        <>{children}</>
      )}
    </MapsConfigContext.Provider>
  );
};
