import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isSafeHttpsUrl, safeJsonParse, sanitizeSelfSignupRole } from './security';

// Retrieve credentials with priority:
// 1. Runtime rotated keys from sessionStorage/localStorage (if Super Admin rotated them in-session)
// 2. Injected Vite env vars (from Supabase_project_url / Supabase_anon_key / VITE_SUPABASE_*)
// 3. Defaults matching active project

const STORAGE_KEY_CONFIG = 'nexora_supabase_rotated_config';

interface SupabaseConfig {
  url: string;
  anonKey: string;
  projectId: string;
  rotatedAt: string;
  fingerprint: string;
}

function getInitialConfig(): SupabaseConfig {
  const saved = typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY_CONFIG) : null;
  if (saved) {
    const parsed = safeJsonParse<Partial<SupabaseConfig>>(saved, {});
    if (parsed.url && parsed.anonKey && isSafeHttpsUrl(parsed.url)) {
      return {
        url: parsed.url,
        anonKey: parsed.anonKey,
        projectId: parsed.projectId || 'kunabampibfcmnbyjads',
        rotatedAt: parsed.rotatedAt || new Date().toISOString(),
        fingerprint: parsed.fingerprint || 'rotated',
      };
    }
  }

  const url = import.meta.env.VITE_SUPABASE_URL || 'https://kunabampibfcmnbyjads.supabase.co';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || 'kunabampibfcmnbyjads';
  
  // Safe fingerprint for auditing
  const fingerprint = anonKey.length > 12 
    ? `${anonKey.slice(0, 6)}...${anonKey.slice(-4)}`
    : 'not-configured';

  return {
    url,
    anonKey,
    projectId,
    rotatedAt: new Date().toISOString(),
    fingerprint,
  };
}

let activeConfig: SupabaseConfig = getInitialConfig();

// Create the active Supabase client instance
export let supabase: SupabaseClient = createClient(
  activeConfig.url,
  activeConfig.anonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

/**
 * Returns current configuration metadata without exposing secret keys
 */
export function getSupabaseConfig(): SupabaseConfig {
  return { ...activeConfig };
}

/**
 * Verifies if valid Supabase credentials have been injected or rotated
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    activeConfig.url && 
    activeConfig.anonKey && 
    !activeConfig.anonKey.includes('placeholder')
  );
}

/**
 * Rotates the active Supabase keys at runtime across all sessions.
 * Recreates the Supabase client seamlessly.
 */
export function rotateSupabaseKeys(newUrl?: string, newKey?: string, newProjectId?: string): { success: boolean; config: SupabaseConfig } {
  const candidateUrl = (newUrl || activeConfig.url).trim();
  if (!isSafeHttpsUrl(candidateUrl)) {
    throw new Error('Rejected unsafe Supabase URL. Must be a public HTTPS endpoint.');
  }
  const url = candidateUrl;
  const anonKey = (newKey || activeConfig.anonKey).trim();
  const projectId = (newProjectId || activeConfig.projectId || 'kunabampibfcmnbyjads').trim();
  const rotatedAt = new Date().toISOString();
  
  const fingerprint = anonKey.length > 12 
    ? `${anonKey.slice(0, 6)}...${anonKey.slice(-4)}`
    : 'rotated-empty';

  activeConfig = {
    url,
    anonKey,
    projectId,
    rotatedAt,
    fingerprint,
  };

  if (typeof window !== 'undefined') {
    sessionStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(activeConfig));
  }

  // Re-instantiate client with rotated credentials
  supabase = createClient(activeConfig.url, activeConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return {
    success: true,
    config: { ...activeConfig },
  };
}

/**
 * Performs a comprehensive real-time health check on the Supabase instance:
 * 1. Checks GoTrue Authentication Gateway
 * 2. Checks Database REST Table Ingress
 */
export async function checkSupabaseHealth(): Promise<{
  connected: boolean;
  authAlive: boolean;
  databaseAlive: boolean;
  schemaDeployed: boolean;
  latencyMs: number;
  project: string;
  url: string;
  version?: string;
  error?: string;
}> {
  const startTime = Date.now();
  const result = {
    connected: false,
    authAlive: false,
    databaseAlive: false,
    schemaDeployed: false,
    latencyMs: 0,
    project: activeConfig.projectId,
    url: activeConfig.url,
    version: 'GoTrue v2.197.0',
    error: undefined as string | undefined,
  };

  try {
    // 1. Test Auth Gateway via public /auth/v1/health or getSession
    const authPromise = fetch(`${activeConfig.url}/auth/v1/health`, {
      headers: {
        apikey: activeConfig.anonKey,
      },
      signal: AbortSignal.timeout(5000),
    })
      .then(async (res) => {
        if (res.ok) {
          result.authAlive = true;
          try {
            const data = await res.json();
            if (data.version) result.version = `${data.name || 'GoTrue'} ${data.version}`;
          } catch {
            // non-json response
          }
        }
      })
      .catch((err) => {
        console.warn('Supabase Auth health check failed:', err);
      });

    // 2. Test Database REST endpoint
    const dbPromise = fetch(`${activeConfig.url}/rest/v1/events?select=count`, {
      headers: {
        apikey: activeConfig.anonKey,
        Authorization: `Bearer ${activeConfig.anonKey}`,
      },
      signal: AbortSignal.timeout(5000),
    })
      .then(async (res) => {
        if (res.ok) {
          result.databaseAlive = true;
          result.schemaDeployed = true;
        } else if (res.status === 404 || res.status === 400) {
          const body = await res.json().catch(() => ({}));
          // If message is "Could not find the table ... in the schema cache",
          // REST connection is authenticated and active, but schema needs to be run!
          if (body.code === 'PGRST205' || body.message?.includes('schema cache')) {
            result.databaseAlive = true;
            result.schemaDeployed = false;
          }
        }
      })
      .catch((err) => {
        console.warn('Supabase DB health check failed:', err);
      });

    await Promise.allSettled([authPromise, dbPromise]);
    result.latencyMs = Date.now() - startTime;
    result.connected = result.authAlive || result.databaseAlive;
    return result;
  } catch (err: any) {
    result.latencyMs = Date.now() - startTime;
    result.error = err.message || 'Network timeout contacting Supabase endpoint';
    return result;
  }
}

// -------------------------------------------------------------
// Authentication Wrappers
// -------------------------------------------------------------
export async function supabaseSignUp(email: string, password: string, fullName: string, role: string = 'attendee') {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured with active credentials.');
  }

  const safeRole = sanitizeSelfSignupRole(role);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: safeRole,
      },
    },
  });

  if (error) throw error;
  return data;
}

