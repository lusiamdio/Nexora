import React, { useState } from 'react';
import { Globe, MapPin, Loader2, ExternalLink, Search, Compass, MessageSquareQuote } from 'lucide-react';

export interface MapsGroundingSource {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets?: string[];
}

export interface SearchGroundingSource {
  title: string;
  uri: string;
}

/**
 * XSS-safe lightweight Markdown block renderer (headings, bullet lists, inline **bold**).
 * Never uses dangerouslySetInnerHTML.
 */
function renderInlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const SafeMarkdownView: React.FC<{ markdown: string }> = ({ markdown }) => {
  const lines = markdown.split(/\r?\n/);

  return (
    <div className="space-y-2 text-xs sm:text-sm leading-relaxed">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div key={index} className="h-1" />;

        if (line.startsWith('### ')) {
          return (
            <h5 key={index} className="font-bold text-xs uppercase tracking-wider pt-2 opacity-90">
              {renderInlineBold(line.slice(4))}
            </h5>
          );
        }
        if (line.startsWith('## ') || line.startsWith('# ')) {
          const text = line.replace(/^#{1,3}\s+/, '');
          return (
            <h4 key={index} className="font-bold text-sm pt-2">
              {renderInlineBold(text)}
            </h4>
          );
        }
        if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
          const cleaned = line.replace(/^([-*]|\d+\.)\s+/, '');
          return (
            <div key={index} className="flex items-start gap-2 pl-1">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current opacity-60 shrink-0" />
              <span className="opacity-90">{renderInlineBold(cleaned)}</span>
            </div>
          );
        }
        return (
          <p key={index} className="opacity-90">
            {renderInlineBold(line)}
          </p>
        );
      })}
    </div>
  );
};

interface VenueMapsGroundingCardProps {
  venueName: string;
  city: string;
  country: string;
  coordinates?: { lat: number; lng: number };
  theme?: 'light' | 'dark';
  defaultFocus?: 'attendee_arrival' | 'nearby_dining_stays' | 'operations_safety';
}

