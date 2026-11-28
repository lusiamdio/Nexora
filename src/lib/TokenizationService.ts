import {
  BlockchainNetwork,
  Event,
  LoyaltyDiscountVoucher,
  Ticket,
  TokenizedTicketAsset,
  UserLoyaltyProfile,
} from '../types';
import {
  generateRandomHex,
  generateUniqueId,
  isValidEmail,
  safeJsonParse,
  sanitizeText,
} from './security';

const ASSET_STORAGE_KEY = 'nexora_tokenized_ticket_assets_v1';
const LOYALTY_PROFILE_STORAGE_KEY = 'nexora_user_loyalty_profiles_v1';
const LOYALTY_VOUCHER_STORAGE_KEY = 'nexora_loyalty_discount_vouchers_v1';
const DEFAULT_MINT_BONUS_NXR = 150;
const BASE_TOKENIZATION_POINTS = 100;
const MIN_REDEEMABLE_POINTS = 50;
const DEFAULT_MAX_RESALE_MULTIPLIER_PCT = 110;
const DEFAULT_ROYALTY_BPS = 500; // 5.00%

const POINT_TO_CURRENCY_MINOR_RATE: Record<string, number> = {
  ZAR: 50,   // R 0.50 per point (100 pts = R 50.00)
  KES: 350,  // KSh 3.50 per point (100 pts = KSh 350.00)
  NGN: 4000, // ₦40.00 per point (100 pts = ₦4,000.00)
  GHS: 40,   // GH₵ 0.40 per point (100 pts = GH₵ 40.00)
  RWF: 35,   // FRw 35 per point (zero-decimal; 100 pts = FRw 3,500)
  USD: 5,    // $0.05 per point (100 pts = $5.00)
};

export interface MintTicketAssetOptions {
  network?: BlockchainNetwork;
  maxResaleMultiplierPct?: number;
  royaltyBps?: number;
  lockedUntil?: string;
}

export interface MintTicketAssetResult {
  success: boolean;
  asset?: TokenizedTicketAsset;
  loyaltyBonusTokens: number;
  loyaltyPointsAwarded: number;
  loyaltyMultiplier: number;
  alreadyMinted?: boolean;
  error?: string;
}

export interface ResaleVerificationResult {
  allowed: boolean;
  maxAllowedMinor?: number;
  royaltyMinor?: number;
  reason?: string;
}

export interface EventTokenizationDistributionRow {
  eventId: string;
  eventTitle: string;
  tokenizedCount: number;
  standardCount: number;
  totalIssued: number;
  mintRatePct: number;
  mintedLoyaltyPoints: number;
}

export interface EventTokenizationDistribution {
  totalIssuedTickets: number;
  tokenizedCount: number;
  standardCount: number;
  tokenizationRatePct: number;
  totalLoyaltyPointsAssigned: number;
  perEvent: EventTokenizationDistributionRow[];
}

