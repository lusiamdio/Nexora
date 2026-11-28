import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Clock,
  CreditCard,
  Smartphone,
  Landmark,
  CheckCircle2,
  AlertTriangle,
  Download,
  Lock,
  Calendar,
  ExternalLink,
  Copy,
  Check,
  Ticket as TicketIcon,
  Receipt,
  Loader2,
  X,
  Coins,
} from 'lucide-react';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import { Event, Order, Ticket, AuthUser } from '../../types';
import { store } from '../../lib/store';
import { formatCurrency, formatEventDate, formatEventTime } from '../../lib/currencies';
import { isValidEmail } from '../../lib/security';

interface CheckoutPageProps {
  event: Event;
  selectedItems: Array<{ tierId: string; quantity: number }>;
  currentUser?: AuthUser | null;
  onBack: () => void;
  onTicketsIssued: (tickets: Ticket[]) => void;
  onGoToWallet: () => void;
  theme?: 'light' | 'dark';
}

type PaymentRailId = 'card' | 'ozow' | 'momo';

interface SettlementStage {
  id: string;
  label: string;
  detail: string;
}

const EFT_BANKS = [
  'FNB',
  'Standard Bank',
  'Capitec',
  'Nedbank',
  'Absa',
  'TymeBank',
] as const;

const MOMO_CHANNELS = ['M-Pesa', 'MTN MoMo', 'Airtel Money'] as const;

function detectCardBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^(506|507|650)/.test(digits)) return 'Verve';
  if (/^3[47]/.test(digits)) return 'Amex';
  return 'Card';
}

function formatCardNumberInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatExpiryInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function isValidExpiry(mmYy: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(mmYy.trim());
  if (!match) return false;
  const month = parseInt(match[1], 10);
  const year = 2000 + parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return year > currentYear || (year === currentYear && month >= currentMonth);
}

function isValidLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (shouldDouble) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export const CheckoutPage: React.FC<CheckoutPageProps> = ({
  event,
  selectedItems,
  currentUser,
  onBack,
  onTicketsIssued,
  onGoToWallet,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';

  // Checkout Flow:
  // 1: Attendee & Custom Questions
  // 2: Payment Rail & Authorization
  // 3: Live Settlement & Issuance Pipeline
  // 4: Confirmed Receipt & QR Passports
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // 15-minute inventory reservation hold timer
  const [holdSecondsLeft, setHoldSecondsLeft] = useState(15 * 60);

  // Attendee Form
  const [name, setName] = useState(currentUser?.name || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    event.customQuestions?.forEach(q => {
      if (q.type === 'checkbox') initial[q.id] = 'No';
      else if (q.type === 'dropdown' && q.options?.length) initial[q.id] = q.options[0];
      else initial[q.id] = '';
    });
    return initial;
  });

  // Promo / Voucher state
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountPct: number;
    discountMinor?: number;
  } | null>(null);
  const [promoError, setPromoError] = useState('');

  // Cashless & Loyalty Credits (NXR) redemption state
  const [applyCredits, setApplyCredits] = useState(false);
  const [customCreditsTokens, setCustomCreditsTokens] = useState<string>('');

  // Region-smart payment rail default
  const isMomoDefaultCurrency = event.currency === 'KES' || event.currency === 'GHS' || event.currency === 'RWF';
  const defaultRail: PaymentRailId = isMomoDefaultCurrency ? 'momo' : 'card';
  const defaultMomoChannel = event.currency === 'GHS' || event.currency === 'RWF' ? 'MTN MoMo' : 'M-Pesa';
  const [selectedRail, setSelectedRail] = useState<PaymentRailId>(defaultRail);

  // Ephemeral payment rail inputs (never written to localStorage or store)
  const [cardHolder, setCardHolder] = useState(currentUser?.name || '');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [selectedBank, setSelectedBank] = useState<string>(EFT_BANKS[0]);
  const [momoChannel, setMomoChannel] = useState<string>(defaultMomoChannel);
  const [momoPhone, setMomoPhone] = useState(currentUser?.phone || '');

  // Errors & feedback
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Settlement pipeline & issued pass state
  const [settlementStageIdx, setSettlementStageIdx] = useState(0);
  const [order, setOrder] = useState<Order | null>(null);
  const [issuedTickets, setIssuedTickets] = useState<Ticket[]>([]);
  const [ticketQrs, setTicketQrs] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  // Inventory reservation countdown
  useEffect(() => {
    if (step >= 3) return;
    const timer = window.setInterval(() => {
      setHoldSecondsLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const holdMinutes = Math.floor(holdSecondsLeft / 60);
  const holdSeconds = holdSecondsLeft % 60;
  const holdFormatted = `${String(holdMinutes).padStart(2, '0')}:${String(holdSeconds).padStart(2, '0')}`;
  const isHoldExpiringSoon = holdSecondsLeft > 0 && holdSecondsLeft <= 120;
  const isHoldExpired = holdSecondsLeft === 0;

  // Regional card processor routing aligned with SUPPORTED_COUNTRIES
  const regionalCardGateway: Order['paymentProvider'] = useMemo(() => {
    if (event.currency === 'ZAR' || event.currency === 'NGN' || event.currency === 'GHS') {
      return 'paystack';
    }
    if (event.currency === 'KES' || event.currency === 'RWF') {
      return 'flutterwave';
    }
    return 'stripe_card';
  }, [event.currency]);

  const cardProcessorLabel = useMemo(() => {
    if (regionalCardGateway === 'paystack') return 'Paystack 3DS';
    if (regionalCardGateway === 'flutterwave') return 'Flutterwave 3DS';
    return 'Stripe 3DS';
  }, [regionalCardGateway]);

  // Line items & authoritative fee calculation (synced 1:1 with store.createOrder)
  const orderItemsWithDetails = useMemo(
    () =>
      selectedItems.map(item => {
        const tier = event.tickets.find(t => t.id === item.tierId);
        return {
          tierId: item.tierId,
          tierName: tier ? tier.name : 'General Admission',
          unitPriceMinor: tier ? tier.priceMinor : 0,
          quantity: item.quantity,
          subtotalMinor: (tier ? tier.priceMinor : 0) * item.quantity,
        };
      }),
    [selectedItems, event.tickets]
  );

  const attendeeCreditWallet = useMemo(() => {
    const lookupEmail = (email || currentUser?.email || '').trim().toLowerCase();
    return store.getCreditWalletForEmail(lookupEmail, name || currentUser?.name || 'Attendee', event.currency);
  }, [email, currentUser?.email, currentUser?.name, name, event.currency, step]);

  const basePricing = useMemo(
    () => store.calculateOrderSummary(selectedItems, event.id, appliedPromo?.code, 0),
    [selectedItems, event.id, appliedPromo?.code]
  );

  const maxRedeemableCredits = Math.min(attendeeCreditWallet.balanceTokens, basePricing.totalMinor);
  const parsedCustomCredits = customCreditsTokens.trim() === ''
    ? maxRedeemableCredits
    : Math.max(0, Math.min(maxRedeemableCredits, Math.floor(Number(customCreditsTokens) || 0)));
  const requestedCreditsTokens = applyCredits ? parsedCustomCredits : 0;

  const feeRate = store.getServiceFeeRate();
  const pricing = useMemo(
    () => store.calculateOrderSummary(selectedItems, event.id, appliedPromo?.code, requestedCreditsTokens),
    [selectedItems, event.id, appliedPromo?.code, requestedCreditsTokens]
  );

  const subtotal = pricing.subtotalMinor;
  const discountAmount = pricing.discountMinor;
  const fees = pricing.feeMinor;
  const creditsRedeemedMinor = pricing.creditsRedeemedMinor;
  const total = pricing.totalMinor;
  const totalTickets = selectedItems.reduce((acc, item) => acc + item.quantity, 0);
  const isFreeOrder = total === 0;
  const isSettledFullyByCredits = isFreeOrder && creditsRedeemedMinor > 0;

  const paymentGate = useMemo(
    () => store.canOrganizerReceivePayment(event, total + creditsRedeemedMinor),
    [event, total, creditsRedeemedMinor]
  );

  // Ordered payment rails customized to event currency
  const orderedRails = useMemo(() => {
    const base: Array<{
      id: PaymentRailId;
      title: string;
      subtitle: string;
      badge?: string;
      icon: 'card' | 'bank' | 'phone';
    }> = [
      {
        id: 'card',
        title: 'Debit or Credit Card',
        subtitle: `Visa, Mastercard & Verve · Processed via ${cardProcessorLabel}`,
        badge: event.currency === 'USD' || event.currency === 'NGN' || event.currency === 'ZAR' ? 'Recommended' : undefined,
        icon: 'card',
      },
      {
        id: 'ozow',
        title: 'Instant EFT',
        subtitle: 'Direct bank-to-bank settlement · FNB, Standard Bank, Capitec, Nedbank, Absa',
        badge: event.currency === 'ZAR' ? 'Zero Card Fees' : undefined,
        icon: 'bank',
      },
      {
        id: 'momo',
        title: 'Mobile Money',
        subtitle: 'M-Pesa, MTN MoMo & Airtel Money · Instant mobile wallet checkout',
        badge: isMomoDefaultCurrency ? 'Recommended' : undefined,
        icon: 'phone',
      },
    ];

    if (isMomoDefaultCurrency) {
      const momo = base.find(r => r.id === 'momo')!;
      const card = base.find(r => r.id === 'card')!;
      return [momo, card, ...base.filter(r => r.id !== 'momo' && r.id !== 'card')];
    }
    if (event.currency === 'ZAR') {
      const card = base.find(r => r.id === 'card')!;
      const ozow = base.find(r => r.id === 'ozow')!;
      return [card, ozow, ...base.filter(r => r.id !== 'card' && r.id !== 'ozow')];
    }
    return base;
  }, [event.currency, cardProcessorLabel, isMomoDefaultCurrency]);

  const settlementStages: SettlementStage[] = useMemo(() => {
    const railName = isFreeOrder
      ? 'Complimentary Allocation'
      : selectedRail === 'card'
        ? cardProcessorLabel
        : selectedRail === 'ozow'
          ? `Instant EFT · ${selectedBank}`
          : momoChannel === 'M-Pesa'
            ? 'M-Pesa'
            : `Mobile Money · ${momoChannel}`;

    return [
      {
        id: 'lock',
        label: 'Locking Tier Inventory',
        detail: `Reserving ${totalTickets} ${totalTickets === 1 ? 'pass' : 'passes'} under exclusive hold`,
      },
      {
        id: 'auth',
        label: isFreeOrder ? 'Validating Zero-Balance Allocation' : `Authorizing ${railName}`,
        detail: isFreeOrder ? 'Applying voucher / free admission authorization' : 'Verifying encrypted settlement handshake',
      },
      {
        id: 'ledger',
        label: 'Crediting Organizer Nexora Wallet',
        detail: 'Escrowing net ticket proceeds until event ends & balancing ledger',
      },
      {
        id: 'mint',
        label: 'Minting Cryptographic QR Passports',
        detail: `Signing unique gate tokens for ${email.trim()}`,
      },
    ];
  }, [isFreeOrder, selectedRail, cardProcessorLabel, selectedBank, momoChannel, totalTickets, email]);

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2200);
  };

  const handleApplyPromo = (e?: React.FormEvent) => {
    e?.preventDefault();
    setPromoError('');
    const code = promoCodeInput.trim().toUpperCase();
    if (!code) return;

    const validPromo = store.validatePromoCode(code, event.id);
    if (validPromo) {
      setAppliedPromo({
        code: validPromo.code,
        discountPct: validPromo.discountPercentage,
        discountMinor: validPromo.discountMinor,
      });
      setPromoCodeInput('');
    } else {
      setPromoError('Voucher code is invalid, expired, or not eligible for this event.');
    }
  };

  const handleRefreshHold = () => {
    setFormError(null);
    setHoldSecondsLeft(15 * 60);
  };

  const validateStep1 = (): string | null => {
    if (isHoldExpired) {
      return 'Your 15-minute ticket reservation expired. Refresh your hold to verify live availability.';
    }
    if (!name.trim() || name.trim().length < 2) {
      return 'Enter the full legal name of the primary pass holder.';
    }
    if (!isValidEmail(email)) {
      return 'Enter a valid email address for QR passport and receipt delivery.';
    }
    if (event.customQuestions?.length) {
      for (const q of event.customQuestions) {
        if (q.required) {
          const val = (customAnswers[q.id] || '').trim();
          if (!val || (q.type === 'checkbox' && val !== 'Yes')) {
            return `Please complete the required field: "${q.label}".`;
          }
        }
      }
    }
    const freshEvent = store.getEventById(event.id) || event;
    for (const item of selectedItems) {
      const tier = freshEvent.tickets.find(t => t.id === item.tierId);
      if (!tier) return 'Selected ticket tier is no longer available.';
      if (tier.remaining < item.quantity) {
        return `Only ${tier.remaining} remaining for ${tier.name}. Adjust quantity on the event page.`;
      }
    }
    return null;
  };

  const handleContinueToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStep1();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    if (!cardHolder.trim()) setCardHolder(name.trim());
    if (!momoPhone.trim() && phone.trim()) setMomoPhone(phone.trim());
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validatePaymentRail = (): {
    error: string | null;
    provider: Order['paymentProvider'];
    methodLabel: string;
  } => {
    if (isFreeOrder) {
      if (isSettledFullyByCredits) {
        return {
          error: null,
          provider: 'nexora_credits',
          methodLabel: `NXR Cashless Credits (${creditsRedeemedMinor.toLocaleString()} NXR)`,
        };
      }
      return {
        error: null,
        provider: 'sandbox',
        methodLabel: 'Complimentary Admission (100% Covered)',
      };
    }

    if (isHoldExpired) {
      return {
        error: 'Your reservation timer expired. Refresh your hold before authorizing payment.',
        provider: 'sandbox',
        methodLabel: '',
      };
    }

    if (selectedRail === 'card') {
      const digits = cardNumber.replace(/\D/g, '');
      if (!cardHolder.trim() || cardHolder.trim().length < 2) {
        return { error: 'Enter the cardholder name as printed on the card.', provider: regionalCardGateway, methodLabel: '' };
      }
      if (!isValidLuhn(digits)) {
        return { error: 'Enter a valid debit or credit card number.', provider: regionalCardGateway, methodLabel: '' };
      }
      if (!isValidExpiry(cardExpiry)) {
        return { error: 'Enter a valid future expiry date (MM/YY).', provider: regionalCardGateway, methodLabel: '' };
      }
      const cvcDigits = cardCvc.replace(/\D/g, '');
      if (cvcDigits.length < 3 || cvcDigits.length > 4) {
        return { error: 'Enter the 3 or 4-digit security code (CVC).', provider: regionalCardGateway, methodLabel: '' };
      }
      const brand = detectCardBrand(digits);
      return {
        error: null,
        provider: regionalCardGateway,
        methodLabel: `${brand} •••• ${digits.slice(-4)} (${cardProcessorLabel})`,
      };
    }

    if (selectedRail === 'ozow') {
      return {
        error: null,
        provider: 'ozow',
        methodLabel: `Instant EFT · ${selectedBank}`,
      };
    }

    const cleaned = momoPhone.replace(/[^\d+]/g, '');
    if (cleaned.replace(/\D/g, '').length < 8) {
      return {
        error:
          momoChannel === 'M-Pesa'
            ? 'Enter a valid M-Pesa mobile number (e.g. +254 712 345 678).'
            : `Enter your registered ${momoChannel} mobile number.`,
        provider: momoChannel === 'M-Pesa' ? 'mpesa' : 'flutterwave',
        methodLabel: '',
      };
    }
    if (momoChannel === 'M-Pesa') {
      return {
        error: null,
        provider: 'mpesa',
        methodLabel: `M-Pesa · ${momoPhone.trim()}`,
      };
    }
    return {
      error: null,
      provider: 'flutterwave',
      methodLabel: `${momoChannel} · ${momoPhone.trim()}`,
    };
  };

  const handleCompleteOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing) return;

    const step1Err = validateStep1();
    if (step1Err) {
      setFormError(step1Err);
      return;
    }

    const { error: railErr, provider, methodLabel } = validatePaymentRail();
    if (railErr) {
      setFormError(railErr);
      return;
    }

    setFormError(null);
    setIsProcessing(true);
    setSettlementStageIdx(0);
    setStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      await new Promise(r => window.setTimeout(r, 260));
      const orderRes = store.createOrder({
        eventId: event.id,
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: (phone || momoPhone).trim(),
        items: selectedItems,
        promoCode: appliedPromo?.code,
        creditsToRedeemTokens: requestedCreditsTokens,
        customAnswers: event.customQuestions?.length ? customAnswers : undefined,
      });

      if (!orderRes.success || !orderRes.order) {
        throw new Error(orderRes.error || 'Unable to lock inventory for this booking.');
      }

      setOrder(orderRes.order);
      setSettlementStageIdx(1);
      await new Promise(r => window.setTimeout(r, 340));

      setSettlementStageIdx(2);
      await new Promise(r => window.setTimeout(r, 260));

      const finalizeRes = store.finalizeOrderPayment(orderRes.order.id, provider, methodLabel);
      if (!finalizeRes.success || finalizeRes.tickets.length === 0) {
        throw new Error(finalizeRes.error || 'Payment settlement failed. No funds were captured.');
      }

      if (finalizeRes.order) {
        setOrder(finalizeRes.order);
      }

      setSettlementStageIdx(3);
      const tickets = finalizeRes.tickets;
      const qrs: Record<string, string> = {};
      for (const t of tickets) {
        try {
          qrs[t.id] = await QRCode.toDataURL(t.qrPayload, {
            width: 360,
            margin: 1,
            color: { dark: '#0A0A0C', light: '#FFFFFF' },
          });
        } catch (err) {
          console.error('QR generation error:', err);
        }
      }

      setTicketQrs(qrs);
      setIssuedTickets(tickets);
      onTicketsIssued(tickets);

      // Clear sensitive ephemeral card fields immediately on settlement
      setCardNumber('');
      setCardExpiry('');
      setCardCvc('');

      await new Promise(r => window.setTimeout(r, 220));
      setStep(4);

      try {
        confetti({
          particleCount: 75,
          spread: 68,
          origin: { y: 0.6 },
        });
      } catch {
        // Ignore confetti errors in headless environments
      }
    } catch (err: any) {
      setFormError(err?.message || 'Transaction could not be settled. Review your details and try again.');
      setStep(2);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadQrPass = (ticket: Ticket) => {
    const dataUrl = ticketQrs[ticket.id];
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${ticket.ticketCode}-PASS.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadIcs = () => {
    const startIso = new Date(event.startDate).toISOString().replace(/-|:|\.\d\d\d/g, '');
    const endIso = new Date(event.endDate).toISOString().replace(/-|:|\.\d\d\d/g, '');
    const safeTitle = event.title.replace(/[\r\n]/g, ' ');
    const safeVenue = `${event.venue.name}, ${event.venue.city}, ${event.venue.country}`.replace(/[\r\n]/g, ' ');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NEXORA//EventCommerce//EN',
      'BEGIN:VEVENT',
      `UID:${event.id}@nexora.events`,
      `DTSTAMP:${startIso}`,
      `DTSTART:${startIso}`,
      `DTEND:${endIso}`,
      `SUMMARY:${safeTitle}`,
      `LOCATION:${safeVenue}`,
      `DESCRIPTION:Order ${order?.orderReference || ''} · ${issuedTickets.length} Pass(es)`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.slug || event.id}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadReceipt = () => {
    if (!order) return;
    const lines = [
      'NEXORA — OFFICIAL SETTLEMENT RECEIPT',
      '========================================',
      `Order Reference:       ${order.orderReference}`,
      `Transaction Ref:       ${order.transactionReference}`,
      `Settled At:            ${new Date(order.createdAt).toLocaleString()}`,
      `Payment Method:        ${order.paymentMethod}`,
      `Payment Status:        ${order.paymentStatus.toUpperCase()}`,
      '',
      'EVENT DETAILS',
      '----------------------------------------',
      `Event:                 ${event.title}`,
      `Date & Time:           ${formatEventDate(event.startDate)} · ${formatEventTime(event.startDate)}`,
      `Venue:                 ${event.venue.name}, ${event.venue.city}, ${event.venue.country}`,
      '',
      'PASS HOLDER',
      '----------------------------------------',
      `Name:                  ${order.customerName}`,
      `Email:                 ${order.customerEmail}`,
      order.customerPhone ? `Phone:                 ${order.customerPhone}` : null,
      '',
      'ITEMIZED SETTLEMENT',
      '----------------------------------------',
      ...order.items.map(
        i => `${i.quantity}x ${i.tierName} — ${formatCurrency(i.totalPriceMinor, order.currency)}`
      ),
      `Subtotal:              ${formatCurrency(order.subtotalMinor, order.currency)}`,
      order.discountMinor > 0
        ? `Voucher Discount:      -${formatCurrency(order.discountMinor, order.currency)}`
        : null,
      `Service & Clearing:    ${formatCurrency(order.feeMinor, order.currency)}`,
      `TOTAL PAID:            ${formatCurrency(order.totalMinor, order.currency)}`,
      '',
      'ISSUED CRYPTOGRAPHIC PASSES',
      '----------------------------------------',
      ...issuedTickets.map((t, i) => `${i + 1}. ${t.ticketCode} · ${t.tierName} (${t.status.toUpperCase()})`),
    ]
      .filter(Boolean)
      .join('\n');

    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${order.orderReference}-RECEIPT.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    event.title
  )}&dates=${new Date(event.startDate).toISOString().replace(/-|:|\.\d\d\d/g, '')}/${new Date(
    event.endDate
  )
    .toISOString()
    .replace(/-|:|\.\d\d\d/g, '')}&details=${encodeURIComponent(
    event.shortSummary || ''
  )}&location=${encodeURIComponent(`${event.venue.name}, ${event.venue.city}`)}`;

  // Shared surface & ring classes (respecting global border reset by using ring-1 & surface depth)
  const surfacePanel = isDark
    ? 'bg-[#0E0E12] ring-1 ring-white/10'
    : 'bg-neutral-50 ring-1 ring-black/10';
  const surfaceInner = isDark
    ? 'bg-[#16161D] ring-1 ring-white/10'
    : 'bg-white ring-1 ring-black/10';
  const inputSurface = isDark
    ? 'bg-black text-white placeholder:text-neutral-500 ring-1 ring-white/15 focus:ring-2 focus:ring-amber-400'
    : 'bg-white text-black placeholder:text-neutral-400 ring-1 ring-black/15 focus:ring-2 focus:ring-black';
  const hairlineDivider = isDark ? 'h-px w-full bg-white/10' : 'h-px w-full bg-black/10';
  const mutedText = isDark ? 'text-neutral-400' : 'text-neutral-600';

  const cardDigitsOnly = cardNumber.replace(/\D/g, '');
  const detectedCardBrand = cardDigitsOnly.length > 0 ? detectCardBrand(cardDigitsOnly) : null;

  return (
    <div
      className={`min-h-screen transition-colors ${
        isDark ? 'bg-black text-white' : 'bg-white text-black'
      }`}
    >
      {/* Top Sticky Settlement Bar */}
      <div
        className={`sticky top-18 z-30 w-full backdrop-blur-md transition-colors ${
          isDark ? 'bg-black/90 text-white' : 'bg-white/90 text-black'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            disabled={step === 3}
            onClick={() => {
              if (step === 2) {
                setFormError(null);
                setStep(1);
              } else {
                onBack();
              }
            }}
            className={`inline-flex items-center gap-2 min-h-10 text-xs font-bold uppercase tracking-wider transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              isDark ? 'text-white hover:opacity-75' : 'text-black hover:opacity-75'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>
              {step === 2 ? 'Attendee Details' : 'Back to Event'}
            </span>
          </button>

          {/* Clean 3-Stage Step Progression (Unboxed Typography) */}
          <nav aria-label="Checkout progress" className="hidden md:flex items-center gap-4 text-xs font-mono">
            {[
              { num: '01', label: 'Details', active: step === 1, done: step > 1 },
              { num: '02', label: 'Settlement', active: step === 2 || step === 3, done: step === 4 },
              { num: '03', label: 'Passports', active: step === 4, done: false },
            ].map((item, idx) => (
              <React.Fragment key={item.num}>
                {idx > 0 && <span className="opacity-25">·</span>}
                <span
                  className={`inline-flex items-center gap-1.5 transition-opacity ${
                    item.active
                      ? isDark
                        ? 'text-white font-bold'
                        : 'text-black font-bold'
                      : item.done
                        ? 'text-emerald-500 font-bold'
                        : 'opacity-40'
                  }`}
                >
                  <span>{item.done ? '✓' : item.num}</span>
                  <span>{item.label}</span>
                </span>
              </React.Fragment>
            ))}
          </nav>

          {/* Live Reservation Hold Timer / Confirmed Ref */}
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
            {step < 3 && (
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                  isHoldExpired
                    ? 'bg-red-500/15 text-red-500 ring-1 ring-red-500/30'
                    : isHoldExpiringSoon
                      ? 'bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30'
                      : isDark
                        ? 'bg-[#16161D] text-neutral-300 ring-1 ring-white/10'
                        : 'bg-neutral-100 text-neutral-700 ring-1 ring-black/10'
                }`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>{isHoldExpired ? 'Hold Expired' : `Hold ${holdFormatted}`}</span>
              </div>
            )}
            {step === 4 && order && (
              <span className="text-emerald-500 font-bold">{order.orderReference}</span>
            )}
          </div>
        </div>
        <div className={hairlineDivider} />
      </div>

      {/* Main Content Container */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {/* Global Inline Error Banner */}
        {formError && (step === 1 || step === 2) && (
          <div
            role="alert"
            className={`mb-6 p-4 rounded-2xl flex items-start justify-between gap-3 ${
              isDark
                ? 'bg-red-950/60 text-red-200 ring-1 ring-red-500/40'
                : 'bg-red-50 text-red-900 ring-1 ring-red-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">{formError}</p>
                {isHoldExpired && (
                  <button
                    type="button"
                    onClick={handleRefreshHold}
                    className="text-xs font-mono font-bold underline cursor-pointer"
                  >
                    Refresh 15:00 Inventory Hold
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFormError(null)}
              aria-label="Dismiss error"
              className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEPS 1 & 2: Two-Column Checkout & Settlement */}
        {(step === 1 || step === 2) && (
          <div className="space-y-8">
            <div className="space-y-2">
              <p className={`text-xs font-mono uppercase tracking-widest ${mutedText}`}>
                {step === 1 ? 'Step 01 · Attendee Verification' : 'Step 02 · Payment Settlement'}
              </p>
              <h1 className="text-2xl sm:text-4xl font-black tracking-tight">
                {step === 1 ? 'Confirm Pass Holder Details' : 'Authorize Payment Settlement'}
              </h1>
              <p className={`text-xs sm:text-sm font-mono ${mutedText}`}>
                {event.title} · {formatEventDate(event.startDate)} · {event.venue.city}, {event.venue.country}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
              {/* LEFT COLUMN (7 Cols): Active Step Form */}
              <div className="lg:col-span-7 space-y-6">
                {step === 1 && (
                  <form onSubmit={handleContinueToPayment} className="space-y-6" noValidate>
                    <div className={`p-6 sm:p-8 rounded-3xl space-y-5 ${surfacePanel}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-bold tracking-tight">Attendee & Delivery</h2>
                          <p className={`text-xs mt-0.5 ${mutedText}`}>
                            Cryptographic QR passes and your settlement receipt will be issued to this address.
                          </p>
                        </div>
                        {currentUser && (
                          <span className="text-[11px] font-mono text-emerald-500 font-bold shrink-0">
                            Account Synced
                          </span>
                        )}
                      </div>

                      <div className={hairlineDivider} />

                      <div className="space-y-4">
                        <div>
                          <label
                            htmlFor="checkout-name"
                            className={`block text-xs font-mono font-bold mb-1.5 ${mutedText}`}
                          >
                            Full Legal Name *
                          </label>
                          <input
                            id="checkout-name"
                            type="text"
                            autoComplete="name"
                            required
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className={`w-full min-h-11 px-4 py-3 rounded-xl text-sm focus:outline-none transition-shadow ${inputSurface}`}
                            placeholder="e.g. Tendai Chiwenga"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label
                              htmlFor="checkout-email"
                              className={`block text-xs font-mono font-bold mb-1.5 ${mutedText}`}
                            >
                              Email Address *
                            </label>
                            <input
                              id="checkout-email"
                              type="email"
                              autoComplete="email"
                              required
                              value={email}
                              onChange={e => setEmail(e.target.value)}
                              className={`w-full min-h-11 px-4 py-3 rounded-xl text-sm focus:outline-none transition-shadow ${inputSurface}`}
                              placeholder="name@example.com"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="checkout-phone"
                              className={`block text-xs font-mono font-bold mb-1.5 ${mutedText}`}
                            >
                              Mobile Number (SMS & Mobile Money)
                            </label>
                            <input
                              id="checkout-phone"
                              type="tel"
                              autoComplete="tel"
                              value={phone}
                              onChange={e => setPhone(e.target.value)}
                              className={`w-full min-h-11 px-4 py-3 rounded-xl text-sm focus:outline-none transition-shadow ${inputSurface}`}
                              placeholder="+27 82 000 0000"
                            />
                          </div>
                        </div>

                        {currentUser?.email &&
                          email.trim().toLowerCase() !== currentUser.email.toLowerCase() && (
                            <p className="text-xs font-mono text-amber-500">
                              Note: Tickets will be delivered to {email.trim() || 'the entered email'}. To view them in your signed-in Vault, keep {currentUser.email}.
                            </p>
                          )}
                      </div>

                      {/* Event Custom Registration Questions (when defined by organizer) */}
                      {event.customQuestions && event.customQuestions.length > 0 && (
                        <>
                          <div className={hairlineDivider} />
                          <div className="space-y-4">
                            <h3 className="text-sm font-bold tracking-tight">Organizer Questions</h3>
                            {event.customQuestions.map(q => (
                              <div key={q.id}>
                                <label
                                  htmlFor={`q-${q.id}`}
                                  className={`block text-xs font-mono font-bold mb-1.5 ${mutedText}`}
                                >
                                  {q.label} {q.required ? '*' : ''}
                                </label>
                                {q.type === 'text' && (
                                  <input
                                    id={`q-${q.id}`}
                                    type="text"
                                    value={customAnswers[q.id] || ''}
                                    onChange={e =>
                                      setCustomAnswers(prev => ({ ...prev, [q.id]: e.target.value }))
                                    }
                                    className={`w-full min-h-11 px-4 py-3 rounded-xl text-sm focus:outline-none ${inputSurface}`}
                                    placeholder="Your response"
                                  />
                                )}
                                {q.type === 'dropdown' && (
                                  <select
                                    id={`q-${q.id}`}
                                    value={customAnswers[q.id] || ''}
                                    onChange={e =>
                                      setCustomAnswers(prev => ({ ...prev, [q.id]: e.target.value }))
                                    }
                                    className={`w-full min-h-11 px-4 py-3 rounded-xl text-sm focus:outline-none ${inputSurface}`}
                                  >
                                    {(q.options || []).map(opt => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {q.type === 'checkbox' && (
                                  <label className="inline-flex items-center gap-2.5 cursor-pointer py-1 text-sm">
                                    <input
                                      id={`q-${q.id}`}
                                      type="checkbox"
                                      checked={customAnswers[q.id] === 'Yes'}
                                      onChange={e =>
                                        setCustomAnswers(prev => ({
                                          ...prev,
                                          [q.id]: e.target.checked ? 'Yes' : 'No',
                                        }))
                                      }
                                      className="w-4 h-4 accent-amber-500"
                                    />
                                    <span>Yes, confirmed</span>
                                  </label>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      type="submit"
                      className={`w-full min-h-12 py-4 px-6 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2.5 ${
                        isDark
                          ? 'bg-white text-black hover:bg-neutral-200'
                          : 'bg-black text-white hover:bg-neutral-800'
                      }`}
                    >
                      <span>
                        {isFreeOrder ? 'Continue to Claim Free Passes' : 'Continue to Payment Settlement'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                )}

                {step === 2 && (
                  <form onSubmit={handleCompleteOrder} className="space-y-6" noValidate>
                    {/* Compact Attendee Summary Strip */}
                    <div className={`px-5 py-4 rounded-2xl flex items-center justify-between gap-4 ${surfacePanel}`}>
                      <div className="min-w-0">
                        <p className={`text-[11px] font-mono uppercase tracking-wider ${mutedText}`}>
                          Issuing {totalTickets} {totalTickets === 1 ? 'Pass' : 'Passes'} To
                        </p>
                        <p className="text-sm font-bold truncate">
                          {name.trim()} · <span className="font-mono font-normal opacity-80">{email.trim()}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFormError(null);
                          setStep(1);
                        }}
                        className="text-xs font-mono font-bold underline shrink-0 cursor-pointer py-1 px-2"
                      >
                        Edit
                      </button>
                    </div>

                    {/* Payment Rail Selector OR Full Credit / Free Admission */}
                    {isFreeOrder ? (
                      <div className={`p-6 sm:p-8 rounded-3xl space-y-3 ${surfacePanel}`}>
                        <div className="flex items-center gap-2.5 text-emerald-500">
                          <CheckCircle2 className="w-5 h-5" />
                          <h2 className="text-base font-bold tracking-tight">
                            {isSettledFullyByCredits ? 'Settled with NXR Cashless Credits' : 'Complimentary Admission'}
                          </h2>
                        </div>
                        <p className={`text-sm ${mutedText}`}>
                          {isSettledFullyByCredits
                            ? `Your NXR Credit balance covers 100% of this booking (${creditsRedeemedMinor.toLocaleString()} NXR = ${formatCurrency(creditsRedeemedMinor, event.currency)}). Click below to settle and mint your passes immediately.`
                            : `Your order total is ${formatCurrency(0, event.currency)}. No card or mobile wallet authorization is required—click below to mint your cryptographic QR passes immediately.`}
                        </p>
                      </div>
                    ) : (
                      <div className={`p-6 sm:p-8 rounded-3xl space-y-5 ${surfacePanel}`}>
                        {!paymentGate.allowed && (
                          <div
                            role="alert"
                            className={`p-4 rounded-2xl flex items-start gap-3 text-xs ${
                              isDark
                                ? 'bg-amber-950/50 text-amber-200 ring-1 ring-amber-500/40'
                                : 'bg-amber-50 text-amber-900 ring-1 ring-amber-300'
                            }`}
                          >
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                            <span>{paymentGate.reason}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h2 className="text-lg font-bold tracking-tight">Select Payment Rail</h2>
                            <p className={`text-xs mt-0.5 ${mutedText}`}>
                              Settling in {event.currency} · Funds settle to the Organizer Nexora Wallet until event completion
                            </p>
                          </div>
                          <Lock className={`w-4 h-4 shrink-0 ${mutedText}`} />
                        </div>

                        <div className="space-y-3">
                          {orderedRails.map(rail => {
                            const isSelected = selectedRail === rail.id;
                            return (
                              <div
                                key={rail.id}
                                className={`rounded-2xl transition-all ${
                                  isSelected
                                    ? isDark
                                      ? 'bg-black ring-2 ring-amber-400'
                                      : 'bg-white ring-2 ring-black'
                                    : isDark
                                      ? 'bg-black/50 ring-1 ring-white/10 hover:ring-white/25'
                                      : 'bg-white/70 ring-1 ring-black/10 hover:ring-black/25'
                                }`}
                              >
                                <label className="flex items-start gap-3.5 p-4 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="paymentRail"
                                    checked={isSelected}
                                    onChange={() => {
                                      setFormError(null);
                                      setSelectedRail(rail.id);
                                    }}
                                    className="mt-1 w-4 h-4 accent-amber-500 cursor-pointer"
                                  />
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-bold text-sm inline-flex items-center gap-2">
                                        {rail.icon === 'card' && <CreditCard className="w-4 h-4 text-amber-500" />}
                                        {rail.icon === 'bank' && <Landmark className="w-4 h-4 text-emerald-500" />}
                                        {rail.icon === 'phone' && <Smartphone className="w-4 h-4 text-emerald-500" />}
                                        <span>{rail.title}</span>
                                      </span>
                                      {rail.badge && (
                                        <span className="text-[11px] font-mono font-bold text-emerald-500 uppercase tracking-wider">
                                          {rail.badge}
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-xs ${mutedText}`}>{rail.subtitle}</p>
                                  </div>
                                </label>

                                {/* Contextual Inline Configuration Panel */}
                                {isSelected && rail.id === 'card' && (
                                  <div className="px-4 pb-5 pt-1 space-y-3.5">
                                    <div className={hairlineDivider} />
                                    <div className="pt-2 space-y-3">
                                      <div>
                                        <label
                                          htmlFor="card-holder"
                                          className={`block text-[11px] font-mono font-bold mb-1 ${mutedText}`}
                                        >
                                          Cardholder Name
                                        </label>
                                        <input
                                          id="card-holder"
                                          type="text"
                                          autoComplete="cc-name"
                                          value={cardHolder}
                                          onChange={e => setCardHolder(e.target.value)}
                                          placeholder="Name on card"
                                          className={`w-full min-h-10 px-3.5 py-2.5 rounded-xl text-sm focus:outline-none ${inputSurface}`}
                                        />
                                      </div>

                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <label
                                            htmlFor="card-number"
                                            className={`block text-[11px] font-mono font-bold ${mutedText}`}
                                          >
                                            Card Number
                                          </label>
                                          {detectedCardBrand && (
                                            <span className="text-[11px] font-mono font-bold uppercase text-amber-500">
                                              {detectedCardBrand}
                                            </span>
                                          )}
                                        </div>
                                        <input
                                          id="card-number"
                                          type="text"
                                          inputMode="numeric"
                                          autoComplete="cc-number"
                                          value={cardNumber}
                                          onChange={e => setCardNumber(formatCardNumberInput(e.target.value))}
                                          placeholder="4532 •••• •••• ••••"
                                          className={`w-full min-h-10 px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${inputSurface}`}
                                        />
                                      </div>

                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label
                                            htmlFor="card-expiry"
                                            className={`block text-[11px] font-mono font-bold mb-1 ${mutedText}`}
                                          >
                                            Expiry (MM/YY)
                                          </label>
                                          <input
                                            id="card-expiry"
                                            type="text"
                                            inputMode="numeric"
                                            autoComplete="cc-exp"
                                            value={cardExpiry}
                                            onChange={e => setCardExpiry(formatExpiryInput(e.target.value))}
                                            placeholder="MM/YY"
                                            className={`w-full min-h-10 px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${inputSurface}`}
                                          />
                                        </div>
                                        <div>
                                          <label
                                            htmlFor="card-cvc"
                                            className={`block text-[11px] font-mono font-bold mb-1 ${mutedText}`}
                                          >
                                            Security Code (CVC)
                                          </label>
                                          <input
                                            id="card-cvc"
                                            type="password"
                                            inputMode="numeric"
                                            autoComplete="cc-csc"
                                            maxLength={4}
                                            value={cardCvc}
                                            onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                            placeholder="•••"
                                            className={`w-full min-h-10 px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${inputSurface}`}
                                          />
                                        </div>
                                      </div>

                                      <p className={`text-[11px] font-mono ${mutedText}`}>
                                        Tokenized via {cardProcessorLabel} · Card numbers are never persisted on Nexora servers.
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {isSelected && rail.id === 'ozow' && (
                                  <div className="px-4 pb-5 pt-1 space-y-3">
                                    <div className={hairlineDivider} />
                                    <p className={`text-[11px] font-mono font-bold pt-2 ${mutedText}`}>
                                      Select Your Bank
                                    </p>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                      {EFT_BANKS.map(bank => {
                                        const active = selectedBank === bank;
                                        return (
                                          <button
                                            key={bank}
                                            type="button"
                                            onClick={() => setSelectedBank(bank)}
                                            className={`min-h-10 px-3 py-2 rounded-xl text-xs font-semibold text-left transition-all cursor-pointer ${
                                              active
                                                ? isDark
                                                  ? 'bg-white text-black'
                                                  : 'bg-black text-white'
                                                : surfaceInner
                                            }`}
                                          >
                                            {bank}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <p className={`text-[11px] font-mono ${mutedText}`}>
                                      Instant bank-to-bank EFT clearing with {selectedBank} · Zero card surcharge.
                                    </p>
                                  </div>
                                )}

                                {isSelected && rail.id === 'momo' && (
                                  <div className="px-4 pb-5 pt-1 space-y-3">
                                    <div className={hairlineDivider} />
                                    <div className="pt-2 space-y-3">
                                      <div className="flex flex-wrap gap-2">
                                        {MOMO_CHANNELS.map(ch => {
                                          const active = momoChannel === ch;
                                          return (
                                            <button
                                              key={ch}
                                              type="button"
                                              onClick={() => {
                                                setFormError(null);
                                                setMomoChannel(ch);
                                              }}
                                              className={`min-h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                                active
                                                  ? isDark
                                                    ? 'bg-white text-black'
                                                    : 'bg-black text-white'
                                                  : surfaceInner
                                              }`}
                                            >
                                              {ch}
                                            </button>
                                          );
                                        })}
                                      </div>
                                      <div>
                                        <label
                                          htmlFor="momo-phone"
                                          className={`block text-[11px] font-mono font-bold mb-1 ${mutedText}`}
                                        >
                                          {momoChannel} Mobile Number
                                        </label>
                                        <input
                                          id="momo-phone"
                                          type="tel"
                                          value={momoPhone}
                                          onChange={e => setMomoPhone(e.target.value)}
                                          placeholder={momoChannel === 'M-Pesa' ? '+254 712 345 678' : '+233 24 000 0000'}
                                          className={`w-full max-w-sm min-h-10 px-3.5 py-2.5 rounded-xl text-sm font-mono tabular-nums focus:outline-none ${inputSurface}`}
                                        />
                                        <p className={`text-[11px] font-mono mt-2 ${mutedText}`}>
                                          Approve the {momoChannel} payment prompt on your device to authorize {formatCurrency(total, event.currency)}.
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action Row */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setFormError(null);
                          setStep(1);
                        }}
                        className={`min-h-12 px-6 py-3.5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${surfacePanel}`}
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={isProcessing || isHoldExpired || (!isFreeOrder && !paymentGate.allowed)}
                        className={`flex-1 min-h-12 py-4 px-6 text-xs font-bold uppercase tracking-wider rounded-2xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 ${
                          isDark
                            ? 'bg-white hover:bg-neutral-200 text-black'
                            : 'bg-black hover:bg-neutral-800 text-white'
                        }`}
                      >
                        <Lock className="w-4 h-4" />
                        <span>
                          {isFreeOrder
                            ? 'Confirm & Issue Free Passes'
                            : `Authorize & Pay ${formatCurrency(total, event.currency)}`}
                        </span>
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* RIGHT COLUMN (5 Cols): Sticky Order Breakdown Dossier */}
              <div className="lg:col-span-5">
                <div className={`p-6 sm:p-8 rounded-3xl space-y-5 sticky top-36 ${surfacePanel}`}>
                  {/* Event Thumbnail Header */}
                  <div className="flex items-center gap-4">
                    <img
                      src={event.coverImage}
                      alt={event.title}
                      className="w-16 h-16 rounded-2xl object-cover shrink-0"
                    />
                    <div className="min-w-0 space-y-1">
                      <p className={`text-[11px] font-mono uppercase tracking-wider ${mutedText}`}>
                        {event.category}
                      </p>
                      <h3 className="text-sm font-bold leading-snug line-clamp-2">{event.title}</h3>
                      <p className={`text-[11px] font-mono ${mutedText}`}>
                        {formatEventDate(event.startDate)} · {formatEventTime(event.startDate)}
                      </p>
                    </div>
                  </div>

                  <div className={hairlineDivider} />

                  {/* Selected Tickets List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-mono uppercase tracking-wider ${mutedText}`}>
                        Passes ({totalTickets})
                      </span>
                      <button
                        type="button"
                        onClick={onBack}
                        className="text-xs font-mono underline opacity-70 hover:opacity-100 cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                    <div className="space-y-2.5">
                      {orderItemsWithDetails.map(item => (
                        <div key={item.tierId} className="flex items-baseline justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <span className="font-semibold">
                              {item.quantity}× {item.tierName}
                            </span>
                            <span className={`block text-[11px] font-mono tabular-nums ${mutedText}`}>
                              {formatCurrency(item.unitPriceMinor, event.currency)} each
                            </span>
                          </div>
                          <span className="font-mono font-bold tabular-nums shrink-0">
                            {formatCurrency(item.subtotalMinor, event.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={hairlineDivider} />

                  {/* Promo / Voucher Code */}
                  <form onSubmit={handleApplyPromo} className="space-y-2">
                    <label
                      htmlFor="promo-code"
                      className={`block text-[11px] font-mono uppercase tracking-wider ${mutedText}`}
                    >
                      Promo or Voucher Code
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="promo-code"
                        type="text"
                        value={promoCodeInput}
                        onChange={e => setPromoCodeInput(e.target.value.toUpperCase())}
                        placeholder="ENTER CODE"
                        className={`flex-1 min-h-10 px-3.5 py-2 text-xs rounded-xl uppercase font-mono focus:outline-none ${inputSurface}`}
                      />
                      <button
                        type="submit"
                        className={`min-h-10 px-4 py-2 text-xs font-bold rounded-xl cursor-pointer transition-colors ${
                          isDark
                            ? 'bg-white text-black hover:bg-neutral-200'
                            : 'bg-black text-white hover:bg-neutral-800'
                        }`}
                      >
                        Apply
                      </button>
                    </div>
                    {appliedPromo && (
                      <div className="flex items-center justify-between text-xs font-mono text-emerald-500 pt-1">
                        <span>
                          Voucher {appliedPromo.code} applied (
                          {appliedPromo.discountMinor && appliedPromo.discountMinor > 0
                            ? `${formatCurrency(appliedPromo.discountMinor, event.currency)} off`
                            : `${appliedPromo.discountPct}% off`}
                          )
                        </span>
                        <button
                          type="button"
                          onClick={() => setAppliedPromo(null)}
                          className="underline cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    {promoError && <p className="text-xs text-red-500 font-mono">{promoError}</p>}
                  </form>

                  <div className={hairlineDivider} />

                  {/* NXR Cashless & Loyalty Credit Redemption */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={maxRedeemableCredits <= 0 || step >= 3}
                          checked={applyCredits && maxRedeemableCredits > 0}
                          onChange={e => {
                            setApplyCredits(e.target.checked);
                            if (e.target.checked && !customCreditsTokens) {
                              setCustomCreditsTokens(String(maxRedeemableCredits));
                            }
                          }}
                          className="w-4 h-4 accent-amber-500 cursor-pointer disabled:opacity-40"
                        />
                        <Coins className="w-3.5 h-3.5 text-amber-500" />
                        <span>Redeem NXR Credits</span>
                      </label>
                      <span className={`text-[11px] font-mono tabular-nums ${mutedText}`}>
                        {attendeeCreditWallet.balanceTokens.toLocaleString()} NXR ({formatCurrency(attendeeCreditWallet.balanceTokens, event.currency)})
                      </span>
                    </div>

                    {applyCredits && maxRedeemableCredits > 0 && step < 3 && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={maxRedeemableCredits}
                          value={customCreditsTokens}
                          onChange={e => setCustomCreditsTokens(e.target.value)}
                          className={`flex-1 min-h-9 px-3 py-1.5 rounded-xl text-xs font-mono tabular-nums focus:outline-none ${inputSurface}`}
                          aria-label="NXR Credits to redeem"
                        />
                        <button
                          type="button"
                          onClick={() => setCustomCreditsTokens(String(maxRedeemableCredits))}
                          className={`min-h-9 px-3 py-1.5 rounded-xl text-[11px] font-mono font-bold cursor-pointer ${surfaceInner}`}
                        >
                          Max
                        </button>
                      </div>
                    )}
                  </div>

                  <div className={hairlineDivider} />

                  {/* Financial Ledger Breakdown (Synced 1:1 with store.createOrder) */}
                  <div className="space-y-2.5 text-xs font-mono tabular-nums">
                    <div className="flex justify-between">
                      <span className={mutedText}>Subtotal</span>
                      <span>{formatCurrency(subtotal, event.currency)}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-500">
                        <span>Voucher Discount ({appliedPromo?.code})</span>
                        <span>-{formatCurrency(discountAmount, event.currency)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className={mutedText}>
                        Service & Clearing ({(feeRate * 100).toFixed(1)}%)
                      </span>
                      <span>{formatCurrency(fees, event.currency)}</span>
                    </div>
                    {creditsRedeemedMinor > 0 && (
                      <div className="flex justify-between text-amber-500">
                        <span>NXR Credits Applied ({creditsRedeemedMinor.toLocaleString()} NXR)</span>
                        <span>-{formatCurrency(creditsRedeemedMinor, event.currency)}</span>
                      </div>
                    )}
                    <div className={hairlineDivider} />
                    <div className="flex justify-between items-baseline text-base font-sans font-black pt-1">
                      <span>Total Due</span>
                      <span className="text-xl font-mono tabular-nums">
                        {formatCurrency(total, event.currency)}
                      </span>
                    </div>
                  </div>

                  <div className={`text-[11px] font-mono text-center flex items-center justify-center gap-2 pt-1 ${mutedText}`}>
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    <span>256-Bit TLS · Double-Entry Ledger Protection</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Live Settlement & Issuance Pipeline */}
        {step === 3 && (
          <div className="py-12 sm:py-20 max-w-xl mx-auto">
            <div className={`p-8 sm:p-10 rounded-3xl space-y-8 ${surfacePanel}`}>
              <div className="text-center space-y-3">
                <div
                  className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center ${
                    isDark ? 'bg-black ring-1 ring-white/15' : 'bg-white ring-1 ring-black/10'
                  }`}
                >
                  <Loader2 className="w-7 h-7 animate-spin text-amber-500" />
                </div>
                <p className={`text-xs font-mono uppercase tracking-widest ${mutedText}`}>
                  Live Settlement Pipeline
                </p>
                <h2 className="text-2xl font-black tracking-tight">Securing Your Admission</h2>
                <p className={`text-xs font-mono ${mutedText}`}>
                  Settling {formatCurrency(total, event.currency)} for {totalTickets}{' '}
                  {totalTickets === 1 ? 'pass' : 'passes'}
                </p>
              </div>

              <div className={hairlineDivider} />

              <div className="space-y-4">
                {settlementStages.map((stage, idx) => {
                  const isDone = idx < settlementStageIdx;
                  const isActive = idx === settlementStageIdx;
                  return (
                    <div key={stage.id} className="flex items-start gap-3.5">
                      <div className="mt-0.5 shrink-0">
                        {isDone ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : isActive ? (
                          <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                        ) : (
                          <div
                            className={`w-5 h-5 rounded-full ring-1 ${
                              isDark ? 'ring-white/20' : 'ring-black/20'
                            }`}
                          />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <p
                          className={`text-sm font-bold ${
                            isDone || isActive ? '' : 'opacity-45'
                          }`}
                        >
                          {stage.label}
                        </p>
                        <p className={`text-xs font-mono ${mutedText}`}>{stage.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Confirmed Settlement Receipt & Digital QR Passports */}
        {step === 4 && (
          <div className="space-y-10 max-w-5xl mx-auto">
            {/* Confirmation Header & Settlement Receipt Card */}
            <div className={`p-6 sm:p-10 rounded-3xl space-y-6 ${surfacePanel}`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Settlement Confirmed</span>
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
                    Your Passes Are Ready
                  </h2>
                  <p className={`text-sm max-w-xl ${mutedText}`}>
                    Cryptographic QR passports have been issued to <strong className={isDark ? 'text-white' : 'text-black'}>{email}</strong> and synced to your Ticket Wallet.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={onGoToWallet}
                    className={`min-h-11 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors inline-flex items-center gap-2 ${
                      isDark
                        ? 'bg-white text-black hover:bg-neutral-200'
                        : 'bg-black text-white hover:bg-neutral-800'
                    }`}
                  >
                    <TicketIcon className="w-4 h-4" />
                    <span>Open Ticket Wallet</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadReceipt}
                    className={`min-h-11 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors inline-flex items-center gap-2 ${surfaceInner}`}
                  >
                    <Receipt className="w-4 h-4" />
                    <span>Receipt</span>
                  </button>
                </div>
              </div>

              <div className={hairlineDivider} />

              {/* Authoritative Settlement Metadata Grid */}
              {order && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 text-xs">
                  <div className="space-y-1">
                    <span className={`font-mono uppercase tracking-wider block ${mutedText}`}>
                      Order Reference
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('orderRef', order.orderReference)}
                      className="font-mono font-bold tabular-nums inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80"
                    >
                      <span>{order.orderReference}</span>
                      {copiedKey === 'orderRef' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 opacity-60" />
                      )}
                    </button>
                  </div>

                  <div className="space-y-1">
                    <span className={`font-mono uppercase tracking-wider block ${mutedText}`}>
                      Transaction ID
                    </span>
                    <span className="font-mono font-bold tabular-nums block truncate">
                      {order.transactionReference}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className={`font-mono uppercase tracking-wider block ${mutedText}`}>
                      Payment Rail
                    </span>
                    <span className="font-semibold block truncate">{order.paymentMethod}</span>
                  </div>

                  <div className="space-y-1">
                    <span className={`font-mono uppercase tracking-wider block ${mutedText}`}>
                      Total Settled
                    </span>
                    <span className="font-mono font-bold tabular-nums text-emerald-500 block">
                      {formatCurrency(order.totalMinor, order.currency)}
                    </span>
                  </div>
                </div>
              )}

              {order && ((order.creditsMintedTokens || 0) > 0 || (order.creditsRedeemedTokens || 0) > 0) && (
                <div className={`p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs font-mono ${surfaceInner}`}>
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>
                      {(order.creditsMintedTokens || 0) > 0
                        ? `Minted +${(order.creditsMintedTokens || 0).toLocaleString()} NXR Loyalty Credits (${formatCurrency(order.creditsMintedTokens || 0, order.currency)} value)`
                        : `Settled using ${(order.creditsRedeemedTokens || 0).toLocaleString()} NXR Credits`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onGoToWallet}
                    className="font-bold underline cursor-pointer text-amber-500"
                  >
                    View NXR Credit Vault
                  </button>
                </div>
              )}

              <div className={hairlineDivider} />

              {/* Calendar Export & Marketplace Return */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`text-xs font-mono inline-flex items-center gap-1.5 mr-1 ${mutedText}`}>
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Save to Calendar:</span>
                  </span>
                  <a
                    href={googleCalendarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`min-h-9 px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-opacity hover:opacity-80 ${surfaceInner}`}
                  >
                    <span>Google Calendar</span>
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                  <button
                    type="button"
                    onClick={handleDownloadIcs}
                    className={`min-h-9 px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-80 ${surfaceInner}`}
                  >
                    <Download className="w-3 h-3 opacity-60" />
                    <span>Apple / Outlook (.ics)</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onBack}
                  className="text-xs font-mono font-bold underline opacity-75 hover:opacity-100 cursor-pointer py-1"
                >
                  Return to Event Page
                </button>
              </div>
            </div>

            {/* Issued Digital Passports Grid */}
            <div className="space-y-4">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-lg font-bold tracking-tight">
                  Digital Gate Passports ({issuedTickets.length})
                </h3>
                <span className={`text-xs font-mono ${mutedText}`}>
                  {event.venue.name} · {event.venue.city}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {issuedTickets.map((ticket, index) => (
                  <div
                    key={ticket.id}
                    className={`p-6 rounded-3xl space-y-5 ${surfacePanel}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <span className={`text-[11px] font-mono uppercase tracking-wider block ${mutedText}`}>
                          Pass {index + 1} of {issuedTickets.length} · Valid Entry
                        </span>
                        <h4 className="font-bold text-base">{ticket.tierName}</h4>
                      </div>
                      <span className="text-xs font-mono font-bold text-emerald-500 uppercase">
                        {ticket.status}
                      </span>
                    </div>

                    {/* Scannable High-Contrast QR Frame */}
                    <div className="p-5 bg-white rounded-2xl flex items-center justify-center">
                      {ticketQrs[ticket.id] ? (
                        <img
                          src={ticketQrs[ticket.id]}
                          alt={`QR pass ${ticket.ticketCode}`}
                          className="w-48 h-48 object-contain"
                        />
                      ) : (
                        <div className="w-48 h-48 flex items-center justify-center text-xs text-black font-mono">
                          Generating QR...
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="min-w-0 font-mono text-xs space-y-0.5">
                        <button
                          type="button"
                          onClick={() => handleCopy(ticket.id, ticket.ticketCode)}
                          className="font-bold tracking-wider inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80"
                        >
                          <span>{ticket.ticketCode}</span>
                          {copiedKey === ticket.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 opacity-60" />
                          )}
                        </button>
                        <p className={`text-[11px] truncate ${mutedText}`}>
                          {ticket.attendeeName}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={!ticketQrs[ticket.id]}
                        onClick={() => handleDownloadQrPass(ticket)}
                        className={`min-h-10 px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors shrink-0 ${surfaceInner}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Save PNG</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