export const VenueMapsGroundingCard: React.FC<VenueMapsGroundingCardProps> = ({
  venueName,
  city,
  country,
  coordinates,
  theme = 'dark',
  defaultFocus = 'attendee_arrival',
}) => {
  const isDark = theme === 'dark';
  const [focus, setFocus] = useState<'attendee_arrival' | 'nearby_dining_stays' | 'operations_safety'>(defaultFocus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [sources, setSources] = useState<MapsGroundingSource[]>([]);

  const handleRunMapsGrounding = async (selectedFocus: typeof focus) => {
    setFocus(selectedFocus);
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/ai/venue-maps-intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueName,
          city,
          country,
          focus: selectedFocus,
          lat: coordinates?.lat,
          lng: coordinates?.lng,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data.error || 'Unable to load Google Maps data briefing.');
        return;
      }
      setAnalysis(data.analysis || '');
      setSources(Array.isArray(data.sources) ? data.sources : []);
    } catch {
      setError('Network error while fetching Google Maps intelligence.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`p-5 rounded-2xl border space-y-4 ${
        isDark ? 'bg-black/40 border-white/10 text-white' : 'bg-white border-black/10 text-black'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider font-mono text-amber-400">
            <Compass className="w-4 h-4" />
            <span>Google Maps Venue & Area Guide</span>
          </div>
          <p className="text-xs opacity-65">
            Live Google Maps transit, parking, nearby hotels, and verified place links for {venueName}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRunMapsGrounding('attendee_arrival')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
              focus === 'attendee_arrival' && analysis
                ? 'bg-amber-400 text-black'
                : isDark
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-neutral-100 hover:bg-neutral-200 text-black'
            }`}
          >
            Arrival & Transit
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRunMapsGrounding('nearby_dining_stays')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 ${
              focus === 'nearby_dining_stays' && analysis
                ? 'bg-amber-400 text-black'
                : isDark
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-neutral-100 hover:bg-neutral-200 text-black'
            }`}
          >
            Nearby Dining & Stays
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs font-mono opacity-75 py-2">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
          <span>Querying live Google Maps place data...</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300 font-mono">
          {error}
        </div>
      )}

      {analysis && !loading && (
        <div className="space-y-4 pt-2 border-t border-white/10">
          <SafeMarkdownView markdown={analysis} />

          {sources.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-white/10">
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider opacity-70">
                Google Maps Verified Place Sources
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sources.map((src, idx) => (
                  <div
                    key={`${src.uri}-${idx}`}
                    className={`p-2.5 rounded-xl border space-y-1.5 ${
                      isDark ? 'bg-white/5 border-white/10' : 'bg-neutral-50 border-black/10'
                    }`}
                  >
                    <a
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:underline"
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{src.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                    {src.reviewSnippets && src.reviewSnippets.length > 0 && (
                      <div className="space-y-1">
                        {src.reviewSnippets.map((snippet, sIdx) => (
                          <div key={sIdx} className="flex items-start gap-1.5 text-[11px] opacity-75">
                            <MessageSquareQuote className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                            <span>{snippet}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface SearchIntelCardProps {
  initialQuery: string;
  category?: 'promoter' | 'event_news' | 'marketplace_pulse';
  title?: string;
  subtitle?: string;
  allowCustomQuery?: boolean;
  theme?: 'light' | 'dark';
}

export const SearchIntelCard: React.FC<SearchIntelCardProps> = ({
  initialQuery,
  category = 'event_news',
  title = 'Live Web & Search Intelligence',
  subtitle = 'Real-time artist, event updates, and official press citations powered by Google Search.',
  allowCustomQuery = true,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [sources, setSources] = useState<SearchGroundingSource[]>([]);

  const handleRunSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const target = query.trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/ai/search-intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: target, category }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data.error || 'Unable to retrieve Google Search intelligence.');
        return;
      }
      setAnalysis(data.analysis || '');
      setSources(Array.isArray(data.sources) ? data.sources : []);
    } catch {
      setError('Network error while contacting Google Search grounding endpoint.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`p-5 sm:p-6 rounded-2xl border space-y-4 ${
        isDark ? 'bg-[#0E0E12] border-white/10 text-white' : 'bg-neutral-50 border-black/10 text-black'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider font-mono text-emerald-400">
            <Globe className="w-4 h-4" />
            <span>{title}</span>
          </div>
          <p className="text-xs opacity-65">{subtitle}</p>
        </div>

        {!allowCustomQuery && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleRunSearch()}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50 ${
              isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
            }`}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>Check Live Web</span>
          </button>
        )}
      </div>

      {allowCustomQuery && (
        <form onSubmit={(e) => void handleRunSearch(e)} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about festival news, tour schedules, artists, or safety notices..."
            className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs focus:outline-hidden ${
              isDark
                ? 'bg-black/50 border-white/15 text-white placeholder-white/40 focus:border-white'
                : 'bg-white border-black/15 text-black placeholder-black/40 focus:border-black'
            }`}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50 ${
              isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
            }`}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>Search Live Web</span>
          </button>
        </form>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs font-mono opacity-75 py-1">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span>Retrieving real-time Google Search results...</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300 font-mono">
          {error}
        </div>
      )}

      {analysis && !loading && (
        <div className="space-y-4 pt-3 border-t border-white/10">
          <SafeMarkdownView markdown={analysis} />

          {sources.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-white/10">
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider opacity-70">
                Google Search Citations ({sources.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {sources.map((src, idx) => (
                  <a
                    key={`${src.uri}-${idx}`}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:underline ${
                      isDark
                        ? 'bg-white/5 border-white/15 text-emerald-300 hover:bg-white/10'
                        : 'bg-white border-black/15 text-emerald-700 hover:bg-neutral-100'
                    }`}
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    <span className="max-w-[260px] truncate">{src.title}</span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