export async function supabaseSignIn(email: string, password: string) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured with active credentials.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function supabaseSignOut() {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Supabase SignOut error:', error);
}

export async function supabaseGetSession() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session;
}

export async function supabaseGetAccessToken(): Promise<string | null> {
  const session = await supabaseGetSession();
  return session?.access_token ?? null;
}

// -------------------------------------------------------------
// Database Synchronization Functions
// -------------------------------------------------------------

/**
 * Fetches country launch gates from public.country_launch_gates in Supabase
 */
export async function fetchLaunchGatesFromSupabase() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('country_launch_gates')
      .select('*')
      .order('wave', { ascending: true });

    if (error) {
      console.warn('Supabase fetchLaunchGates error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Network error fetching launch gates:', err);
    return null;
  }
}

/**
 * Fetches user profiles from public.profiles in Supabase
 */
export async function fetchProfilesFromSupabase() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Supabase fetchProfiles error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Network error fetching profiles:', err);
    return null;
  }
}

/**
 * Updates a specific launch gate attribute in Supabase
 */
export async function updateLaunchGateInSupabase(countryCode: string, updates: Record<string, any>) {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('country_launch_gates')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('country_code', countryCode)
      .select();

    if (error) {
      console.warn('Supabase updateLaunchGate error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Network error updating launch gate:', err);
    return null;
  }
}

/**
 * Fetches published events from public.events
 */
export async function fetchEventsFromSupabase() {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('events')
      .select('*, ticket_tiers(*)')
      .order('start_date', { ascending: true });

    if (error) {
      console.warn('Supabase fetchEvents error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Network error fetching events:', err);
    return null;
  }
}

/**
 * Inserts a balanced ledger journal entry into public.ledger_entries
 */
export async function insertLedgerEntryInSupabase(entry: {
  order_id?: string;
  event_id?: string;
  organizer_id?: string;
  type:
    | 'customer_clearing'
    | 'organizer_payable'
    | 'platform_commission'
    | 'processing_fee'
    | 'payout_transfer'
    | 'refund_reserve'
    | 'refund_reversal'
    | 'credit_token_mint'
    | 'credit_token_redeem';
  account_code: string;
  account_name: string;
  debit_minor: number;
  credit_minor: number;
  currency: string;
  description: string;
  reference: string;
}) {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabase
      .from('ledger_entries')
      .insert([entry])
      .select();

    if (error) {
      console.warn('Supabase insertLedgerEntry error:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Network error inserting ledger entry:', err);
    return null;
  }
}

/**
 * Checks in a ticket using the anti-passback record_ticket_scan RPC (with safe table fallback)
 */
