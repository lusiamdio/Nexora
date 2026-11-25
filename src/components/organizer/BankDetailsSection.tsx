import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { OrganizerProfile } from '../../types';
import { store } from '../../lib/store';
import { upsertOrganizerBankDetailsInSupabase } from '../../lib/supabase';

interface BankDetailsSectionProps {
  organizer: OrganizerProfile;
  isDarkTheme: boolean;
  mode?: 'page' | 'embedded';
  onUpdated: (updated: OrganizerProfile) => void;
  onNavigateWallet?: () => void;
  onNotification?: (message: string) => void;
}

export const BankDetailsSection: React.FC<BankDetailsSectionProps> = ({
  organizer,
  isDarkTheme,
  mode = 'page',
  onUpdated,
  onNavigateWallet,
  onNotification,
}) => {
  const isAlreadyConfirmed = store.hasConfirmedBankDetails(organizer.id);

  const [isEditing, setIsEditing] = useState<boolean>(!isAlreadyConfirmed);
  const [showAccountDigits, setShowAccountDigits] = useState<boolean>(false);
  const [showSummaryDigits, setShowSummaryDigits] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [bankName, setBankName] = useState<string>(organizer.bankDetails?.bankName || '');
  const [accountHolder, setAccountHolder] = useState<string>(
    organizer.bankDetails?.accountHolder || organizer.name || ''
  );
  const [accountNumber, setAccountNumber] = useState<string>(
    organizer.bankDetails?.accountNumber || ''
  );
  const [confirmAccountNumber, setConfirmAccountNumber] = useState<string>(
    organizer.bankDetails?.accountNumber || ''
  );
  const [branchCode, setBranchCode] = useState<string>(organizer.bankDetails?.branchCode || '');
  const [accountType, setAccountType] = useState<string>(
    organizer.bankDetails?.accountType || 'Business Cheque'
  );
  const [confirmed, setConfirmed] = useState<boolean>(Boolean(organizer.bankDetails?.confirmed));

  useEffect(() => {
    const confirmedNow = store.hasConfirmedBankDetails(organizer.id);
    setBankName(organizer.bankDetails?.bankName || '');
    setAccountHolder(organizer.bankDetails?.accountHolder || organizer.name || '');
    setAccountNumber(organizer.bankDetails?.accountNumber || '');
    setConfirmAccountNumber(organizer.bankDetails?.accountNumber || '');
    setBranchCode(organizer.bankDetails?.branchCode || '');
    setAccountType(organizer.bankDetails?.accountType || 'Business Cheque');
    setConfirmed(Boolean(organizer.bankDetails?.confirmed));
    if (!confirmedNow) {
      setIsEditing(true);
    }
  }, [
    organizer.id,
    organizer.bankDetails?.bankName,
    organizer.bankDetails?.accountHolder,
    organizer.bankDetails?.accountNumber,
    organizer.bankDetails?.branchCode,
    organizer.bankDetails?.accountType,
    organizer.bankDetails?.confirmed,
    organizer.name,
  ]);

  const rawAccountTrimmed = accountNumber.trim();
  const maskedAccount =
    rawAccountTrimmed.length >= 4
      ? `•••• •••• ${rawAccountTrimmed.slice(-4)}`
      : rawAccountTrimmed || 'Not configured';
  const accountNumbersMatch =
    confirmAccountNumber.trim().length > 0 &&
    confirmAccountNumber.trim() === accountNumber.trim();

  const surfaceClass = isDarkTheme
    ? 'bg-[#111827] ring-1 ring-white/10 text-white'
    : 'bg-white ring-1 ring-black/10 text-black';
  const subSurfaceClass = isDarkTheme
    ? 'bg-[#1F2937] text-white'
    : 'bg-[#F8F7F4] text-black';
  const inputClass = isDarkTheme
    ? 'bg-black text-white ring-1 ring-white/15 focus:ring-2 focus:ring-[#F6A623]'
    : 'bg-white text-black ring-1 ring-black/15 focus:ring-2 focus:ring-[#F6A623]';
  const mutedTextClass = isDarkTheme ? 'text-[#9CA3AF]' : 'text-[#6B7280]';

  const handleOpenEdit = () => {
    setBankName(organizer.bankDetails?.bankName || '');
    setAccountHolder(organizer.bankDetails?.accountHolder || organizer.name || '');
    setAccountNumber(organizer.bankDetails?.accountNumber || '');
    setConfirmAccountNumber(organizer.bankDetails?.accountNumber || '');
    setBranchCode(organizer.bankDetails?.branchCode || '');
    setAccountType(organizer.bankDetails?.accountType || 'Business Cheque');
    setConfirmed(Boolean(organizer.bankDetails?.confirmed));
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanBank = bankName.trim();
    const cleanHolder = accountHolder.trim();
    const cleanAcc = accountNumber.trim();
    const cleanConfirmAcc = confirmAccountNumber.trim();
    const cleanBranch = branchCode.trim();

    if (cleanBank.length < 2) {
      setErrorMsg('Enter your banking institution name (at least 2 characters).');
      return;
    }
    if (cleanHolder.length < 2) {
      setErrorMsg('Enter the legal account holder name registered with your bank.');
      return;
    }
    if (cleanAcc.length < 5) {
      setErrorMsg('Enter a valid bank account number (at least 5 characters).');
      return;
    }
    if (cleanAcc !== cleanConfirmAcc) {
      setErrorMsg('Account Number and Confirm Account Number must match.');
      return;
    }
    if (!confirmed) {
      setErrorMsg('Check the confirmation box to verify these bank details are accurate.');
      return;
    }

    setIsSaving(true);
    try {
      const supabaseResult = await upsertOrganizerBankDetailsInSupabase({
        organizerId: organizer.id,
        bankName: cleanBank,
        accountHolder: cleanHolder,
        accountNumber: cleanAcc,
        confirmAccountNumber: cleanConfirmAcc,
        branchCode: cleanBranch,
        accountType,
        confirmed: true,
      });

      if (supabaseResult.error) {
        setErrorMsg(supabaseResult.error);
        setIsSaving(false);
        return;
      }

      const confirmedAt = new Date().toISOString();
      const updated = store.updateOrganizerProfile(organizer.id, {
        bankDetails: {
          bankName: cleanBank,
          accountHolder: cleanHolder,
          accountNumber: cleanAcc,
          branchCode: cleanBranch,
          accountType,
          confirmed: true,
          confirmedAt,
        },
      });

      if (!updated) {
        setErrorMsg('Unable to update organizer banking profile.');
        setIsSaving(false);
        return;
      }

      setShowAccountDigits(false);
      setShowSummaryDigits(false);
      setIsEditing(false);
      setSuccessMsg(
        `Confirmed ${cleanBank} (••••${cleanAcc.slice(-4)}) for ticket payments and post-event withdrawals.`
      );
      onUpdated(updated);
      onNotification?.(
        `Bank details confirmed: ${cleanBank} (••••${cleanAcc.slice(-4)}).`
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (mode === 'embedded') {
    return (
      <div className={`p-4 rounded-xl space-y-3 ${subSurfaceClass}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] font-mono uppercase ${mutedTextClass}`}>
            Settlement Bank Account
          </span>
          {isAlreadyConfirmed ? (
            <span className="text-[11px] font-mono font-bold text-emerald-500 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Confirmed</span>
            </span>
          ) : (
            <span className="text-[11px] font-mono font-bold text-amber-500 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Required to Receive Payment</span>
            </span>
          )}
        </div>

        {!isEditing && isAlreadyConfirmed && organizer.bankDetails ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-bold truncate">{organizer.bankDetails.bankName}</p>
              <p className={`text-xs font-mono tabular-nums truncate ${mutedTextClass}`}>
                Account ••••{organizer.bankDetails.accountNumber.slice(-4)} ·{' '}
                {organizer.bankDetails.accountHolder || organizer.name}
              </p>
              {organizer.bankDetails.confirmedAt && (
                <p className={`text-[10px] font-mono ${mutedTextClass}`}>
                  Confirmed {new Date(organizer.bankDetails.confirmedAt).toLocaleDateString()} · Editable anytime
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleOpenEdit}
              className={`px-3 py-2 rounded-lg text-xs font-bold shrink-0 cursor-pointer transition-colors whitespace-nowrap ${
                isDarkTheme
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-white hover:bg-neutral-200 text-black ring-1 ring-black/10'
              }`}
            >
              Change Bank Details
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3 pt-1">
            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-red-500/15 text-red-400 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div>
                <label className={`text-[10px] font-mono uppercase block mb-1 ${mutedTextClass}`}>
                  Bank Name *
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  placeholder="e.g. First National Bank"
                  className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className={`text-[10px] font-mono uppercase block mb-1 ${mutedTextClass}`}>
                  Account Holder *
                </label>
                <input
                  type="text"
                  value={accountHolder}
                  onChange={e => setAccountHolder(e.target.value)}
                  placeholder="Legal account holder name"
                  className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className={`text-[10px] font-mono uppercase block mb-1 ${mutedTextClass}`}>
                  Account Number *
                </label>
                <div className="relative">
                  <input
                    type={showAccountDigits ? 'text' : 'password'}
                    autoComplete="off"
                    value={accountNumber}
                    onChange={e => setAccountNumber(e.target.value)}
                    placeholder="Account number"
                    className={`w-full pl-3 pr-9 py-2 rounded-lg text-xs font-mono tabular-nums focus:outline-none ${inputClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccountDigits(s => !s)}
                    aria-label={showAccountDigits ? 'Hide account number' : 'Show account number'}
                    className={`absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer ${mutedTextClass} hover:text-current`}
                  >
                    {showAccountDigits ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={`text-[10px] font-mono uppercase block mb-1 ${mutedTextClass}`}>
                  Confirm Account Number *
                </label>
                <input
                  type={showAccountDigits ? 'text' : 'password'}
                  autoComplete="off"
                  value={confirmAccountNumber}
                  onChange={e => setConfirmAccountNumber(e.target.value)}
                  placeholder="Re-enter account number"
                  className={`w-full px-3 py-2 rounded-lg text-xs font-mono tabular-nums focus:outline-none ${
                    confirmAccountNumber && !accountNumbersMatch
                      ? isDarkTheme
                        ? 'bg-black text-white ring-2 ring-red-500'
                        : 'bg-white text-black ring-2 ring-red-500'
                      : inputClass
                  }`}
                />
              </div>
              <div>
                <label className={`text-[10px] font-mono uppercase block mb-1 ${mutedTextClass}`}>
                  Branch / Routing Code
                </label>
                <input
                  type="text"
                  value={branchCode}
                  onChange={e => setBranchCode(e.target.value)}
                  placeholder="Optional"
                  className={`w-full px-3 py-2 rounded-lg text-xs font-mono tabular-nums focus:outline-none ${inputClass}`}
                />
              </div>
              <div>
                <label className={`text-[10px] font-mono uppercase block mb-1 ${mutedTextClass}`}>
                  Account Type
                </label>
                <select
                  value={accountType}
                  onChange={e => setAccountType(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg text-xs focus:outline-none ${inputClass}`}
                >
                  <option value="Business Cheque">Business Cheque</option>
                  <option value="Corporate Current">Corporate Current</option>
                  <option value="Corporate Savings">Corporate Savings</option>
                  <option value="Trust Account">Trust Account</option>
                </select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-[11px] leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#F6A623] cursor-pointer"
              />
              <span>
                I confirm these bank account details are accurate to receive ticket payments and withdrawals.
              </span>
            </label>
            <div className="flex gap-2">
              {isAlreadyConfirmed && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setIsEditing(false);
                  }}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                    isDarkTheme ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white text-black ring-1 ring-black/15'
                  }`}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-2 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {isSaving ? 'Saving...' : 'Confirm & Save Bank Details'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-tight">Bank Details</h2>
          <p className={`text-xs ${mutedTextClass}`}>
            Add, update, and confirm the settlement bank account used to receive ticket payments and Nexora Wallet withdrawals.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onNavigateWallet && (
            <button
              type="button"
              onClick={onNavigateWallet}
              className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
                isDarkTheme
                  ? 'bg-[#1F2937] text-white hover:bg-[#374151]'
                  : 'bg-neutral-100 text-black hover:bg-neutral-200'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Open Nexora Wallet</span>
            </button>
          )}
          {!isEditing && isAlreadyConfirmed && (
            <button
              type="button"
              onClick={handleOpenEdit}
              className="px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer bg-[#F6A623] hover:bg-[#e09519] text-black whitespace-nowrap shrink-0 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Update Bank Details</span>
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-500 text-xs font-semibold flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {!isAlreadyConfirmed && (
        <div
          className={`p-4 rounded-xl ring-1 flex items-start gap-3 text-xs ${
            isDarkTheme
              ? 'bg-amber-950/35 ring-amber-500/40 text-amber-100'
              : 'bg-amber-50 ring-amber-300 text-amber-950'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <strong className="block font-bold">
              Settlement Bank Account Confirmation Required
            </strong>
            <p className="opacity-80">
              Ticket payments for paid events and post-event Nexora Wallet withdrawals remain paused until you add and confirm your bank account details below.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Current Confirmed Account Overview & Payout Security Rules */}
        <div className={`lg:col-span-5 p-6 rounded-2xl space-y-5 ${surfaceClass}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#F6A623]" />
              <h3 className="text-sm font-bold">Active Settlement Account</h3>
            </div>
            {isAlreadyConfirmed ? (
              <span className="text-xs font-mono font-bold text-emerald-500 inline-flex items-center gap-1 whitespace-nowrap">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirmed</span>
              </span>
            ) : (
              <span className="text-xs font-mono font-bold text-amber-500 inline-flex items-center gap-1 whitespace-nowrap">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Unconfirmed</span>
              </span>
            )}
          </div>

          <div className={`p-4 rounded-xl space-y-3 ${subSurfaceClass}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-mono ${mutedTextClass}`}>Institution</span>
              <span className="text-xs font-bold text-right truncate max-w-[60%]">
                {organizer.bankDetails?.bankName || 'Not added yet'}
              </span>
            </div>
            <div className={`h-px ${isDarkTheme ? 'bg-white/10' : 'bg-black/10'}`} />
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-mono ${mutedTextClass}`}>Account Holder</span>
              <span className="text-xs font-bold text-right truncate max-w-[60%]">
                {organizer.bankDetails?.accountHolder || 'Not added yet'}
              </span>
            </div>
            <div className={`h-px ${isDarkTheme ? 'bg-white/10' : 'bg-black/10'}`} />
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-mono ${mutedTextClass}`}>Account Number</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold tabular-nums">
                  {showSummaryDigits && rawAccountTrimmed ? rawAccountTrimmed : maskedAccount}
                </span>
                {rawAccountTrimmed && (
                  <button
                    type="button"
                    onClick={() => setShowSummaryDigits(v => !v)}
                    aria-label={showSummaryDigits ? 'Mask account number' : 'Reveal account number'}
                    className={`cursor-pointer ${mutedTextClass} hover:text-current`}
                  >
                    {showSummaryDigits ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
            <div className={`h-px ${isDarkTheme ? 'bg-white/10' : 'bg-black/10'}`} />
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-mono ${mutedTextClass}`}>Account Type</span>
              <span className="text-xs font-medium">
                {organizer.bankDetails?.accountType || 'Business Cheque'}
              </span>
            </div>
            {organizer.bankDetails?.branchCode && (
              <>
                <div className={`h-px ${isDarkTheme ? 'bg-white/10' : 'bg-black/10'}`} />
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[11px] font-mono ${mutedTextClass}`}>Branch Code</span>
                  <span className="text-xs font-mono tabular-nums">
                    {organizer.bankDetails.branchCode}
                  </span>
                </div>
              </>
            )}
            {organizer.bankDetails?.confirmedAt && (
              <>
                <div className={`h-px ${isDarkTheme ? 'bg-white/10' : 'bg-black/10'}`} />
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[11px] font-mono ${mutedTextClass}`}>Confirmed Date</span>
                  <span className="text-xs font-mono tabular-nums">
                    {new Date(organizer.bankDetails.confirmedAt).toLocaleDateString()}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className={`p-4 rounded-xl space-y-2.5 text-xs ${subSurfaceClass}`}>
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Payout & Escrow Protections</span>
            </div>
            <ul className={`space-y-1.5 leading-relaxed ${mutedTextClass}`}>
              <li className="flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#F6A623]" />
                <span>
                  Ticket proceeds credit your Nexora Wallet immediately and become withdrawable once each event date passes.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CreditCard className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
                <span>
                  You may update and re-confirm your destination bank account details anytime without losing wallet funds.
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right: Add / Update / Confirm Banking Form */}
        <div className={`lg:col-span-7 p-6 rounded-2xl space-y-5 ${surfaceClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold">
                {isAlreadyConfirmed && !isEditing
                  ? 'Settlement Account Verified'
                  : isAlreadyConfirmed
                    ? 'Update & Re-Confirm Banking Details'
                    : 'Add & Confirm Bank Account Details'}
              </h3>
              <p className={`text-xs ${mutedTextClass}`}>
                Re-enter your account number to prevent settlement errors. Changes apply to upcoming withdrawals immediately.
              </p>
            </div>
            {isAlreadyConfirmed && !isEditing && (
              <button
                type="button"
                onClick={handleOpenEdit}
                className="px-3.5 py-2 rounded-xl bg-[#F6A623] hover:bg-[#e09519] text-black text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                Edit Banking Info
              </button>
            )}
          </div>

          {!isEditing && isAlreadyConfirmed ? (
            <div className={`p-6 rounded-xl text-center space-y-3 ${subSurfaceClass}`}>
              <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-bold">
                  {organizer.bankDetails.bankName} ({maskedAccount}) is active
                </p>
                <p className={`text-xs ${mutedTextClass}`}>
                  Your events are enabled to receive Card, Instant EFT, and Mobile Money ticket settlements into your Nexora Wallet.
                </p>
              </div>
              <div className="pt-1 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenEdit}
                  className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap ${
                    isDarkTheme
                      ? 'bg-white/10 hover:bg-white/20 text-white'
                      : 'bg-white hover:bg-neutral-100 text-black ring-1 ring-black/15'
                  }`}
                >
                  Change Bank Account
                </button>
                {onNavigateWallet && (
                  <button
                    type="button"
                    onClick={onNavigateWallet}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    Go to Wallet & Withdrawals
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-500/15 ring-1 ring-red-500/30 text-red-400 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={`text-[11px] font-mono uppercase block mb-1.5 ${mutedTextClass}`}>
                    Bank / Financial Institution *
                  </label>
                  <input
                    type="text"
                    required
                    value={bankName}
                    onChange={e => setBankName(e.target.value)}
                    placeholder="e.g. First National Bank / Equity Bank"
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className={`text-[11px] font-mono uppercase block mb-1.5 ${mutedTextClass}`}>
                    Legal Account Holder Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={accountHolder}
                    onChange={e => setAccountHolder(e.target.value)}
                    placeholder="Legal entity or individual name"
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className={`text-[11px] font-mono uppercase block mb-1.5 ${mutedTextClass}`}>
                    Account Number *
                  </label>
                  <div className="relative">
                    <input
                      type={showAccountDigits ? 'text' : 'password'}
                      required
                      autoComplete="off"
                      value={accountNumber}
                      onChange={e => setAccountNumber(e.target.value)}
                      placeholder="Enter account number"
                      className={`w-full pl-3.5 pr-10 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${inputClass}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccountDigits(s => !s)}
                      aria-label={showAccountDigits ? 'Hide account number' : 'Show account number'}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer ${mutedTextClass} hover:text-current`}
                    >
                      {showAccountDigits ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className={`text-[11px] font-mono uppercase block mb-1.5 ${mutedTextClass}`}>
                    Confirm Account Number *
                  </label>
                  <input
                    type={showAccountDigits ? 'text' : 'password'}
                    required
                    autoComplete="off"
                    value={confirmAccountNumber}
                    onChange={e => setConfirmAccountNumber(e.target.value)}
                    placeholder="Re-enter account number"
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${
                      confirmAccountNumber && !accountNumbersMatch
                        ? isDarkTheme
                          ? 'bg-black text-white ring-2 ring-red-500'
                          : 'bg-white text-black ring-2 ring-red-500'
                        : inputClass
                    }`}
                  />
                  {confirmAccountNumber && !accountNumbersMatch && (
                    <span className="text-[11px] font-mono text-red-400 mt-1 block">
                      Account numbers do not match.
                    </span>
                  )}
                </div>

                <div>
                  <label className={`text-[11px] font-mono uppercase block mb-1.5 ${mutedTextClass}`}>
                    Branch / Routing / SWIFT Code
                  </label>
                  <input
                    type="text"
                    value={branchCode}
                    onChange={e => setBranchCode(e.target.value)}
                    placeholder="Optional (e.g. 250655)"
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${inputClass}`}
                  />
                </div>

                <div>
                  <label className={`text-[11px] font-mono uppercase block mb-1.5 ${mutedTextClass}`}>
                    Account Type
                  </label>
                  <select
                    value={accountType}
                    onChange={e => setAccountType(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm focus:outline-none ${inputClass}`}
                  >
                    <option value="Business Cheque">Business Cheque</option>
                    <option value="Corporate Current">Corporate Current</option>
                    <option value="Corporate Savings">Corporate Savings</option>
                    <option value="Trust Account">Trust Account</option>
                  </select>
                </div>
              </div>

              <label className={`p-3.5 rounded-xl flex items-start gap-2.5 cursor-pointer text-xs leading-relaxed ${subSurfaceClass}`}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#F6A623] cursor-pointer"
                />
                <span>
                  I confirm that these banking details are accurate and belong to my organization to receive ticket payments and Nexora Wallet withdrawals.
                </span>
              </label>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                {isAlreadyConfirmed && (
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setIsEditing(false);
                    }}
                    className={`px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap ${
                      isDarkTheme
                        ? 'bg-white/10 hover:bg-white/20 text-white'
                        : 'bg-neutral-100 hover:bg-neutral-200 text-black'
                    }`}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {isSaving ? 'Confirming Details...' : 'Save & Confirm Bank Details'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