async function computeSha256Hex(input: string): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}${generateRandomHex(28)}`;
}

/**
 * Manages event-based digital ticket token minting, associating ticket IDs
 * with unique verifiable digital assets for anti-scalping resale protection
 * and loyaltyPoints multiplier tracking across user wallet profiles.
 */
export class TokenizationService {
  private assets: TokenizedTicketAsset[] = [];
  private userProfiles: Record<string, UserLoyaltyProfile> = {};
  private discountVouchers: LoyaltyDiscountVoucher[] = [];

  constructor() {
    this.assets = this.loadAssets();
    this.userProfiles = this.loadUserProfiles();
    this.discountVouchers = this.loadDiscountVouchers();
  }

  private loadAssets(): TokenizedTicketAsset[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(ASSET_STORAGE_KEY);
      if (!raw) return [];
      const parsed = safeJsonParse<TokenizedTicketAsset[]>(raw, []);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persistAssets(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(this.assets));
    } catch (err) {
      console.error('Failed to persist tokenized ticket assets:', err);
    }
  }

  private loadUserProfiles(): Record<string, UserLoyaltyProfile> {
    try {
      if (typeof localStorage === 'undefined') return {};
      const raw = localStorage.getItem(LOYALTY_PROFILE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = safeJsonParse<Record<string, UserLoyaltyProfile>>(raw, {});
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private persistUserProfiles(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LOYALTY_PROFILE_STORAGE_KEY, JSON.stringify(this.userProfiles));
    } catch (err) {
      console.error('Failed to persist user loyalty profiles:', err);
    }
  }

  private loadDiscountVouchers(): LoyaltyDiscountVoucher[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(LOYALTY_VOUCHER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = safeJsonParse<LoyaltyDiscountVoucher[]>(raw, []);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persistDiscountVouchers(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LOYALTY_VOUCHER_STORAGE_KEY, JSON.stringify(this.discountVouchers));
    } catch (err) {
      console.error('Failed to persist loyalty discount vouchers:', err);
    }
  }

  public getPointRateMinor(currency = 'ZAR'): number {
    const cleanCurrency = (currency || 'ZAR').toUpperCase();
    return POINT_TO_CURRENCY_MINOR_RATE[cleanCurrency] ?? POINT_TO_CURRENCY_MINOR_RATE.ZAR;
  }

  public convertPointsToCurrencyMinor(points: number, currency = 'ZAR'): number {
    const safePoints = Math.max(0, Math.floor(Number(points) || 0));
    return safePoints * this.getPointRateMinor(currency);
  }

  public calculateLoyaltyMultiplier(
    tokenizedCount: number,
    verifiedAttendanceCount = 0
  ): number {
    let multiplier = 1.0;
    if (tokenizedCount >= 4) {
      multiplier = 2.0;
    } else if (tokenizedCount >= 2) {
      multiplier = 1.5;
    } else if (tokenizedCount >= 1) {
      multiplier = 1.25;
    }
    if (verifiedAttendanceCount > 0 && tokenizedCount > 0) {
      multiplier = Math.min(2.25, multiplier + 0.25);
    }
    return Number(multiplier.toFixed(2));
  }

  public computeAssetLoyaltyPoints(priceMinor: number, multiplier: number): number {
    const faceValueBonus = Math.min(400, Math.floor(Math.max(0, priceMinor) / 1000));
    const basePoints = BASE_TOKENIZATION_POINTS + faceValueBonus;
    return Math.round(basePoints * multiplier);
  }

  private getTierLabel(loyaltyPoints: number, tokenizedCount: number): UserLoyaltyProfile['tierLabel'] {
    if (loyaltyPoints >= 1500 || tokenizedCount >= 4) return 'Luminary';
    if (loyaltyPoints >= 600 || tokenizedCount >= 2) return 'Patron';
    if (loyaltyPoints > 0 || tokenizedCount >= 1) return 'Collector';
    return 'Standard';
  }

  private recomputeUserLoyaltyProfile(email: string): UserLoyaltyProfile {
    const cleanEmail = sanitizeText(email, 254).toLowerCase();
    const now = new Date().toISOString();
    if (!cleanEmail) {
      return {
        email: '',
        loyaltyPoints: 0,
        pointsMultiplier: 1.0,
        tokenizedTicketCount: 0,
        verifiedAttendanceCount: 0,
        tierLabel: 'Standard',
        updatedAt: now,
      };
    }

    const activeAssets = this.assets.filter(
      (a) => a.ownerEmail.toLowerCase() === cleanEmail && a.status !== 'revoked'
    );
    const tokenizedTicketCount = activeAssets.length;
    const verifiedAttendanceCount = activeAssets.filter(
      (a) => a.loyaltyTracking.attendanceVerified
    ).length;
    const pointsMultiplier = this.calculateLoyaltyMultiplier(
      tokenizedTicketCount,
      verifiedAttendanceCount
    );
    const earnedPoints = activeAssets.reduce((sum, asset) => {
      const storedPoints = Number(asset.loyaltyTracking.loyaltyPoints);
      if (Number.isFinite(storedPoints) && storedPoints > 0) {
        return sum + storedPoints;
      }
      return sum + this.computeAssetLoyaltyPoints(asset.originalPriceMinor, asset.loyaltyTracking.pointsMultiplier || pointsMultiplier);
    }, 0);

    const spentPoints = this.discountVouchers
      .filter((v) => v.email.toLowerCase() === cleanEmail)
      .reduce((sum, v) => sum + Math.max(0, Math.floor(v.pointsRedeemed || 0)), 0);

    const loyaltyPoints = Math.max(0, earnedPoints - spentPoints);

    const profile: UserLoyaltyProfile = {
      email: cleanEmail,
      loyaltyPoints,
      pointsMultiplier,
      tokenizedTicketCount,
      verifiedAttendanceCount,
      tierLabel: this.getTierLabel(earnedPoints, tokenizedTicketCount),
      updatedAt: now,
    };

    this.userProfiles[cleanEmail] = profile;
    this.persistUserProfiles();
    return profile;
  }

  public getUserLoyaltyProfile(email?: string): UserLoyaltyProfile {
    const cleanEmail = sanitizeText(email || '', 254).toLowerCase();
    if (!cleanEmail) {
      return {
        email: '',
        loyaltyPoints: 0,
        pointsMultiplier: 1.0,
        tokenizedTicketCount: 0,
        verifiedAttendanceCount: 0,
        tierLabel: 'Standard',
        updatedAt: new Date().toISOString(),
      };
    }
    return this.recomputeUserLoyaltyProfile(cleanEmail);
  }

  public getLoyaltyPoints(email?: string): number {
    return this.getUserLoyaltyProfile(email).loyaltyPoints;
  }

  public getLoyaltyMultiplier(email?: string): number {
    return this.getUserLoyaltyProfile(email).pointsMultiplier;
  }

  public async deriveEventContractAddress(eventId: string): Promise<string> {
    const cleanId = sanitizeText(eventId, 120) || 'default-event';
    const digest = await computeSha256Hex(`nexora:event-pass-contract:v1:${cleanId}`);
    return `0x${digest.slice(0, 40)}`;
  }

  public getAssetByTicketId(ticketId: string): TokenizedTicketAsset | null {
    const asset = this.assets.find((a) => a.ticketId === ticketId);
    return asset
      ? {
          ...asset,
          resaleProtection: { ...asset.resaleProtection },
          loyaltyTracking: { ...asset.loyaltyTracking },
        }
      : null;
  }

  public getAssetByTokenId(tokenId: string): TokenizedTicketAsset | null {
    const asset = this.assets.find((a) => a.tokenId === tokenId);
    return asset
      ? {
          ...asset,
          resaleProtection: { ...asset.resaleProtection },
          loyaltyTracking: { ...asset.loyaltyTracking },
        }
      : null;
  }

  public isTicketTokenized(ticketId: string): boolean {
    const asset = this.assets.find((a) => a.ticketId === ticketId);
    return Boolean(asset && asset.status !== 'revoked');
  }

  public getTokenizationStatus(ticketId: string): 'tokenized' | 'not_tokenized' | 'revoked' {
    const asset = this.assets.find((a) => a.ticketId === ticketId);
    if (!asset) return 'not_tokenized';
    return asset.status === 'revoked' ? 'revoked' : 'tokenized';
  }

  public getAssetsForEvent(eventId: string): TokenizedTicketAsset[] {
    return this.assets.filter((a) => a.eventId === eventId);
  }

  public getAssetsForOwner(email: string): TokenizedTicketAsset[] {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return [];
    return this.assets.filter((a) => a.ownerEmail.toLowerCase() === cleanEmail);
  }

  public getAllAssets(): TokenizedTicketAsset[] {
    return [...this.assets];
  }

  public getEventTokenizationDistribution(
    events: Event[],
    tickets: Ticket[],
    selectedEventId?: string
  ): EventTokenizationDistribution {
    const activeEvents = events.filter((ev) => ev.status === 'published');
    const scopedEvents =
      selectedEventId && selectedEventId !== 'all'
        ? activeEvents.filter((ev) => ev.id === selectedEventId)
        : activeEvents;

    let totalIssuedTickets = 0;
    let tokenizedCount = 0;
    let totalLoyaltyPointsAssigned = 0;

    const perEvent: EventTokenizationDistributionRow[] = scopedEvents.map((evt) => {
      const eligibleTickets = tickets.filter(
        (t) => t.eventId === evt.id && t.status !== 'refunded' && t.status !== 'cancelled'
      );
      const evtAssets = eligibleTickets
        .map((t) => this.assets.find((a) => a.ticketId === t.id && a.status !== 'revoked'))
        .filter((a): a is TokenizedTicketAsset => Boolean(a));

      const evtTokenized = evtAssets.length;
      const evtTotal = eligibleTickets.length;
      const evtStandard = Math.max(0, evtTotal - evtTokenized);
      const evtMintRatePct = evtTotal > 0 ? Math.round((evtTokenized / evtTotal) * 100) : 0;
      const evtPoints = evtAssets.reduce(
        (sum, a) => sum + (Number(a.loyaltyTracking.loyaltyPoints) || 0),
        0
      );

      totalIssuedTickets += evtTotal;
      tokenizedCount += evtTokenized;
      totalLoyaltyPointsAssigned += evtPoints;

      return {
        eventId: evt.id,
        eventTitle: evt.title,
        tokenizedCount: evtTokenized,
        standardCount: evtStandard,
        totalIssued: evtTotal,
        mintRatePct: evtMintRatePct,
        mintedLoyaltyPoints: evtPoints,
      };
    });

    const standardCount = Math.max(0, totalIssuedTickets - tokenizedCount);
    const tokenizationRatePct =
      totalIssuedTickets > 0 ? Math.round((tokenizedCount / totalIssuedTickets) * 100) : 0;

    return {
      totalIssuedTickets,
      tokenizedCount,
      standardCount,
      tokenizationRatePct,
      totalLoyaltyPointsAssigned,
      perEvent,
    };
  }

  public async mintTicketAsset(
    ticket: Ticket,
    options: MintTicketAssetOptions = {}
  ): Promise<MintTicketAssetResult> {
    if (!ticket?.id || !ticket?.eventId || !ticket?.ticketCode) {
      return {
        success: false,
        loyaltyBonusTokens: 0,
        loyaltyPointsAwarded: 0,
        loyaltyMultiplier: 1.0,
        error: 'Incomplete ticket record cannot be tokenized.',
      };
    }

    if (ticket.status === 'refunded' || ticket.status === 'cancelled') {
      return {
        success: false,
        loyaltyBonusTokens: 0,
        loyaltyPointsAwarded: 0,
        loyaltyMultiplier: 1.0,
        error: `Cannot mint a digital asset for a ${ticket.status} ticket.`,
      };
    }

    const cleanEmail = sanitizeText(ticket.attendeeEmail, 254).toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      return {
        success: false,
        loyaltyBonusTokens: 0,
        loyaltyPointsAwarded: 0,
        loyaltyMultiplier: 1.0,
        error: 'A valid attendee email address is required for asset ownership binding.',
      };
    }

    const existingIndex = this.assets.findIndex((a) => a.ticketId === ticket.id);
    if (existingIndex !== -1 && this.assets[existingIndex].status !== 'revoked') {
      const existing = this.assets[existingIndex];
      const profile = this.recomputeUserLoyaltyProfile(cleanEmail);
      return {
        success: true,
        asset: existing,
        loyaltyBonusTokens: 0,
        loyaltyPointsAwarded: 0,
        loyaltyMultiplier: profile.pointsMultiplier,
        alreadyMinted: true,
      };
    }

    const network: BlockchainNetwork = options.network || 'polygon-pos';
    const maxResaleMultiplierPct = Math.max(
      100,
      Math.min(200, Math.round(options.maxResaleMultiplierPct ?? DEFAULT_MAX_RESALE_MULTIPLIER_PCT))
    );
    const royaltyBps = Math.max(0, Math.min(1500, Math.round(options.royaltyBps ?? DEFAULT_ROYALTY_BPS)));
    const originalPriceMinor = Math.max(0, Math.floor(ticket.priceMinor || 0));
    const maxResalePriceMinor = Math.round((originalPriceMinor * maxResaleMultiplierPct) / 100);

    const now = new Date().toISOString();
    const contractAddress = await this.deriveEventContractAddress(ticket.eventId);
    const tokenEntropy = generateRandomHex(6).toUpperCase();
    const tokenId = `NXT-${ticket.eventId.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}-${tokenEntropy}`;
    const canonicalPayload = JSON.stringify({
      ticketId: ticket.id,
      ticketCode: ticket.ticketCode,
      eventId: ticket.eventId,
      tierId: ticket.tierId,
      ownerEmail: cleanEmail,
      contractAddress,
      tokenId,
      mintedAt: now,
    });
    const metadataHash = `0x${await computeSha256Hex(canonicalPayload)}`;
    const txHash = `0x${generateRandomHex(32)}`;

    const currentOwnerAssets = this.assets.filter(
      (a) => a.ownerEmail.toLowerCase() === cleanEmail && a.status !== 'revoked'
    );
    const nextTokenizedCount = currentOwnerAssets.length + 1;
    const attendanceVerified = ticket.status === 'checked_in';
    const verifiedCount =
      currentOwnerAssets.filter((a) => a.loyaltyTracking.attendanceVerified).length +
      (attendanceVerified ? 1 : 0);
    const activeMultiplier = this.calculateLoyaltyMultiplier(nextTokenizedCount, verifiedCount);
    const loyaltyPointsAwarded = this.computeAssetLoyaltyPoints(originalPriceMinor, activeMultiplier);

    const previouslyClaimedBonus =
      existingIndex !== -1 && this.assets[existingIndex].loyaltyTracking.loyaltyBonusClaimed;
    const loyaltyBonusTokens = previouslyClaimedBonus ? 0 : DEFAULT_MINT_BONUS_NXR;

    const asset: TokenizedTicketAsset = {
      assetId: generateUniqueId('nxa'),
      tokenId,
      ticketId: ticket.id,
      ticketCode: ticket.ticketCode,
      eventId: ticket.eventId,
      eventTitle: sanitizeText(ticket.eventTitle, 160),
      tierName: sanitizeText(ticket.tierName, 120),
      ownerEmail: cleanEmail,
      ownerName: sanitizeText(ticket.attendeeName, 120) || 'Attendee',
      network,
      contractAddress,
      metadataHash,
      txHash,
      originalPriceMinor,
      currency: ticket.currency || 'ZAR',
      resaleProtection: {
        enabled: true,
        maxResaleMultiplierPct,
        maxResalePriceMinor,
        royaltyBps,
        transferCount: 0,
        lockedUntil: options.lockedUntil,
      },
      loyaltyTracking: {
        mintBonusTokens: previouslyClaimedBonus
          ? this.assets[existingIndex].loyaltyTracking.mintBonusTokens
          : DEFAULT_MINT_BONUS_NXR,
        loyaltyBonusClaimed: true,
        loyaltyPoints: loyaltyPointsAwarded,
        attendanceVerified,
        pointsMultiplier: activeMultiplier,
      },
      status: 'minted',
      mintedAt: now,
      updatedAt: now,
    };

    if (existingIndex !== -1) {
      this.assets[existingIndex] = asset;
    } else {
      this.assets.unshift(asset);
    }
    this.persistAssets();
    const updatedProfile = this.recomputeUserLoyaltyProfile(cleanEmail);

    return {
      success: true,
      asset,
      loyaltyBonusTokens,
      loyaltyPointsAwarded,
      loyaltyMultiplier: updatedProfile.pointsMultiplier,
      alreadyMinted: false,
    };
  }

  public async mintEventBatch(
    tickets: Ticket[],
    options: MintTicketAssetOptions = {}
  ): Promise<{ mintedCount: number; totalLoyaltyBonus: number; totalLoyaltyPoints: number; assets: TokenizedTicketAsset[] }> {
    let mintedCount = 0;
    let totalLoyaltyBonus = 0;
    let totalLoyaltyPoints = 0;
    const assets: TokenizedTicketAsset[] = [];

    for (const ticket of tickets) {
      const res = await this.mintTicketAsset(ticket, options);
      if (res.success && res.asset) {
        assets.push(res.asset);
        if (!res.alreadyMinted) {
          mintedCount += 1;
          totalLoyaltyBonus += res.loyaltyBonusTokens;
          totalLoyaltyPoints += res.loyaltyPointsAwarded;
        }
      }
    }

    return { mintedCount, totalLoyaltyBonus, totalLoyaltyPoints, assets };
  }

  public verifyResalePrice(ticketId: string, proposedPriceMinor: number): ResaleVerificationResult {
    const asset = this.assets.find((a) => a.ticketId === ticketId);
    if (!asset || asset.status === 'revoked') {
      return { allowed: true };
    }
    const cleanProposed = Math.max(0, Math.floor(proposedPriceMinor));
    if (asset.resaleProtection.lockedUntil) {
      const lockExpiry = new Date(asset.resaleProtection.lockedUntil).getTime();
      if (Number.isFinite(lockExpiry) && Date.now() < lockExpiry) {
        return {
          allowed: false,
          maxAllowedMinor: asset.resaleProtection.maxResalePriceMinor,
          reason: `Resale transfers are locked until ${new Date(asset.resaleProtection.lockedUntil).toLocaleDateString()}.`,
        };
      }
    }

    if (asset.resaleProtection.enabled && cleanProposed > asset.resaleProtection.maxResalePriceMinor) {
      return {
        allowed: false,
        maxAllowedMinor: asset.resaleProtection.maxResalePriceMinor,
        reason: `Exceeds anti-scalping resale cap (${asset.resaleProtection.maxResaleMultiplierPct}% of face value).`,
      };
    }

    const royaltyMinor = Math.round((cleanProposed * asset.resaleProtection.royaltyBps) / 10000);
    return {
      allowed: true,
      maxAllowedMinor: asset.resaleProtection.maxResalePriceMinor,
      royaltyMinor,
    };
  }

  public async recordAssetTransfer(
    ticketId: string,
    newOwnerEmail: string,
    newOwnerName: string,
    resalePriceMinor?: number
  ): Promise<{ success: boolean; asset?: TokenizedTicketAsset; error?: string }> {
    const idx = this.assets.findIndex((a) => a.ticketId === ticketId);
    if (idx === -1) {
      return { success: false, error: 'Ticket does not have an associated digital asset.' };
    }

    const asset = this.assets[idx];
    if (asset.status === 'revoked') {
      return { success: false, error: 'Revoked digital assets cannot be transferred.' };
    }

    const cleanEmail = sanitizeText(newOwnerEmail, 254).toLowerCase();
    const cleanName = sanitizeText(newOwnerName, 120);
    if (!isValidEmail(cleanEmail) || !cleanName) {
      return { success: false, error: 'Valid recipient name and email are required.' };
    }

    if (typeof resalePriceMinor === 'number') {
      const check = this.verifyResalePrice(ticketId, resalePriceMinor);
      if (!check.allowed) {
        return { success: false, error: check.reason || 'Resale price rejected by protection policy.' };
      }
    }

    const previousOwnerEmail = asset.ownerEmail;
    const now = new Date().toISOString();
    const rotatedHash = `0x${await computeSha256Hex(
      `${asset.metadataHash}:${cleanEmail}:${asset.resaleProtection.transferCount + 1}:${now}`
    )}`;

    const updated: TokenizedTicketAsset = {
      ...asset,
      ownerEmail: cleanEmail,
      ownerName: cleanName,
      metadataHash: rotatedHash,
      txHash: `0x${generateRandomHex(32)}`,
      status: 'transferred',
      resaleProtection: {
        ...asset.resaleProtection,
        transferCount: asset.resaleProtection.transferCount + 1,
      },
      updatedAt: now,
    };

    this.assets[idx] = updated;
    this.persistAssets();
    this.recomputeUserLoyaltyProfile(previousOwnerEmail);
    this.recomputeUserLoyaltyProfile(cleanEmail);
    return { success: true, asset: updated };
  }

  public markAttendanceVerified(ticketId: string): TokenizedTicketAsset | null {
    const idx = this.assets.findIndex((a) => a.ticketId === ticketId);
    if (idx === -1 || this.assets[idx].status === 'revoked') return null;

    const current = this.assets[idx];
    const nextMultiplier = Math.min(2.25, Math.max(current.loyaltyTracking.pointsMultiplier, 1.5));
    const upgradedPoints = this.computeAssetLoyaltyPoints(current.originalPriceMinor, nextMultiplier);

    const updated: TokenizedTicketAsset = {
      ...current,
      loyaltyTracking: {
        ...current.loyaltyTracking,
        attendanceVerified: true,
        pointsMultiplier: nextMultiplier,
        loyaltyPoints: Math.max(current.loyaltyTracking.loyaltyPoints || 0, upgradedPoints),
      },
      updatedAt: new Date().toISOString(),
    };

    this.assets[idx] = updated;
    this.persistAssets();
    this.recomputeUserLoyaltyProfile(updated.ownerEmail);
    return updated;
  }

  public revokeTicketAsset(ticketId: string, reason = 'Ticket refunded or cancelled'): TokenizedTicketAsset | null {
    const idx = this.assets.findIndex((a) => a.ticketId === ticketId);
    if (idx === -1) return null;

    const updated: TokenizedTicketAsset = {
      ...this.assets[idx],
      status: 'revoked',
      revokedReason: sanitizeText(reason, 180),
      updatedAt: new Date().toISOString(),
    };

    this.assets[idx] = updated;
    this.persistAssets();
    this.recomputeUserLoyaltyProfile(updated.ownerEmail);
    return updated;
  }

  public getLoyaltyStatsForOwner(email: string): {
    mintedCount: number;
    verifiedAttendanceCount: number;
    totalMintBonusTokens: number;
    loyaltyPoints: number;
    highestMultiplier: number;
  } {
    const profile = this.getUserLoyaltyProfile(email);
    const owned = this.getAssetsForOwner(email).filter((a) => a.status !== 'revoked');
    return {
      mintedCount: owned.length,
      verifiedAttendanceCount: owned.filter((a) => a.loyaltyTracking.attendanceVerified).length,
      totalMintBonusTokens: owned.reduce(
        (sum, a) => sum + (a.loyaltyTracking.loyaltyBonusClaimed ? a.loyaltyTracking.mintBonusTokens : 0),
        0
      ),
      loyaltyPoints: profile.loyaltyPoints,
      highestMultiplier: profile.pointsMultiplier,
    };
  }

  public getDiscountVouchersForEmail(email?: string): LoyaltyDiscountVoucher[] {
    const cleanEmail = sanitizeText(email || '', 254).toLowerCase();
    if (!cleanEmail) return [];
    return this.discountVouchers
      .filter((v) => v.email.toLowerCase() === cleanEmail)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async redeemPointsForDiscountVoucher(params: {
    email: string;
    pointsToRedeem: number;
    currency: string;
    eventId?: string;
    eventTitle?: string;
  }): Promise<{
    success: boolean;
    voucher?: LoyaltyDiscountVoucher;
    remainingPoints?: number;
    error?: string;
  }> {
    const cleanEmail = sanitizeText(params.email, 254).toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      return { success: false, error: 'Sign in with a valid email address to redeem loyalty points.' };
    }

    const pointsToRedeem = Math.floor(Number(params.pointsToRedeem) || 0);
    if (pointsToRedeem < MIN_REDEEMABLE_POINTS) {
      return {
        success: false,
        error: `Minimum redemption is ${MIN_REDEEMABLE_POINTS} loyalty points.`,
      };
    }

    const profile = this.recomputeUserLoyaltyProfile(cleanEmail);
    if (profile.loyaltyPoints < pointsToRedeem) {
      return {
        success: false,
        error: `Insufficient loyalty points. Available: ${profile.loyaltyPoints.toLocaleString()} pts.`,
      };
    }

    const cleanCurrency = (params.currency || 'ZAR').toUpperCase();
    const discountMinor = this.convertPointsToCurrencyMinor(pointsToRedeem, cleanCurrency);
    const createdAt = new Date().toISOString();
    const code = `NXR-PTS-${generateRandomHex(3).toUpperCase()}`;
    const voucherSignature = `0x${await computeSha256Hex(
      JSON.stringify({
        code,
        email: cleanEmail,
        pointsToRedeem,
        discountMinor,
        currency: cleanCurrency,
        eventId: params.eventId || 'all',
        createdAt,
      })
    )}`;

    const voucher: LoyaltyDiscountVoucher = {
      id: generateUniqueId('ldv'),
      code,
      email: cleanEmail,
      pointsRedeemed: pointsToRedeem,
      discountMinor,
      currency: cleanCurrency,
      eventId: params.eventId || undefined,
      eventTitle: params.eventTitle ? sanitizeText(params.eventTitle, 140) : undefined,
      voucherSignature,
      used: false,
      createdAt,
    };

    this.discountVouchers.unshift(voucher);
    this.persistDiscountVouchers();
    const updatedProfile = this.recomputeUserLoyaltyProfile(cleanEmail);

    return {
      success: true,
      voucher,
      remainingPoints: updatedProfile.loyaltyPoints,
    };
  }

  public markDiscountVoucherUsed(code: string): void {
    const cleanCode = code.trim().toUpperCase();
    const idx = this.discountVouchers.findIndex((v) => v.code.toUpperCase() === cleanCode);
    if (idx !== -1 && !this.discountVouchers[idx].used) {
      this.discountVouchers[idx] = { ...this.discountVouchers[idx], used: true };
      this.persistDiscountVouchers();
    }
  }

  public clearAll(): void {
    this.assets = [];
    this.userProfiles = {};
    this.discountVouchers = [];
    this.persistAssets();
    this.persistUserProfiles();
    this.persistDiscountVouchers();
  }
}

export const tokenizationService = new TokenizationService();
export default TokenizationService;