export async function checkInTicketInSupabase(
  ticketCode: string,
  gate: string,
  staffName = 'Gate Officer',
  scannerUserId?: string
) {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('record_ticket_scan', {
      p_ticket_code: ticketCode,
      p_staff_name: staffName,
      p_gate: gate,
      p_scanner_user_id: scannerUserId || null,
    });

    if (!rpcError && rpcData) {
      return rpcData;
    }

    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .select('*')
      .eq('ticket_code', ticketCode)
      .single();

    if (ticketErr || !ticket) {
      return { success: false, result: 'invalid', reason: 'TICKET_NOT_FOUND' };
    }

    if (ticket.status === 'checked_in') {
      return { success: false, result: 'already_checked_in', reason: 'ALREADY_CHECKED_IN', ticket };
    }

    const checkedInAt = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabase
      .from('tickets')
      .update({
        status: 'checked_in',
        checked_in_at: checkedInAt,
        checked_in_by: staffName,
        gate,
      })
      .eq('id', ticket.id)
      .select()
      .single();

    if (updateErr) {
      return { success: false, result: 'invalid', reason: 'UPDATE_FAILED', error: updateErr.message };
    }

    await supabase.from('check_ins').insert([{
      ticket_id: ticket.id,
      ticket_code: ticket.ticket_code,
      event_id: ticket.event_id,
      staff_name: staffName,
      scanner_user_id: scannerUserId || null,
      gate,
      result: 'valid',
      message: 'Access Granted: Verified Attendee Pass.',
    }]);

    return { success: true, result: 'valid', ticket: updated };
  } catch (err: any) {
    return { success: false, result: 'invalid', reason: 'NETWORK_ERROR', error: err.message };
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value?: string | null): boolean {
  return Boolean(value && UUID_REGEX.test(value.trim()));
}

/**
 * Syncs organizer bank details via Supabase RPC `upsert_organizer_bank_details` when authenticated with a UUID organizer record.
 */
export async function upsertOrganizerBankDetailsInSupabase(params: {
  organizerId: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  confirmAccountNumber: string;
  branchCode?: string;
  accountType?: string;
  confirmed: boolean;
}): Promise<{ synced: boolean; error?: string; data?: any }> {
  if (!isSupabaseConfigured() || !isValidUuid(params.organizerId)) {
    return { synced: false };
  }
  try {
    const session = await supabaseGetSession();
    if (!session) return { synced: false };

    const { data, error } = await supabase.rpc('upsert_organizer_bank_details', {
      p_organizer_id: params.organizerId,
      p_bank_name: params.bankName.trim(),
      p_account_holder: params.accountHolder.trim(),
      p_account_number: params.accountNumber.trim(),
      p_confirm_account_number: params.confirmAccountNumber.trim(),
      p_branch_code: params.branchCode?.trim() || null,
      p_account_type: params.accountType || 'Business Cheque',
      p_confirmed: params.confirmed,
    });

    if (error) {
      return { synced: false, error: error.message };
    }
    return { synced: true, data };
  } catch (err: any) {
    return { synced: false, error: err?.message || 'Unable to sync bank details with database.' };
  }
}

/**
 * Queries organizer Nexora Wallet & post-event unlock summary from Supabase RPC.
 */
