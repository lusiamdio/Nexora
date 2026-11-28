import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft,
  Calendar, 
  MapPin, 
  Printer, 
  Share2, 
  Check, 
  UserCheck, 
  Clock, 
  RotateCcw,
  Search,
  Send,
  Download,
  ExternalLink,
  Coins,
  Ticket as TicketIcon,
  Radio,
  Timer,
  Zap,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import QRCode from 'qrcode';
import { Ticket, RefundRequest, AuthUser, TokenizedTicketAsset } from '../../types';
import { store } from '../../lib/store';
import { tokenizationService } from '../../lib/TokenizationService';
import { formatCurrency, formatEventDate } from '../../lib/currencies';
import { CashlessTerminalModal } from '../cashless/CashlessTerminalModal';
import { LoyaltyRedemptionModal } from './LoyaltyRedemptionModal';
import {
  claimCreditVoucherInSupabase,
  signCreditTokenPayload,
  transferCreditTokensInSupabase,
} from '../../lib/supabase';

interface TicketCardProps {
  ticket: Ticket;
  qrCodeUrl?: string;
  isDark: boolean;
  asset: TokenizedTicketAsset | null;
  isMinting: boolean;
  onMintAsset: (ticket: Ticket) => void;
  onTransfer: (ticket: Ticket) => void;
  onRefund: (ticket: Ticket) => void;
}

