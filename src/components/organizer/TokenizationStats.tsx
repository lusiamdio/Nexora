import React, { useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ShieldCheck, Layers } from 'lucide-react';
import { Event, Ticket } from '../../types';
import { tokenizationService } from '../../lib/TokenizationService';

interface TokenizationStatsProps {
  events: Event[];
  tickets: Ticket[];
  isDarkTheme: boolean;
  defaultEventId?: string;
}

export const TokenizationStats: React.FC<TokenizationStatsProps> = ({
  events,
  tickets,
  isDarkTheme,
  defaultEventId = 'all',
}) => {
  const activeEvents = useMemo(
    () => events.filter((ev) => ev.status === 'published'),
    [events]
  );

  const [selectedEventId, setSelectedEventId] = useState<string>(defaultEventId);

  const distribution = useMemo(
    () => tokenizationService.getEventTokenizationDistribution(events, tickets, selectedEventId),
    [events, tickets, selectedEventId]
  );

  const chartData = useMemo(
    () => [
      {
        name: 'Tokenized Tickets',
        value: distribution.tokenizedCount,
        color: '#10B981',
      },
      {
        name: 'Standard Tickets',
        value: distribution.standardCount,
        color: isDarkTheme ? '#374151' : '#D1D5DB',
      },
    ],
    [distribution.tokenizedCount, distribution.standardCount, isDarkTheme]
  );

  const cardSurface = isDarkTheme
    ? 'bg-[#111827] ring-1 ring-white/10 text-white'
    : 'bg-white ring-1 ring-black/10 text-black';
  const subSurface = isDarkTheme ? 'bg-[#1F2937]' : 'bg-[#F8F7F4]';
  const selectCls = isDarkTheme
    ? 'bg-[#1F2937] text-white ring-1 ring-white/15 focus:outline-none focus:ring-emerald-400'
    : 'bg-[#F8F7F4] text-black ring-1 ring-black/15 focus:outline-none focus:ring-black';

  return (
    <section className={`p-6 rounded-2xl space-y-6 ${cardSurface}`}>
      {/* Header & Active Event Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <h3 className="text-base font-bold">Minted Token Distribution Across Active Events</h3>
          </div>
          <p className="text-xs opacity-70">
            Live breakdown of tickets converted into resale-protected digital assets versus standard issued passes.
          </p>
        </div>

        <div className="shrink-0">
          <select
            aria-label="Filter tokenization stats by active event"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className={`px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer ${selectCls}`}
          >
            <option value="all">All Active Events ({activeEvents.length})</option>
            {activeEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Donut Chart + Distribution Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Recharts Donut Chart */}
        <div className={`lg:col-span-5 p-4 rounded-xl ${subSurface}`}>
          {distribution.totalIssuedTickets === 0 ? (
            <div className="h-[240px] flex flex-col items-center justify-center text-center px-4 space-y-2">
              <Layers className="w-8 h-8 opacity-35" />
              <p className="text-xs font-semibold">No active event passes issued yet</p>
              <p className="text-[11px] opacity-65 max-w-xs">
                Once attendees purchase passes for an active event, tokenized vs. standard distribution will populate here.
              </p>
            </div>
          ) : (
            <div className="relative w-full h-[240px]">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={64}
                    outerRadius={92}
                    paddingAngle={distribution.tokenizedCount > 0 && distribution.standardCount > 0 ? 3 : 0}
                    stroke="none"
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => [
                      `${Number(value || 0).toLocaleString()} passes`,
                      String(name || ''),
                    ]}
                    contentStyle={{
                      backgroundColor: isDarkTheme ? '#0B0F19' : '#FFFFFF',
                      borderColor: isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
                      borderRadius: '10px',
                      fontSize: '12px',
                      color: isDarkTheme ? '#FFFFFF' : '#111827',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center Donut Metric Readout */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black font-mono tabular-nums text-emerald-500">
                  {distribution.tokenizationRatePct}%
                </span>
                <span className="text-[11px] font-mono opacity-70 tabular-nums">
                  {distribution.totalIssuedTickets.toLocaleString()} issued
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Summary KPIs + Legend */}
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
              <span className="text-[11px] font-mono opacity-65 block">Tokenized</span>
              <strong className="text-lg font-mono tabular-nums text-emerald-500 block">
                {distribution.tokenizedCount.toLocaleString()}
              </strong>
            </div>
            <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
              <span className="text-[11px] font-mono opacity-65 block">Standard</span>
              <strong className="text-lg font-mono tabular-nums block">
                {distribution.standardCount.toLocaleString()}
              </strong>
            </div>
            <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
              <span className="text-[11px] font-mono opacity-65 block">Mint Rate</span>
              <strong className="text-lg font-mono tabular-nums block">
                {distribution.tokenizationRatePct}%
              </strong>
            </div>
            <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
              <span className="text-[11px] font-mono opacity-65 block">Loyalty Points</span>
              <strong className="text-lg font-mono tabular-nums text-amber-500 block">
                {distribution.totalLoyaltyPointsAssigned.toLocaleString()} pts
              </strong>
            </div>
          </div>

          {/* Series Key Legend */}
          <div className="flex flex-wrap items-center gap-6 text-xs font-mono pt-1">
            {chartData.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="opacity-80">{item.name}:</span>
                <strong className="tabular-nums">{item.value.toLocaleString()}</strong>
              </div>
            ))}
          </div>

          {/* Per-Event Distribution Table */}
          {distribution.perEvent.length > 0 && (
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs">
                <thead className={`border-b font-mono opacity-60 ${isDarkTheme ? 'border-white/10' : 'border-black/10'}`}>
                  <tr>
                    <th className="py-2 pr-3">Active Event</th>
                    <th className="py-2 pr-3 text-right">Tokenized</th>
                    <th className="py-2 pr-3 text-right">Standard</th>
                    <th className="py-2 pr-3 text-right">Mint Rate</th>
                    <th className="py-2 text-right">Loyalty Pts</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDarkTheme ? 'divide-white/10' : 'divide-black/10'}`}>
                  {distribution.perEvent.map((row) => (
                    <tr key={row.eventId}>
                      <td className="py-2.5 pr-3 font-medium truncate max-w-[200px]">
                        {row.eventTitle}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-emerald-500 font-bold">
                        {row.tokenizedCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {row.standardCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {row.mintRatePct}%
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-amber-500 font-bold">
                        {row.mintedLoyaltyPoints.toLocaleString()} pts
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
