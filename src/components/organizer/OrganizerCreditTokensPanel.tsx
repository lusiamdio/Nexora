import React, { useState } from 'react';
import { Coins, CheckCircle2, Copy, Check, Download, Send, Ticket } from 'lucide-react';
import { Event } from '../../types';
import { store } from '../../lib/store';
import { formatCurrency } from '../../lib/currencies';
import { mintCreditTokensInSupabase, signCreditTokenPayload } from '../../lib/supabase';

interface OrganizerCreditTokensPanelProps {
  organizerId: string;
  events: Event[];
  currency: string;
  isDarkTheme: boolean;
  onNotification: (msg: string) => void;
}

export const OrganizerCreditTokensPanel: React.FC<OrganizerCreditTokensPanelProps> = ({
  organizerId,
  events,
  currency,
  isDarkTheme,
  onNotification,
}) => {
  const [refreshTick, setRefreshTick] = useState(0);
  void refreshTick;

  // Direct Attendee Grant State
  const [grantEmail, setGrantEmail] = useState('');
  const [grantName, setGrantName] = useState('');
  const [grantTokens, setGrantTokens] = useState('2500');
  const [grantNote, setGrantNote] = useState('');
  const [isMinting, setIsMinting] = useState(false);

  // Signed Voucher Creation State
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherTokens, setVoucherTokens] = useState('5000');
  const [voucherMaxUses, setVoucherMaxUses] = useState('50');
  const [voucherEventId, setVoucherEventId] = useState(events[0]?.id || '');
  const [isCreatingVoucher, setIsCreatingVoucher] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const summary = store.getOrganizerCreditSummary(organizerId);
  const vouchers = store.getCreditVouchers(organizerId);

  const cardSurface = isDarkTheme
    ? 'bg-[#111827] ring-1 ring-white/10 text-white'
    : 'bg-white ring-1 ring-black/10 text-black';
  const subSurface = isDarkTheme ? 'bg-[#1F2937]' : 'bg-[#F8F7F4]';
  const inputCls = isDarkTheme
    ? 'bg-black text-white ring-1 ring-white/15 focus:ring-amber-400 focus:outline-none'
    : 'bg-white text-black ring-1 ring-black/15 focus:ring-black focus:outline-none';

  const handleMintDirectCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMinting) return;
    setPanelError(null);

    const amount = Math.floor(Number(grantTokens) || 0);
    if (!grantEmail.trim() || amount <= 0) {
      setPanelError('Enter a valid attendee email and positive NXR token amount.');
      return;
    }

    setIsMinting(true);
    try {
      const signed = await signCreditTokenPayload({
        email: grantEmail.trim(),
        txType: 'mint_organizer_grant',
        tokensAmount: amount,
        currency,
        reference: `ORG-${organizerId.slice(0, 8).toUpperCase()}`,
      });

      const res = store.mintCreditTokens({
        email: grantEmail.trim(),
        displayName: grantName.trim() || 'Attendee',
        tokensAmount: amount,
        txType: 'mint_organizer_grant',
        currency,
        organizerId,
        tokenSignature: signed?.tokenSignature,
        description: grantNote.trim() || `Organizer loyalty grant (+${amount.toLocaleString()} NXR)`,
      });

      if (!res.success) {
        setPanelError(res.error || 'Failed to mint NXR loyalty credits.');
        return;
      }

      void mintCreditTokensInSupabase({
        email: grantEmail.trim(),
        tokensAmount: amount,
        txType: 'mint_organizer_grant',
        currency,
        displayName: grantName.trim() || 'Attendee',
        organizerId,
        tokenSignature: signed?.tokenSignature,
        description: grantNote.trim() || `Organizer loyalty grant (+${amount.toLocaleString()} NXR)`,
      });

      onNotification(`Minted +${amount.toLocaleString()} NXR Credits to ${grantEmail.trim()}.`);
      setGrantEmail('');
      setGrantName('');
      setGrantNote('');
      setRefreshTick(t => t + 1);
    } finally {
      setIsMinting(false);
    }
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingVoucher) return;
    setPanelError(null);

    const amount = Math.floor(Number(voucherTokens) || 0);
    const maxUses = Math.max(1, Math.floor(Number(voucherMaxUses) || 1));
    const cleanCode = voucherCode.trim().toUpperCase();
    if (cleanCode.length < 4 || amount <= 0) {
      setPanelError('Voucher code (4+ chars) and positive NXR token value are required.');
      return;
    }

    setIsCreatingVoucher(true);
    try {
      const signed = await signCreditTokenPayload({
        email: `voucher+${cleanCode}@nexora.events`,
        txType: 'mint_voucher',
        tokensAmount: amount,
        currency,
        reference: cleanCode,
      });

      const selectedEvt = events.find(ev => ev.id === voucherEventId);
      const res = store.createCreditVoucher({
        organizerId,
        code: cleanCode,
        tokensAmount: amount,
        currency,
        maxRedemptions: maxUses,
        eventId: selectedEvt?.id,
        eventTitle: selectedEvt?.title,
        tokenSignature: signed?.tokenSignature,
      });

      if (!res.success || !res.voucher) {
        setPanelError(res.error || 'Failed to issue credit voucher.');
        return;
      }

      onNotification(`Issued signed credit voucher ${res.voucher.code} (${amount.toLocaleString()} NXR).`);
      setVoucherCode('');
      setRefreshTick(t => t + 1);
    } finally {
      setIsCreatingVoucher(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(null), 1800);
  };

  return (
    <div className={`p-6 rounded-2xl space-y-6 ${cardSurface}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-500" />
            <h3 className="text-base font-bold">Cashless & Loyalty Credit Tokenization (NXR)</h3>
          </div>
          <p className="text-xs opacity-70">
            Mint HMAC-SHA256 signed NXR cashless & loyalty credits redeemable across ticket checkout and NFC bar wristbands. 100 NXR = 1.00 {currency}.
          </p>
        </div>

        <a
          href="/supabase_credit_tokens_migration.sql"
          download="supabase_credit_tokens_migration.sql"
          className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${subSurface}`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>SQL Migration</span>
        </a>
      </div>

      {/* Token Circulation KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
          <span className="text-[11px] font-mono opacity-65 block">NXR Minted</span>
          <strong className="text-lg font-mono tabular-nums block">
            {summary.totalMintedTokens.toLocaleString()} NXR
          </strong>
        </div>
        <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
          <span className="text-[11px] font-mono opacity-65 block">NXR Redeemed</span>
          <strong className="text-lg font-mono tabular-nums text-emerald-500 block">
            {summary.totalRedeemedTokens.toLocaleString()} NXR
          </strong>
        </div>
        <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
          <span className="text-[11px] font-mono opacity-65 block">Circulating Liability</span>
          <strong className="text-lg font-mono tabular-nums text-amber-500 block">
            {formatCurrency(summary.outstandingTokens, currency)}
          </strong>
        </div>
        <div className={`p-4 rounded-xl space-y-1 ${subSurface}`}>
          <span className="text-[11px] font-mono opacity-65 block">Active Vouchers</span>
          <strong className="text-lg font-mono tabular-nums block">
            {summary.activeVouchersCount}
          </strong>
        </div>
      </div>

      {panelError && (
        <div className="p-3 rounded-xl bg-red-500/10 text-red-500 text-xs font-mono">
          {panelError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form 1: Direct Attendee NXR Credit Grant */}
        <form onSubmit={handleMintDirectCredits} className={`p-5 rounded-xl space-y-3.5 ${subSurface}`}>
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-bold">Mint Attendee Loyalty Credits</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-mono opacity-70 mb-1">Attendee Email *</label>
              <input
                type="email"
                required
                value={grantEmail}
                onChange={e => setGrantEmail(e.target.value)}
                placeholder="fan@domain.com"
                className={`w-full px-3 py-2 rounded-lg text-xs ${inputCls}`}
              />
            </div>
            <div>
              <label className="block font-mono opacity-70 mb-1">Attendee Name</label>
              <input
                type="text"
                value={grantName}
                onChange={e => setGrantName(e.target.value)}
                placeholder="Optional name"
                className={`w-full px-3 py-2 rounded-lg text-xs ${inputCls}`}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-mono opacity-70 mb-1">NXR Tokens (100 = 1.00) *</label>
              <input
                type="number"
                min={10}
                required
                value={grantTokens}
                onChange={e => setGrantTokens(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-xs font-mono tabular-nums ${inputCls}`}
              />
            </div>
            <div>
              <label className="block font-mono opacity-70 mb-1">Reason / Campaign</label>
              <input
                type="text"
                value={grantNote}
                onChange={e => setGrantNote(e.target.value)}
                placeholder="VIP Early Bird Bonus"
                className={`w-full px-3 py-2 rounded-lg text-xs ${inputCls}`}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isMinting}
            className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 ${
              isDarkTheme ? 'bg-amber-400 hover:bg-amber-300 text-black' : 'bg-black hover:bg-neutral-800 text-white'
            }`}
          >
            {isMinting ? 'Signing & Minting...' : 'Mint Signed NXR Credits'}
          </button>
        </form>

        {/* Form 2: Issue Signed Credit Voucher Drop */}
        <form onSubmit={handleCreateVoucher} className={`p-5 rounded-xl space-y-3.5 ${subSurface}`}>
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-emerald-500" />
            <h4 className="text-sm font-bold">Issue Signed Credit Voucher</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-mono opacity-70 mb-1">Voucher Code *</label>
              <input
                type="text"
                required
                value={voucherCode}
                onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                placeholder="VIPBAR5000"
                className={`w-full px-3 py-2 rounded-lg text-xs font-mono uppercase ${inputCls}`}
              />
            </div>
            <div>
              <label className="block font-mono opacity-70 mb-1">NXR Value *</label>
              <input
                type="number"
                min={50}
                required
                value={voucherTokens}
                onChange={e => setVoucherTokens(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-xs font-mono tabular-nums ${inputCls}`}
              />
            </div>
            <div>
              <label className="block font-mono opacity-70 mb-1">Max Claims *</label>
              <input
                type="number"
                min={1}
                required
                value={voucherMaxUses}
                onChange={e => setVoucherMaxUses(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-xs font-mono tabular-nums ${inputCls}`}
              />
            </div>
          </div>
          {events.length > 0 && (
            <div className="text-xs">
              <label className="block font-mono opacity-70 mb-1">Associated Event</label>
              <select
                value={voucherEventId}
                onChange={e => setVoucherEventId(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg text-xs ${inputCls}`}
              >
                <option value="">All Organizer Events</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={isCreatingVoucher}
            className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 ${
              isDarkTheme ? 'bg-white hover:bg-neutral-200 text-black' : 'bg-black hover:bg-neutral-800 text-white'
            }`}
          >
            {isCreatingVoucher ? 'Signing Voucher...' : 'Create Redeemable Voucher'}
          </button>
        </form>
      </div>

      {/* Issued Vouchers Table */}
      {vouchers.length > 0 && (
        <div className="space-y-2.5">
          <h4 className="text-xs font-mono uppercase tracking-wider opacity-70">
            Issued Credit Vouchers ({vouchers.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className={`border-b font-mono opacity-60 ${isDarkTheme ? 'border-white/10' : 'border-black/10'}`}>
                <tr>
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Claims</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 text-right">Signature</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkTheme ? 'divide-white/10' : 'divide-black/10'}`}>
                {vouchers.map(v => (
                  <tr key={v.id}>
                    <td className="py-2.5 pr-4 font-mono font-bold">
                      <button
                        type="button"
                        onClick={() => handleCopyCode(v.code)}
                        className="inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80"
                      >
                        <span>{v.code}</span>
                        {copiedCode === v.code ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 opacity-60" />
                        )}
                      </button>
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">
                      {v.tokensAmount.toLocaleString()} NXR ({formatCurrency(v.tokensAmount, v.currency)})
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">
                      {v.redemptionsCount} / {v.maxRedemptions}
                    </td>
                    <td className="py-2.5 pr-4 opacity-75">
                      {v.eventTitle || 'All Events'}
                    </td>
                    <td className="py-2.5 text-right font-mono text-[11px] opacity-60">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        {v.tokenSignature.slice(0, 18)}...
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