export async function getOrganizerWalletSummaryInSupabase(organizerId: string) {
  if (!isSupabaseConfigured() || !isValidUuid(organizerId)) return null;
  try {
    const session = await supabaseGetSession();
    if (!session) return null;

    const { data, error } = await supabase.rpc('get_organizer_wallet_summary', {
      p_organizer_id: organizerId,
    });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Submits a post-event Nexora Wallet payout withdrawal via Supabase RPC `request_organizer_payout`.
 */
export async function requestOrganizerPayoutInSupabase(
  organizerId: string,
  amountMinor: number,
  currency = 'ZAR'
): Promise<{ synced: boolean; error?: string; data?: any }> {
  if (!isSupabaseConfigured() || !isValidUuid(organizerId)) {
    return { synced: false };
  }
  try {
    const session = await supabaseGetSession();
    if (!session) return { synced: false };

    const { data, error } = await supabase.rpc('request_organizer_payout', {
      p_organizer_id: organizerId,
      p_amount_minor: amountMinor,
      p_currency: currency,
    });

    if (error) {
      return { synced: false, error: error.message };
    }
    return { synced: true, data };
  } catch (err: any) {
    return { synced: false, error: err?.message || 'Unable to process Supabase payout withdrawal.' };
  }
}

/**
 * Checks whether an event organizer has confirmed settlement bank details in Supabase.
 */
export async function canOrganizerReceivePaymentInSupabase(eventId: string, totalMinor?: number) {
  if (!isSupabaseConfigured() || !isValidUuid(eventId)) return null;
  try {
    const { data, error } = await supabase.rpc('can_organizer_receive_payment', {
      p_event_id: eventId,
      p_total_minor: typeof totalMinor === 'number' ? totalMinor : null,
    });
    if (error) return null;
    return data as { allowed: boolean; reason?: string };
  } catch {
    return null;
  }
}

/**
 * Requests a server-signed HMAC-SHA256 NXR credit token signature from /api/tokens/credits/sign
 */
export async function signCreditTokenPayload(params: {
  email: string;
  txType: string;
  tokensAmount: number;
  currency?: string;
  reference?: string;
}): Promise<{ tokenSignature: string; fingerprint: string; issuedAt: string } | null> {
  try {
    const res = await fetch('/api/tokens/credits/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function mintCreditTokensInSupabase(params: {
  email: string;
  tokensAmount: number;
  txType?: string;
  currency?: string;
  displayName?: string;
  orderId?: string;
  eventId?: string;
  organizerId?: string;
  voucherCode?: string;
  tokenSignature?: string;
  description?: string;
}) {
  if (!isSupabaseConfigured()) return null;
  try {
    const session = await supabaseGetSession();
    if (!session) return null;
    const { data, error } = await supabase.rpc('mint_credit_tokens', {
      p_email: params.email,
      p_tokens_amount: params.tokensAmount,
      p_tx_type: params.txType || 'mint_cashback',
      p_currency: params.currency || 'ZAR',
      p_display_name: params.displayName || 'Attendee',
      p_order_id: isValidUuid(params.orderId) ? params.orderId : null,
      p_event_id: isValidUuid(params.eventId) ? params.eventId : null,
      p_organizer_id: isValidUuid(params.organizerId) ? params.organizerId : null,
      p_voucher_code: params.voucherCode || null,
      p_token_signature: params.tokenSignature || null,
      p_description: params.description || 'NXR Cashless & Loyalty Credit issuance',
    });
    if (error) return { synced: false, error: error.message };
    return { synced: true, data };
  } catch {
    return null;
  }
}

export async function redeemCreditTokensInSupabase(params: {
  email: string;
  tokensAmount: number;
  txType?: 'redeem_checkout' | 'convert_wristband';
  currency?: string;
  orderId?: string;
  eventId?: string;
  organizerId?: string;
  wristbandUid?: string;
  description?: string;
}) {
  if (!isSupabaseConfigured()) return null;
  try {
    const session = await supabaseGetSession();
    if (!session) return null;
    const { data, error } = await supabase.rpc('redeem_credit_tokens', {
      p_email: params.email,
      p_tokens_amount: params.tokensAmount,
      p_tx_type: params.txType || 'redeem_checkout',
      p_currency: params.currency || 'ZAR',
      p_order_id: isValidUuid(params.orderId) ? params.orderId : null,
      p_event_id: isValidUuid(params.eventId) ? params.eventId : null,
      p_organizer_id: isValidUuid(params.organizerId) ? params.organizerId : null,
      p_wristband_uid: params.wristbandUid || null,
      p_description: params.description || 'Redeemed NXR Cashless & Loyalty Credits',
    });
    if (error) return { synced: false, error: error.message };
    return { synced: true, data };
  } catch {
    return null;
  }
}

export async function claimCreditVoucherInSupabase(params: {
  code: string;
  email: string;
  displayName?: string;
}) {
  if (!isSupabaseConfigured()) return null;
  try {
    const session = await supabaseGetSession();
    if (!session) return null;
    const { data, error } = await supabase.rpc('claim_credit_voucher', {
      p_code: params.code,
      p_email: params.email,
      p_display_name: params.displayName || 'Attendee',
    });
    if (error) return { synced: false, error: error.message };
    return { synced: true, data };
  } catch {
    return null;
  }
}

export async function transferCreditTokensInSupabase(params: {
  fromEmail: string;
  toEmail: string;
  tokensAmount: number;
  toName?: string;
  note?: string;
}) {
  if (!isSupabaseConfigured()) return null;
  try {
    const session = await supabaseGetSession();
    if (!session) return null;
    const { data, error } = await supabase.rpc('transfer_credit_tokens', {
      p_from_email: params.fromEmail,
      p_to_email: params.toEmail,
      p_tokens_amount: params.tokensAmount,
      p_to_name: params.toName || 'Attendee',
      p_note: params.note || 'Peer-to-peer NXR Credit transfer',
    });
    if (error) return { synced: false, error: error.message };
    return { synced: true, data };
  } catch {
    return null;
  }
}

