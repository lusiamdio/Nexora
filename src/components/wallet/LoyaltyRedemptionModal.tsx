import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowRightLeft, Ticket, Copy, Check, ShieldCheck } from 'lucide-react';
import { LoyaltyDiscountVoucher } from '../../types';
import { tokenizationService } from '../../lib/TokenizationService';
import { store } from '../../lib/store';
import { formatCurrency } from '../../lib/currencies';

interface LoyaltyRedemptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  defaultCurrency?: string;
  isDark: boolean;
  onRedeemed: () => void;
}

const SUPPORTED_CURRENCIES = ['ZAR', 'KES', 'NGN', 'GHS', 'RWF', 'USD'] as const;
const MIN_REDEEM_POINTS = 50;

export const LoyaltyRedemptionModal: React.FC<LoyaltyRedemptionModalProps> = ({
  isOpen,
  onClose,
  userEmail,
  defaultCurrency = 'ZAR',
  isDark,
  onRedeemed,
}) => {
  const [refreshTick, setRefreshTick] = useState(0);
  void refreshTick;

  const profile = tokenizationService.getUserLoyaltyProfile(userEmail);
  const availablePoints = profile.loyaltyPoints;
  const activeEvents = useMemo(
    () => store.getEvents().filter((ev) => ev.status === 'published'),
    []
  );

  const initialCurrency = SUPPORTED_CURRENCIES.includes(defaultCurrency as any)
    ? defaultCurrency
    : 'ZAR';

  const [currency, setCurrency] = useState<string>(initialCurrency);
  const [selectedEventId, setSelectedEventId] = useState<string>('all');
  const [pointsInput, setPointsInput] = useState<string>(() =>
    availablePoints >= MIN_REDEEM_POINTS ? String(Math.min(availablePoints, 250)) : String(MIN_REDEEM_POINTS)
  );
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestVoucher, setLatestVoucher] = useState<LoyaltyDiscountVoucher | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setLatestVoucher(null);
    const freshProfile = tokenizationService.getUserLoyaltyProfile(userEmail);
    setPointsInput(
      freshProfile.loyaltyPoints >= MIN_REDEEM_POINTS
        ? String(Math.min(freshProfile.loyaltyPoints, 250))
        : String(freshProfile.loyaltyPoints || MIN_REDEEM_POINTS)
    );
  }, [isOpen, userEmail]);

  if (!isOpen) return null;

  const vouchers = tokenizationService.getDiscountVouchersForEmail(userEmail);
  const numericPoints = Math.max(0, Math.floor(Number(pointsInput) || 0));
  const clampedPoints = Math.min(availablePoints, numericPoints);
  const convertedDiscountMinor = tokenizationService.convertPointsToCurrencyMinor(
    numericPoints,
    currency
  );
  const ratePer100PtsMinor = tokenizationService.convertPointsToCurrencyMinor(100, currency);
  const canRedeem =
    Boolean(userEmail) &&
    availablePoints >= MIN_REDEEM_POINTS &&
    numericPoints >= MIN_REDEEM_POINTS &&
    numericPoints <= availablePoints &&
    !isRedeeming;

  const handleEventChange = (eventId: string) => {
    setSelectedEventId(eventId);
    if (eventId !== 'all') {
      const evt = activeEvents.find((e) => e.id === eventId);
      if (evt && SUPPORTED_CURRENCIES.includes(evt.currency as any)) {
        setCurrency(evt.currency);
      }
    }
  };

  const handlePreset = (ratio: number) => {
    setError(null);
    if (availablePoints < MIN_REDEEM_POINTS) {
      setPointsInput(String(availablePoints));
      return;
    }
    const target = Math.max(MIN_REDEEM_POINTS, Math.floor(availablePoints * ratio));
    setPointsInput(String(Math.min(availablePoints, target)));
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(null), 1800);
  };

  const handleConfirmRedemption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRedeem) return;
    setError(null);
    setIsRedeeming(true);

    try {
      const targetEvent =
        selectedEventId !== 'all'
          ? activeEvents.find((ev) => ev.id === selectedEventId)
          : undefined;

      const res = await tokenizationService.redeemPointsForDiscountVoucher({
        email: userEmail,
        pointsToRedeem: numericPoints,
        currency,
        eventId: targetEvent?.id,
        eventTitle: targetEvent?.title,
      });

      if (!res.success || !res.voucher) {
        setError(res.error || 'Unable to convert loyalty points.');
        return;
      }

      // Register generated discount voucher in checkout promo store (single-use)
      store.createPromoCode({
        code: res.voucher.code,
        discountPercentage: 0,
        discountMinor: res.voucher.discountMinor,
        currency: res.voucher.currency,
        pointsSpent: res.voucher.pointsRedeemed,
        ownerEmail: res.voucher.email,
        maxUses: 1,
        eventId: res.voucher.eventId,
      });

      setLatestVoucher(res.voucher);
      const remaining = res.remainingPoints ?? 0;
      setPointsInput(
        remaining >= MIN_REDEEM_POINTS
          ? String(Math.min(remaining, 250))
          : String(remaining)
      );
      setRefreshTick((t) => t + 1);
      onRedeemed();
    } finally {
      setIsRedeeming(false);
    }
  };

  const modalSurface = isDark
    ? 'bg-[#0E0E12] text-white ring-1 ring-white/15'
    : 'bg-white text-black ring-1 ring-black/15';
  const subSurface = isDark ? 'bg-[#16161D]' : 'bg-neutral-100';
  const inputSurface = isDark
    ? 'bg-black text-white ring-1 ring-white/15 focus:ring-amber-400 focus:outline-none'
    : 'bg-white text-black ring-1 ring-black/15 focus:ring-black focus:outline-none';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loyalty-redemption-title"
    >
      <div className={`w-full max-w-lg rounded-3xl p-6 sm:p-7 space-y-5 max-h-[90vh] overflow-y-auto ${modalSurface}`}>
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id="loyalty-redemption-title" className="text-lg font-bold tracking-tight">
              Redeem Loyalty Points
            </h2>
            <p className="text-xs font-mono opacity-65">
              Convert accumulated tokenization points into instant event ticket discount vouchers.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close loyalty redemption modal"
            className={`p-2 rounded-xl cursor-pointer transition-colors ${
              isDark ? 'hover:bg-white/10 text-white/70' : 'hover:bg-black/10 text-black/70'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Overview Bar */}
        <div className={`p-4 rounded-2xl grid grid-cols-3 gap-3 ${subSurface}`}>
          <div>
            <span className="text-[11px] font-mono opacity-65 block">Available Points</span>
            <strong className="text-base font-mono tabular-nums text-amber-500">
              {availablePoints.toLocaleString()} pts
            </strong>
          </div>
          <div>
            <span className="text-[11px] font-mono opacity-65 block">Active Multiplier</span>
            <strong className="text-base font-mono tabular-nums text-emerald-500">
              {profile.pointsMultiplier.toFixed(2)}x
            </strong>
          </div>
          <div>
            <span className="text-[11px] font-mono opacity-65 block">Collector Tier</span>
            <strong className="text-base font-bold">{profile.tierLabel}</strong>
          </div>
        </div>

        {/* Real-Time Point-to-Currency Converter Form */}
        <form onSubmit={handleConfirmRedemption} className="space-y-4">
          <div className={`p-4 rounded-2xl space-y-4 ${subSurface}`}>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold inline-flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-500" />
                <span>Point-to-Currency Converter</span>
              </span>
              <span className="opacity-65 tabular-nums">
                100 pts = {formatCurrency(ratePer100PtsMinor, currency)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-7 space-y-1.5">
                <label htmlFor="redeem-points-input" className="block text-[11px] font-mono opacity-70">
                  Points to Convert (min {MIN_REDEEM_POINTS})
                </label>
                <input
                  id="redeem-points-input"
                  type="number"
                  min={MIN_REDEEM_POINTS}
                  max={Math.max(MIN_REDEEM_POINTS, availablePoints)}
                  value={pointsInput}
                  onChange={(e) => {
                    setError(null);
                    setPointsInput(e.target.value);
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono font-bold tabular-nums ${inputSurface}`}
                />
              </div>

              <div className="sm:col-span-5 space-y-1.5">
                <label htmlFor="redeem-currency-select" className="block text-[11px] font-mono opacity-70">
                  Voucher Currency
                </label>
                <select
                  id="redeem-currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono font-bold cursor-pointer ${inputSurface}`}
                >
                  {SUPPORTED_CURRENCIES.map((curr) => (
                    <option key={curr} value={curr}>
                      {curr}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interactive Slider + Quick Presets */}
            {availablePoints >= MIN_REDEEM_POINTS && (
              <div className="space-y-2">
                <input
                  type="range"
                  aria-label="Select loyalty points slider"
                  min={MIN_REDEEM_POINTS}
                  max={availablePoints}
                  step={10}
                  value={Math.max(MIN_REDEEM_POINTS, clampedPoints)}
                  onChange={(e) => {
                    setError(null);
                    setPointsInput(e.target.value);
                  }}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="opacity-60">Quick Select:</span>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: '25%', ratio: 0.25 },
                      { label: '50%', ratio: 0.5 },
                      { label: 'Max', ratio: 1.0 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handlePreset(preset.ratio)}
                        className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                          isDark
                            ? 'bg-white/10 hover:bg-white/20 text-white'
                            : 'bg-black/10 hover:bg-black/20 text-black'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Live Converted Value Output */}
            <div
              className={`pt-3 border-t flex items-center justify-between ${
                isDark ? 'border-white/10' : 'border-black/10'
              }`}
            >
              <span className="text-xs font-mono opacity-75">Converted Voucher Discount</span>
              <strong className="text-xl font-black font-mono tabular-nums text-emerald-500">
                {formatCurrency(convertedDiscountMinor, currency)}
              </strong>
            </div>
          </div>

          {/* Target Event Selector */}
          <div className="space-y-1.5">
            <label htmlFor="redeem-event-scope" className="block text-xs font-mono opacity-70">
              Valid For Future Event
            </label>
            <select
              id="redeem-event-scope"
              value={selectedEventId}
              onChange={(e) => handleEventChange(e.target.value)}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs cursor-pointer ${inputSurface}`}
            >
              <option value="all">Any Upcoming Event (Global Ticket Voucher)</option>
              {activeEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} ({ev.currency})
                </option>
              ))}
            </select>
          </div>

          {!userEmail && (
            <p className="text-xs font-mono text-amber-500">
              Sign in or hold an active ticket in your wallet to bind and redeem loyalty points.
            </p>
          )}

          {userEmail && availablePoints < MIN_REDEEM_POINTS && (
            <p className="text-xs font-mono opacity-70">
              Mint a digital ticket asset in your Ticket Vault to reach at least {MIN_REDEEM_POINTS} loyalty points for voucher conversion.
            </p>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/15 text-red-500 text-xs font-mono">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canRedeem}
            className={`w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isDark
                ? 'bg-amber-400 hover:bg-amber-300 text-black'
                : 'bg-black hover:bg-neutral-800 text-white'
            }`}
          >
            {isRedeeming
              ? 'Generating Discount Voucher...'
              : `Convert ${numericPoints.toLocaleString()} pts to ${formatCurrency(convertedDiscountMinor, currency)} Voucher`}
          </button>
        </form>

        {/* Newly Issued Voucher Confirmation */}
        {latestVoucher && (
          <div
            className={`p-4 rounded-2xl ring-1 space-y-2 ${
              isDark
                ? 'bg-emerald-500/10 ring-emerald-500/30 text-emerald-300'
                : 'bg-emerald-50 ring-emerald-300 text-emerald-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Discount Voucher Issued</span>
              </span>
              <span className="text-xs font-mono font-bold tabular-nums">
                {formatCurrency(latestVoucher.discountMinor, latestVoucher.currency)} off
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <code className="text-sm font-mono font-black tracking-wider">
                {latestVoucher.code}
              </code>
              <button
                type="button"
                onClick={() => handleCopyCode(latestVoucher.code)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:bg-emerald-400 whitespace-nowrap"
              >
                {copiedCode === latestVoucher.code ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] font-mono opacity-80">
              Apply this code during Checkout Step 1 under Promo or Voucher Code.
            </p>
          </div>
        )}

        {/* Saved Discount Vouchers List */}
        {vouchers.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <h3 className="text-xs font-mono uppercase tracking-wider opacity-65 flex items-center gap-1.5">
              <Ticket className="w-3.5 h-3.5" />
              <span>Your Ticket Discount Vouchers ({vouchers.length})</span>
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {vouchers.map((v) => (
                <div
                  key={v.id}
                  className={`p-3 rounded-xl flex items-center justify-between gap-3 text-xs font-mono ${subSurface}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="font-bold">{v.code}</strong>
                      <span className={v.used ? 'opacity-50' : 'text-emerald-500'}>
                        {v.used ? 'Used' : 'Active'}
                      </span>
                    </div>
                    <span className="text-[11px] opacity-65 block truncate">
                      {formatCurrency(v.discountMinor, v.currency)} off · {v.pointsRedeemed.toLocaleString()} pts
                      {v.eventTitle ? ` · ${v.eventTitle}` : ' · All events'}
                    </span>
                  </div>
                  {!v.used && (
                    <button
                      type="button"
                      onClick={() => handleCopyCode(v.code)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer shrink-0 ${
                        isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/10 hover:bg-black/20 text-black'
                      }`}
                    >
                      {copiedCode === v.code ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