export const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  qrCodeUrl,
  isDark,
  asset,
  isMinting,
  onMintAsset,
  onTransfer,
  onRefund,
}) => {
  const [showAssetProof, setShowAssetProof] = useState(false);
  const isUsed = ticket.status === 'checked_in';
  const isRefunded = ticket.status === 'refunded';
  const isTokenized = Boolean(asset && asset.status !== 'revoked');
  const isRevoked = asset?.status === 'revoked';

  return (
    <div
      className={`p-6 sm:p-8 rounded-3xl space-y-6 transition-all ${
        isDark ? 'bg-[#0E0E12]' : 'bg-neutral-50'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="text-[11px] font-mono uppercase tracking-wider opacity-60 block">
            {ticket.tierName}
          </span>
          <h3 className="font-bold text-base leading-tight font-mono tabular-nums">
            {ticket.ticketCode}
          </h3>
        </div>

        <span
          className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg uppercase whitespace-nowrap shrink-0 ${
            isRefunded
              ? 'bg-red-500/20 text-red-400'
              : isUsed
                ? 'bg-neutral-500/20 text-neutral-400'
                : 'bg-emerald-500/20 text-emerald-400'
          }`}
        >
          {ticket.status === 'checked_in' ? 'Used' : ticket.status}
        </span>
      </div>

      {/* Tokenization Status Row */}
      <div
        className={`flex items-center justify-between gap-2 pb-3 border-b ${
          isDark ? 'border-white/10' : 'border-black/10'
        }`}
      >
        <span className="text-[11px] font-mono opacity-65">Tokenization Status</span>
        {isTokenized ? (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold whitespace-nowrap shrink-0 ${
              isDark
                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Tokenized Asset</span>
          </span>
        ) : isRevoked ? (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold whitespace-nowrap shrink-0 ${
              isDark
                ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                : 'bg-red-50 text-red-700 ring-1 ring-red-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Asset Revoked</span>
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold whitespace-nowrap shrink-0 ${
              isDark
                ? 'bg-white/5 text-white/70 ring-1 ring-white/15'
                : 'bg-black/5 text-black/70 ring-1 ring-black/15'
            }`}
          >
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span>Not Tokenized</span>
          </span>
        )}
      </div>

      {/* QR Presentation Box */}
      <div className="p-4 bg-white rounded-2xl flex items-center justify-center">
        {qrCodeUrl ? (
          <img
            src={qrCodeUrl}
            alt={ticket.ticketCode}
            className={`w-48 h-48 object-contain ${
              isUsed || isRefunded ? 'opacity-30 grayscale' : ''
            }`}
          />
        ) : (
          <div className="w-48 h-48 flex items-center justify-center text-xs text-black font-mono">
            Generating QR...
          </div>
        )}
      </div>

      {/* Pass Metadata */}
      <div className="space-y-2 text-xs font-mono">
        <div className="flex justify-between gap-2">
          <span className="opacity-60">Attendee:</span>
          <span className="font-bold truncate">{ticket.attendeeName}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="opacity-60">Price Paid:</span>
          <span className="tabular-nums">{formatCurrency(ticket.priceMinor, ticket.currency)}</span>
        </div>
        {ticket.checkedInAt && (
          <div className="flex justify-between gap-2 text-neutral-400">
            <span>Checked In:</span>
            <span className="tabular-nums">{new Date(ticket.checkedInAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {/* Digital Asset Protection & Loyalty Details */}
      {isTokenized && asset && (
        <div
          className={`pt-3 border-t space-y-2 text-xs font-mono ${
            isDark ? 'border-white/10' : 'border-black/10'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-60">Asset ID:</span>
            <span className="font-bold tabular-nums">{asset.tokenId}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-60">Resale Cap:</span>
            <span className="tabular-nums text-emerald-500">
              {formatCurrency(asset.resaleProtection.maxResalePriceMinor, asset.currency)} ({asset.resaleProtection.maxResaleMultiplierPct}%)
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-60">Loyalty Boost:</span>
            <span className="tabular-nums text-amber-500">
              {asset.loyaltyTracking.pointsMultiplier}x NXR
              {asset.loyaltyTracking.attendanceVerified ? ' · Verified' : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAssetProof(prev => !prev)}
            className={`w-full pt-1.5 flex items-center justify-between text-[11px] font-bold cursor-pointer transition-opacity hover:opacity-80 ${
              isDark ? 'text-white/75' : 'text-black/75'
            }`}
          >
            <span>{showAssetProof ? 'Hide Asset Proof' : 'View Asset Proof'}</span>
            {showAssetProof ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showAssetProof && (
            <div className={`pt-2 space-y-1.5 text-[11px] opacity-75 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <div className="flex justify-between gap-2">
                <span>Network:</span>
                <span>{asset.network}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Contract:</span>
                <span className="truncate max-w-[165px]">{asset.contractAddress}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>SHA-256 Hash:</span>
                <span className="truncate max-w-[165px]">{asset.metadataHash}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Transfers:</span>
                <span className="tabular-nums">{asset.resaleProtection.transferCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mint Digital Asset CTA when eligible */}
      {!isTokenized && !isRevoked && !isRefunded && (
        <div className={`pt-3 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
          <button
            type="button"
            disabled={isMinting}
            onClick={() => onMintAsset(ticket)}
            className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap ${
              isDark
                ? 'bg-amber-400 hover:bg-amber-300 text-black'
                : 'bg-black hover:bg-neutral-800 text-white'
            }`}
          >
            {isMinting ? 'Minting Digital Asset...' : 'Mint Digital Asset (+150 NXR)'}
          </button>
        </div>
      )}

      {/* Pass Actions: Transfer & Refund */}
      {!isUsed && !isRefunded && (
        <div
          className={`pt-4 border-t flex items-center gap-2 ${
            isDark ? 'border-white/10' : 'border-black/10'
          }`}
        >
          <button
            type="button"
            onClick={() => onTransfer(ticket)}
            className={`flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
              isDark
                ? 'bg-[#18181C] hover:bg-[#222228] text-white'
                : 'bg-neutral-200 hover:bg-neutral-300 text-black'
            }`}
          >
            Transfer Pass
          </button>
          <button
            type="button"
            onClick={() => onRefund(ticket)}
            className="px-3 py-2 rounded-lg text-xs font-mono text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors whitespace-nowrap"
          >
            Refund
          </button>
        </div>
      )}
    </div>
  );
};


interface TicketWalletPageProps {
  tickets: Ticket[];
  currentUser?: AuthUser | null;
  onBack: () => void;
  onRefresh: () => void;
  onExploreEvents: () => void;
  theme?: 'light' | 'dark';
}

export const TicketWalletPage: React.FC<TicketWalletPageProps> = ({
  tickets,
  currentUser,
  onBack,
  onRefresh,
  onExploreEvents,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';

  // Real-time user filtering: if a user is logged in, display only their own tickets
  const userTickets = currentUser?.email
    ? tickets.filter(t => t.attendeeEmail.toLowerCase() === currentUser.email.toLowerCase())
    : tickets;

  const [qrCodeUrls, setQrCodeUrls] = useState<Record<string, string>>({});
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(userTickets[0] || null);
  
  // Transfer state
  const [transferModalTicket, setTransferModalTicket] = useState<Ticket | null>(null);
  const [transferName, setTransferName] = useState('');
  const [transferEmail, setTransferEmail] = useState('');
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Refund state
  const [refundModalTicket, setRefundModalTicket] = useState<Ticket | null>(null);
  const [refundReason, setRefundReason] = useState('Schedule conflict — Unable to attend');
  const [refundCustomNote, setRefundCustomNote] = useState('');
  const [refundFeedback, setRefundFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Filter tabs & Credit Vault View
  const [walletTab, setWalletTab] = useState<'passes' | 'credits'>('passes');
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'checked_in' | 'refunded'>('all');
  const [searchRef, setSearchRef] = useState('');
  const [isCashlessOpen, setIsCashlessOpen] = useState(false);

  // Cashless & Loyalty Credit Token Vault State
  const [creditTick, setCreditTick] = useState(0);
  const [voucherCodeInput, setVoucherCodeInput] = useState('');
  const [voucherFeedback, setVoucherFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [transferCreditEmail, setTransferCreditEmail] = useState('');
  const [transferCreditAmount, setTransferCreditAmount] = useState('');
  const [transferCreditNote, setTransferCreditNote] = useState('');
  const [creditTransferFeedback, setCreditTransferFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [wristbandConvertTokens, setWristbandConvertTokens] = useState('');
  const [wristbandConvertFeedback, setWristbandConvertFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mintingTicketId, setMintingTicketId] = useState<string | null>(null);
  const [tokenizationFeedback, setTokenizationFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isRedemptionOpen, setIsRedemptionOpen] = useState(false);

  const effectiveEmail = currentUser?.email || userTickets[0]?.attendeeEmail || '';
  const effectiveName = currentUser?.name || userTickets[0]?.attendeeName || '';

  const activeWaitlistClaim = effectiveEmail
    ? store.getActiveClaimForUser(effectiveEmail)
    : null;

  void creditTick;
  const creditWallet = store.getCreditWalletForEmail(
    effectiveEmail,
    effectiveName || 'Attendee',
    userTickets[0]?.currency || store.getSelectedCurrency() || 'ZAR'
  );
  const creditTransactions = store.getCreditTransactionsForEmail(effectiveEmail);
  const tierProgress = store.getNextLoyaltyTierInfo(creditWallet.lifetimeMintedTokens);
  const cashbackRatePct = (store.getLoyaltyCashbackRate(creditWallet.loyaltyTier) * 100).toFixed(1);
  const pairedWristband = effectiveEmail ? store.getWristbandForAttendee(effectiveEmail) : undefined;
  const loyaltyProfile = tokenizationService.getUserLoyaltyProfile(effectiveEmail);

  useEffect(() => {
    async function genQRs() {
      const urls: Record<string, string> = {};
      for (const t of userTickets) {
        try {
          urls[t.id] = await QRCode.toDataURL(t.qrPayload, {
            width: 320,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' },
          });
        } catch (err) {
          console.error(err);
        }
      }
      setQrCodeUrls(urls);
    }
    genQRs();
    if (!selectedTicket && userTickets.length > 0) {
      setSelectedTicket(userTickets[0]);
    } else if (selectedTicket && !userTickets.some(t => t.id === selectedTicket.id)) {
      setSelectedTicket(userTickets[0] || null);
    }
  }, [userTickets]);

  const filteredTickets = userTickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (searchRef.trim()) {
      const query = searchRef.toLowerCase();
      const codeMatches = t.ticketCode.toLowerCase().includes(query);
      const nameMatches = t.attendeeName.toLowerCase().includes(query);
      const tierMatches = t.tierName.toLowerCase().includes(query);
      return codeMatches || nameMatches || tierMatches;
    }
    return true;
  });

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);
    if (!transferModalTicket || !transferName.trim() || !transferEmail.trim()) return;

    const res = store.transferTicket(transferModalTicket.id, transferName.trim(), transferEmail.trim());
    if (!res.success) {
      setTransferError(res.error || 'Unable to complete ticket transfer.');
      return;
    }

    setTransferSuccess(true);
    setTimeout(() => {
      setTransferSuccess(false);
      setTransferModalTicket(null);
      setTransferName('');
      setTransferEmail('');
      setTransferError(null);
      onRefresh();
    }, 1800);
  };

  const handleRefundSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundModalTicket) return;

    const combinedReason = refundCustomNote ? `${refundReason}: ${refundCustomNote}` : refundReason;
    const res = store.requestRefund(refundModalTicket.id, combinedReason);
    setRefundFeedback({
      success: res.success,
      msg: res.success ? `Refund request submitted for ${refundModalTicket.ticketCode}.` : (res.error || 'Failed to submit refund request'),
    });
    setTimeout(() => {
      setRefundFeedback(null);
      if (res.success) {
        setRefundModalTicket(null);
        setRefundCustomNote('');
        onRefresh();
      }
    }, 2000);
  };

  const handleClaimVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setVoucherFeedback(null);
    if (!effectiveEmail) {
      setVoucherFeedback({ ok: false, msg: 'Sign in first so NXR Credits can be bound to your account.' });
      return;
    }
    const res = store.claimCreditVoucher({
      code: voucherCodeInput,
      email: effectiveEmail,
      displayName: effectiveName,
    });
    if (!res.success || !res.voucher) {
      setVoucherFeedback({ ok: false, msg: res.error || 'Unable to claim credit voucher.' });
      return;
    }
    setVoucherCodeInput('');
    setCreditTick(t => t + 1);
    setVoucherFeedback({
      ok: true,
      msg: `Claimed +${res.voucher.tokensAmount.toLocaleString()} NXR Credits from voucher ${res.voucher.code}.`,
    });
    void claimCreditVoucherInSupabase({
      code: res.voucher.code,
      email: effectiveEmail,
      displayName: effectiveName,
    });
  };

  const handleTransferCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreditTransferFeedback(null);
    if (!effectiveEmail) {
      setCreditTransferFeedback({ ok: false, msg: 'Sign in first to transfer NXR Credits.' });
      return;
    }
    const amount = Math.floor(Number(transferCreditAmount) || 0);
    const res = store.transferCreditTokens({
      fromEmail: effectiveEmail,
      toEmail: transferCreditEmail,
      tokensAmount: amount,
      note: transferCreditNote || undefined,
    });
    if (!res.success) {
      setCreditTransferFeedback({ ok: false, msg: res.error || 'Credit transfer failed.' });
      return;
    }
    const cleanRecipient = transferCreditEmail.trim().toLowerCase();
    const noteText = transferCreditNote.trim();
    setTransferCreditEmail('');
    setTransferCreditAmount('');
    setTransferCreditNote('');
    setCreditTick(t => t + 1);
    setCreditTransferFeedback({
      ok: true,
      msg: `Transferred ${amount.toLocaleString()} NXR Credits to ${cleanRecipient}.`,
    });
    void signCreditTokenPayload({
      email: cleanRecipient,
      txType: 'transfer_in',
      tokensAmount: amount,
      currency: creditWallet.currency,
      reference: `P2P-${Date.now().toString(36).toUpperCase()}`,
    });
    void transferCreditTokensInSupabase({
      fromEmail: effectiveEmail,
      toEmail: cleanRecipient,
      tokensAmount: amount,
      note: noteText || undefined,
    });
  };

  const handleConvertCreditsToWristband = (e: React.FormEvent) => {
    e.preventDefault();
    setWristbandConvertFeedback(null);
    if (!pairedWristband || !effectiveEmail) {
      setWristbandConvertFeedback({
        ok: false,
        msg: 'Pair an NFC wristband in the Cashless Terminal first.',
      });
      return;
    }
    const amount = Math.floor(Number(wristbandConvertTokens) || 0);
    const res = store.convertCreditsToWristband({
      email: effectiveEmail,
      wristbandUid: pairedWristband.uid,
      tokensAmount: amount,
    });
    setWristbandConvertFeedback({ ok: res.success, msg: res.message });
    if (res.success) {
      setWristbandConvertTokens('');
      setCreditTick(t => t + 1);
    }
  };

  const handleMintTicketAsset = async (ticket: Ticket) => {
    if (mintingTicketId) return;
    setTokenizationFeedback(null);
    setMintingTicketId(ticket.id);
    try {
      const res = await tokenizationService.mintTicketAsset(ticket);
      if (!res.success || !res.asset) {
        setTokenizationFeedback({
          ok: false,
          msg: res.error || `Unable to mint digital asset for ${ticket.ticketCode}.`,
        });
        return;
      }

      if (res.loyaltyBonusTokens > 0) {
        const signed = await signCreditTokenPayload({
          email: ticket.attendeeEmail,
          txType: 'mint_organizer_grant',
          tokensAmount: res.loyaltyBonusTokens,
          currency: ticket.currency,
          reference: res.asset.tokenId,
        });
        const associatedEvent = store.getEventById(ticket.eventId);
        store.mintCreditTokens({
          email: ticket.attendeeEmail,
          displayName: ticket.attendeeName,
          tokensAmount: res.loyaltyBonusTokens,
          txType: 'mint_organizer_grant',
          currency: ticket.currency,
          eventId: ticket.eventId,
          organizerId: associatedEvent?.organizer.id,
          tokenSignature: signed?.tokenSignature,
          description: `Digital ticket tokenization bonus for ${ticket.ticketCode} (${res.asset.tokenId})`,
        });
      }

      setCreditTick(t => t + 1);
      setTokenizationFeedback({
        ok: true,
        msg: res.alreadyMinted
          ? `Pass ${ticket.ticketCode} is already tokenized (${res.asset.tokenId}).`
          : `Minted digital asset ${res.asset.tokenId} for ${ticket.ticketCode} (+${res.loyaltyPointsAwarded} Loyalty Points at ${res.loyaltyMultiplier.toFixed(2)}x${res.loyaltyBonusTokens > 0 ? ` · +${res.loyaltyBonusTokens} NXR` : ''}).`,
      });
    } finally {
      setMintingTicketId(null);
    }
  };

  return (
    <div className={`min-h-screen transition-colors ${
      isDark ? 'bg-black text-white' : 'bg-white text-black'
    }`}>
      
      {/* Top Breadcrumb Header */}
      <div className={`sticky top-18 z-30 w-full transition-colors ${
        isDark ? 'bg-black/95 text-white' : 'bg-white/95 text-black'
      }`}>
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          
          <button
            onClick={onBack}
            className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-opacity cursor-pointer ${
              isDark ? 'text-white hover:opacity-75' : 'text-black hover:opacity-75'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Marketplace</span>
          </button>

          <div className="flex items-center gap-2 font-mono text-xs opacity-60">
            <span>{userTickets.length} Digital {userTickets.length === 1 ? 'Pass' : 'Passes'} Vaulted</span>
          </div>

        </div>
      </div>

      {/* Main Container */}
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">

        {/* Page Title & View Switcher */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
              {walletTab === 'passes' ? 'My Ticket Vault' : 'NXR Cashless & Loyalty Credits'}
            </h1>
            <p className="text-xs sm:text-sm font-mono opacity-60">
              {walletTab === 'passes'
                ? 'Cryptographically verified admission passes with sub-second gate validation.'
                : 'Tokenized loyalty cashback, signed event vouchers, and NFC wristband cashless balances.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Segmented Tab Control: Passes vs NXR Credits */}
            <div className={`flex items-center gap-1 p-1 rounded-xl ${
              isDark ? 'bg-[#101014]' : 'bg-neutral-100'
            }`}>
              <button
                type="button"
                onClick={() => setWalletTab('passes')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
                  walletTab === 'passes'
                    ? (isDark ? 'bg-white text-black shadow-xs' : 'bg-black text-white shadow-xs')
                    : (isDark ? 'text-white/60 hover:text-white' : 'text-black/60 hover:text-black')
                }`}
              >
                Admission Passes ({userTickets.length})
              </button>
              <button
                type="button"
                onClick={() => setWalletTab('credits')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                  walletTab === 'credits'
                    ? (isDark ? 'bg-amber-400 text-black shadow-xs' : 'bg-black text-white shadow-xs')
                    : (isDark ? 'text-white/60 hover:text-white' : 'text-black/60 hover:text-black')
                }`}
              >
                <Coins className="w-3.5 h-3.5" />
                <span>NXR Credits ({creditWallet.balanceTokens.toLocaleString()})</span>
              </button>
            </div>

            <button
              onClick={() => setIsCashlessOpen(true)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-bold rounded-xl transition-all cursor-pointer border shadow-xs whitespace-nowrap ${
                isDark
                  ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
              }`}
              title="Open Cashless RFID Wristband Terminal"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cashless Wristband (NFC)</span>
            </button>

            {walletTab === 'passes' && (
              <>
                <div className={`flex items-center px-3 py-2 rounded-xl text-xs ${
                  isDark ? 'bg-[#101014] text-white' : 'bg-neutral-100 text-black'
                }`}>
                  <Search className="w-3.5 h-3.5 opacity-50 mr-2" />
                  <input
                    type="text"
                    value={searchRef}
                    onChange={e => setSearchRef(e.target.value)}
                    placeholder="Filter by code or name..."
                    className="bg-transparent focus:outline-none w-44 font-mono text-xs"
                  />
                </div>

                <div className={`flex items-center gap-1 p-1 rounded-xl ${
                  isDark ? 'bg-[#101014]' : 'bg-neutral-100'
                }`}>
                  {(['all', 'valid', 'checked_in', 'refunded'] as const).map(statusKey => (
                    <button
                      key={statusKey}
                      onClick={() => setStatusFilter(statusKey)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg capitalize cursor-pointer transition-colors ${
                        statusFilter === statusKey
                          ? (isDark ? 'bg-white text-black shadow-xs' : 'bg-black text-white shadow-xs')
                          : (isDark ? 'text-white/60 hover:text-white' : 'text-black/60 hover:text-black')
                      }`}
                    >
                      {statusKey === 'valid' ? 'Active' : statusKey === 'checked_in' ? 'Used' : statusKey}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* User Wallet Profile: Loyalty Points & Tokenization Multiplier */}
        <div
          className={`p-5 sm:p-6 rounded-2xl ring-1 grid grid-cols-1 md:grid-cols-4 gap-4 items-center ${
            isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
          }`}
        >
          <div className="space-y-0.5 md:col-span-1">
            <span className="text-[11px] font-mono uppercase tracking-wider opacity-60 block">
              Wallet Profile
            </span>
            <strong className="text-sm font-bold block truncate">
              {effectiveName || 'Attendee'}
            </strong>
            <span className="text-xs font-mono opacity-65 block truncate">
              {effectiveEmail || 'Sign in to bind points'}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-mono opacity-60 block">Loyalty Points</span>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-xl font-black font-mono tabular-nums text-amber-500">
                {loyaltyProfile.loyaltyPoints.toLocaleString()} pts
              </div>
              <button
                type="button"
                onClick={() => setIsRedemptionOpen(true)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  isDark
                    ? 'bg-amber-400 hover:bg-amber-300 text-black'
                    : 'bg-black hover:bg-neutral-800 text-white'
                }`}
              >
                Redeem Points
              </button>
            </div>
            <span className="text-[11px] font-mono opacity-65 block">
              {loyaltyProfile.tierLabel} Collector Tier
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[11px] font-mono opacity-60 block">Points Multiplier</span>
            <div className="text-xl font-black font-mono tabular-nums text-emerald-500">
              {loyaltyProfile.pointsMultiplier.toFixed(2)}x
            </div>
            <span className="text-[11px] font-mono opacity-65 block">
              Boosts on multi-pass & check-in
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[11px] font-mono opacity-60 block">Tokenized Assets</span>
            <div className="text-xl font-black font-mono tabular-nums">
              {loyaltyProfile.tokenizedTicketCount} / {userTickets.length}
            </div>
            <span className="text-[11px] font-mono opacity-65 block">
              {loyaltyProfile.verifiedAttendanceCount} attendance verified
            </span>
          </div>
        </div>

        {/* ACTIVE WAITLIST CLAIM ALERT BANNER */}
        {activeWaitlistClaim && (
          <div className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in shadow-lg ${
            isDark ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}>
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-amber-400 text-black flex items-center justify-center font-bold shrink-0 shadow-md">
                <Zap className="w-6 h-6" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">
                    Priority Waitlist Unlock Active
                  </span>
                </div>
                <h3 className="font-bold text-sm sm:text-base">
                  A ticket has been released for {activeWaitlistClaim.eventTitle}!
                </h3>
                <p className="text-xs opacity-75 font-mono">
                  Your 2-hour exclusive booking window is ticking. Secure your admission pass before reallocation.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                window.location.href = `/?claimToken=${activeWaitlistClaim.claimToken}`;
              }}
              className="px-5 py-2.5 rounded-xl text-xs font-mono font-extrabold uppercase tracking-wider bg-amber-400 text-black hover:bg-amber-300 transition-all cursor-pointer whitespace-nowrap shadow-md self-start sm:self-center"
            >
              Claim Pass Now
            </button>
          </div>
        )}


        {/* ========================================================= */}
        {/* TAB 2: NXR CASHLESS & LOYALTY CREDIT VAULT                */}
        {/* ========================================================= */}
        {walletTab === 'credits' && (
          <div className="space-y-8">
            {/* Credit KPI Summary Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className={`p-6 rounded-2xl ring-1 space-y-1.5 ${
                isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
              }`}>
                <span className="text-xs font-mono opacity-60 block">Available Balance</span>
                <div className="text-2xl font-black font-mono tabular-nums text-amber-500">
                  {creditWallet.balanceTokens.toLocaleString()} NXR
                </div>
                <span className="text-xs font-mono opacity-75 block tabular-nums">
                  = {formatCurrency(creditWallet.balanceTokens, creditWallet.currency)} redeemable
                </span>
              </div>

              <div className={`p-6 rounded-2xl ring-1 space-y-1.5 ${
                isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
              }`}>
                <span className="text-xs font-mono opacity-60 block">Loyalty Tier & Points</span>
                <div className="text-2xl font-black tracking-tight tabular-nums">
                  {creditWallet.loyaltyTier} · {loyaltyProfile.loyaltyPoints.toLocaleString()} pts
                </div>
                <span className="text-xs font-mono text-emerald-500 block tabular-nums">
                  {loyaltyProfile.pointsMultiplier.toFixed(2)}x tokenization multiplier · {cashbackRatePct}% cashback
                </span>
              </div>

              <div className={`p-6 rounded-2xl ring-1 space-y-1.5 ${
                isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
              }`}>
                <span className="text-xs font-mono opacity-60 block">Lifetime Minted</span>
                <div className="text-2xl font-black font-mono tabular-nums">
                  {creditWallet.lifetimeMintedTokens.toLocaleString()} NXR
                </div>
                <span className="text-xs font-mono opacity-60 block">
                  {tierProgress.nextTier
                    ? `${tierProgress.tokensRemaining.toLocaleString()} NXR to ${tierProgress.nextTier}`
                    : 'Maximum tier reached'}
                </span>
              </div>

              <div className={`p-6 rounded-2xl ring-1 space-y-1.5 ${
                isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
              }`}>
                <span className="text-xs font-mono opacity-60 block">Lifetime Redeemed</span>
                <div className="text-2xl font-black font-mono tabular-nums">
                  {creditWallet.lifetimeRedeemedTokens.toLocaleString()} NXR
                </div>
                <span className="text-xs font-mono opacity-60 block">
                  Checkout, NFC & P2P transfers
                </span>
              </div>
            </div>

            {/* Tier Progress Bar */}
            <div className={`p-5 rounded-2xl ring-1 space-y-2.5 ${
              isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
            }`}>
              <div className="flex items-center justify-between text-xs font-mono">
                <span>
                  Tier Progression: <strong>{tierProgress.currentTier}</strong>
                  {tierProgress.nextTier ? ` → ${tierProgress.nextTier}` : ' (Top Tier)'}
                </span>
                <span className="tabular-nums font-bold">{tierProgress.progressPct}%</span>
              </div>
              <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${tierProgress.progressPct}%` }}
                />
              </div>
            </div>

            {/* Three Credit Utility Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 1. Claim Signed Credit Voucher */}
              <form
                onSubmit={handleClaimVoucher}
                className={`p-6 rounded-2xl ring-1 space-y-4 ${
                  isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
                }`}
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-bold">Claim Credit Voucher</h3>
                  <p className="text-xs font-mono opacity-60">
                    Redeem a signed organizer or festival NXR credit drop code.
                  </p>
                </div>
                <input
                  type="text"
                  value={voucherCodeInput}
                  onChange={e => setVoucherCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g. VIPBAR5000"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-mono uppercase focus:outline-none ring-1 ${
                    isDark ? 'bg-black text-white ring-white/15' : 'bg-white text-black ring-black/15'
                  }`}
                />
                {voucherFeedback && (
                  <p className={`text-xs font-mono ${voucherFeedback.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {voucherFeedback.msg}
                  </p>
                )}
                <button
                  type="submit"
                  className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer ${
                    isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
                  }`}
                >
                  Mint Voucher Credits
                </button>
              </form>

              {/* 2. Convert Credits -> NFC Wristband */}
              <form
                onSubmit={handleConvertCreditsToWristband}
                className={`p-6 rounded-2xl ring-1 space-y-4 ${
                  isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
                }`}
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-bold">Load onto NFC Wristband</h3>
                  <p className="text-xs font-mono opacity-60">
                    {pairedWristband
                      ? `Linked UID ${pairedWristband.uid} · Bal ${formatCurrency(pairedWristband.balanceMinor, pairedWristband.currency)}`
                      : 'Pair an NFC wristband in the Cashless Terminal to convert NXR credits for bar/merch taps.'}
                  </p>
                </div>
                <input
                  type="number"
                  min={100}
                  max={creditWallet.balanceTokens || undefined}
                  value={wristbandConvertTokens}
                  onChange={e => setWristbandConvertTokens(e.target.value)}
                  placeholder="Tokens (e.g. 5000 = 50.00)"
                  disabled={!pairedWristband}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-mono tabular-nums focus:outline-none ring-1 disabled:opacity-40 ${
                    isDark ? 'bg-black text-white ring-white/15' : 'bg-white text-black ring-black/15'
                  }`}
                />
                {wristbandConvertFeedback && (
                  <p className={`text-xs font-mono ${wristbandConvertFeedback.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {wristbandConvertFeedback.msg}
                  </p>
                )}
                {pairedWristband ? (
                  <button
                    type="submit"
                    className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer ${
                      isDark ? 'bg-emerald-400 text-black hover:bg-emerald-300' : 'bg-black text-white hover:bg-neutral-800'
                    }`}
                  >
                    Convert to NFC Balance
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsCashlessOpen(true)}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer ${
                      isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
                    }`}
                  >
                    Pair Wristband Now
                  </button>
                )}
              </form>

              {/* 3. P2P Credit Transfer */}
              <form
                onSubmit={handleTransferCredits}
                className={`p-6 rounded-2xl ring-1 space-y-3 ${
                  isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
                }`}
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-bold">Send NXR Credits</h3>
                  <p className="text-xs font-mono opacity-60">
                    Transfer tokenized credits instantly to another attendee.
                  </p>
                </div>
                <input
                  type="email"
                  required
                  value={transferCreditEmail}
                  onChange={e => setTransferCreditEmail(e.target.value)}
                  placeholder="Recipient email"
                  className={`w-full px-3.5 py-2 rounded-xl text-xs focus:outline-none ring-1 ${
                    isDark ? 'bg-black text-white ring-white/15' : 'bg-white text-black ring-black/15'
                  }`}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    required
                    value={transferCreditAmount}
                    onChange={e => setTransferCreditAmount(e.target.value)}
                    placeholder="NXR Amount"
                    className={`w-full px-3 py-2 rounded-xl text-xs font-mono tabular-nums focus:outline-none ring-1 ${
                      isDark ? 'bg-black text-white ring-white/15' : 'bg-white text-black ring-black/15'
                    }`}
                  />
                  <input
                    type="text"
                    value={transferCreditNote}
                    onChange={e => setTransferCreditNote(e.target.value)}
                    placeholder="Note (optional)"
                    className={`w-full px-3 py-2 rounded-xl text-xs focus:outline-none ring-1 ${
                      isDark ? 'bg-black text-white ring-white/15' : 'bg-white text-black ring-black/15'
                    }`}
                  />
                </div>
                {creditTransferFeedback && (
                  <p className={`text-xs font-mono ${creditTransferFeedback.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {creditTransferFeedback.msg}
                  </p>
                )}
                <button
                  type="submit"
                  className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer ${
                    isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
                  }`}
                >
                  Transfer Credits
                </button>
              </form>
            </div>

            {/* Credit Token Ledger */}
            <div className={`p-6 rounded-2xl ring-1 space-y-4 ${
              isDark ? 'bg-[#0E0E12] ring-white/10' : 'bg-neutral-50 ring-black/10'
            }`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Credit Token Ledger ({creditTransactions.length})</h3>
                <span className="text-xs font-mono opacity-60">100 NXR = 1.00 {creditWallet.currency}</span>
              </div>

              {creditTransactions.length === 0 ? (
                <p className="text-xs font-mono opacity-60 py-6 text-center">
                  No credit token activity yet. Book tickets, tap a cashless wristband, or claim a voucher to mint NXR Credits.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`border-b font-mono opacity-60 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                      <tr>
                        <th className="py-2.5 pr-4">Timestamp</th>
                        <th className="py-2.5 pr-4">Activity</th>
                        <th className="py-2.5 pr-4">Signature</th>
                        <th className="py-2.5 pr-4 text-right">Delta (NXR)</th>
                        <th className="py-2.5 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-white/10' : 'divide-black/10'}`}>
                      {creditTransactions.map(tx => (
                        <tr key={tx.id}>
                          <td className="py-3 pr-4 font-mono tabular-nums opacity-70 whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3 pr-4">
                            <span className="font-semibold block">{tx.description}</span>
                            <span className="text-[11px] font-mono opacity-60">{tx.txType}</span>
                          </td>
                          <td className="py-3 pr-4 font-mono text-[11px] opacity-60 max-w-[160px] truncate">
                            {tx.tokenSignature}
                          </td>
                          <td className={`py-3 pr-4 text-right font-mono font-bold tabular-nums ${
                            tx.tokensDelta >= 0 ? 'text-emerald-500' : 'text-amber-500'
                          }`}>
                            {tx.tokensDelta >= 0 ? '+' : ''}{tx.tokensDelta.toLocaleString()}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums font-bold">
                            {tx.balanceAfterTokens.toLocaleString()} NXR
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State (Passes Tab) */}
        {walletTab === 'passes' && filteredTickets.length === 0 ? (
          <div className={`p-16 text-center space-y-4 rounded-3xl ${
            isDark ? 'bg-[#0E0E12]' : 'bg-neutral-50'
          }`}>
            <TicketIcon className="w-12 h-12 mx-auto opacity-30" />
            <div className="space-y-1">
              <h3 className="text-lg font-bold">No tickets found</h3>
              <p className="text-xs font-mono opacity-60 max-w-sm mx-auto">
                You do not have any admission passes under this filter. Browse the marketplace to discover upcoming festivals and conferences.
              </p>
            </div>
            <button
              onClick={onExploreEvents}
              className={`px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer shadow-lg ${
                isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
              }`}
            >
              Explore Events
            </button>
          </div>
        ) : walletTab === 'passes' ? (
          <div className="space-y-6">
            {tokenizationFeedback && (
              <div
                className={`p-4 rounded-2xl text-xs font-mono font-bold ${
                  tokenizationFeedback.ok
                    ? (isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-800')
                    : (isDark ? 'bg-red-500/15 text-red-400' : 'bg-red-50 text-red-700')
                }`}
              >
                {tokenizationFeedback.msg}
              </div>
            )}

            {/* Grid of TicketCards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredTickets.map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  qrCodeUrl={qrCodeUrls[ticket.id]}
                  isDark={isDark}
                  asset={tokenizationService.getAssetByTicketId(ticket.id)}
                  isMinting={mintingTicketId === ticket.id}
                  onMintAsset={handleMintTicketAsset}
                  onTransfer={(t) => {
                    setTransferModalTicket(t);
                    setTransferName('');
                    setTransferEmail('');
                  }}
                  onRefund={(t) => {
                    setRefundModalTicket(t);
                    setRefundCustomNote('');
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

      </div>

      {/* Transfer Pass Modal / Form Sheet */}
      {transferModalTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className={`w-full max-w-md p-6 sm:p-8 rounded-3xl space-y-6 ${
            isDark ? 'bg-[#0E0E12] text-white' : 'bg-white text-black'
          }`}>
            <h3 className="text-lg font-bold tracking-tight">Transfer Admission Pass</h3>
            <p className="text-xs font-mono opacity-60">
              Transfer {transferModalTicket.ticketCode} ({transferModalTicket.tierName}) to another attendee.
            </p>

            {transferSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold text-center">
                Pass Transferred Successfully!
              </div>
            ) : (
              <form onSubmit={handleTransferSubmit} className="space-y-4">
                {transferError && (
                  <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-mono">
                    {transferError}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-mono font-bold mb-1 opacity-70">New Attendee Name</label>
                  <input
                    type="text"
                    required
                    value={transferName}
                    onChange={e => setTransferName(e.target.value)}
                    placeholder="Full Name"
                    className={`w-full px-4 py-3 rounded-xl text-xs focus:outline-none ${
                      isDark ? 'bg-black text-white' : 'bg-neutral-100 text-black'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold mb-1 opacity-70">New Attendee Email</label>
                  <input
                    type="email"
                    required
                    value={transferEmail}
                    onChange={e => setTransferEmail(e.target.value)}
                    placeholder="email@domain.com"
                    className={`w-full px-4 py-3 rounded-xl text-xs focus:outline-none ${
                      isDark ? 'bg-black text-white' : 'bg-neutral-100 text-black'
                    }`}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setTransferModalTicket(null)}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold cursor-pointer ${
                      isDark ? 'bg-black text-white' : 'bg-neutral-100 text-black'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 py-3 rounded-xl text-xs font-bold cursor-pointer ${
                      isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-black text-white hover:bg-neutral-800'
                    }`}
                  >
                    Send Pass
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Refund Request Modal / Form Sheet */}
      {refundModalTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className={`w-full max-w-md p-6 sm:p-8 rounded-3xl space-y-6 ${
            isDark ? 'bg-[#0E0E12] text-white' : 'bg-white text-black'
          }`}>
            <h3 className="text-lg font-bold tracking-tight">Request Pass Refund</h3>
            <p className="text-xs font-mono opacity-60">
              Refund {refundModalTicket.ticketCode} ({formatCurrency(refundModalTicket.priceMinor, refundModalTicket.currency)})
            </p>

            {refundFeedback ? (
              <div className={`p-4 rounded-xl text-xs font-mono font-bold text-center ${
                refundFeedback.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {refundFeedback.msg}
              </div>
            ) : (
              <form onSubmit={handleRefundSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono font-bold mb-1 opacity-70">Reason for Request</label>
                  <select
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl text-xs focus:outline-none cursor-pointer ${
                      isDark ? 'bg-black text-white' : 'bg-neutral-100 text-black'
                    }`}
                  >
                    <option value="Schedule conflict — Unable to attend">Schedule conflict — Unable to attend</option>
                    <option value="Medical or personal emergency">Medical or personal emergency</option>
                    <option value="Accidental duplicate booking">Accidental duplicate booking</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-mono font-bold mb-1 opacity-70">Additional Notes</label>
                  <textarea
                    rows={3}
                    value={refundCustomNote}
                    onChange={e => setRefundCustomNote(e.target.value)}
                    placeholder="Details for event organizer..."
                    className={`w-full px-4 py-3 rounded-xl text-xs focus:outline-none ${
                      isDark ? 'bg-black text-white' : 'bg-neutral-100 text-black'
                    }`}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setRefundModalTicket(null)}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold cursor-pointer ${
                      isDark ? 'bg-black text-white' : 'bg-neutral-100 text-black'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                  >
                    Confirm Refund
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Cashless RFID Wristband Terminal Modal */}
      {isCashlessOpen && (
        <CashlessTerminalModal
          isOpen={isCashlessOpen}
          onClose={() => setIsCashlessOpen(false)}
          attendeeEmail={effectiveEmail}
          attendeeName={effectiveName}
          theme={theme}
        />
      )}

      {/* Loyalty Points Redemption Modal */}
      {isRedemptionOpen && (
        <LoyaltyRedemptionModal
          isOpen={isRedemptionOpen}
          onClose={() => setIsRedemptionOpen(false)}
          userEmail={effectiveEmail}
          defaultCurrency={creditWallet.currency}
          isDark={isDark}
          onRedeemed={() => {
            setCreditTick(t => t + 1);
            onRefresh();
          }}
        />
      )}

    </div>
  );
};
