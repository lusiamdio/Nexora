-- ============================================================================
-- NEXORA PLATFORM — CASHLESS & LOYALTY CREDIT TOKENIZATION MIGRATION
-- Covers:
--   1. Tokenized Credit Wallets (NXR Credits: 1 NXR = 1 minor unit; 100 NXR = 1.00)
--   2. Immutable Credit Token Ledger with Cryptographic Signatures & Tier Tracking
--   3. Signed Redeemable Credit Vouchers & NFC Wristband Credit Bridge
--   4. Atomic SECURITY DEFINER RPCs + Double-Entry Accounting & Strict RLS
-- ============================================================================
-- Safe & idempotent to run directly in the Supabase SQL Editor.
-- ============================================================================

ALTER TYPE public.payment_provider ADD VALUE IF NOT EXISTS 'nexora_credits';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'credit_token_mint';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'credit_token_redeem';

-- ----------------------------------------------------------------------------
-- 1. SCHEMA ADDITIONS
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS credits_redeemed_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_redeemed_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_minted_tokens BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.credit_token_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Attendee',
  token_symbol TEXT NOT NULL DEFAULT 'NXR',
  currency TEXT NOT NULL DEFAULT 'ZAR',
  balance_tokens BIGINT NOT NULL DEFAULT 0 CHECK (balance_tokens >= 0),
  lifetime_minted_tokens BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_minted_tokens >= 0),
  lifetime_redeemed_tokens BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_redeemed_tokens >= 0),
  loyalty_tier TEXT NOT NULL DEFAULT 'Bronze'
    CHECK (loyalty_tier IN ('Bronze', 'Silver', 'Gold', 'Obsidian')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.credit_token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.credit_token_wallets(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  tx_type TEXT NOT NULL CHECK (tx_type IN (
    'mint_cashback',
    'mint_organizer_grant',
    'mint_voucher',
    'mint_pos_reward',
    'redeem_checkout',
    'convert_wristband',
    'wristband_refund',
    'transfer_out',
    'transfer_in'
  )),
  tokens_delta BIGINT NOT NULL,
  balance_after_tokens BIGINT NOT NULL CHECK (balance_after_tokens >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  organizer_id UUID REFERENCES public.organizer_profiles(id) ON DELETE SET NULL,
  wristband_uid TEXT,
  voucher_code TEXT,
  token_signature TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.credit_token_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  organizer_id UUID REFERENCES public.organizer_profiles(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  tokens_amount BIGINT NOT NULL CHECK (tokens_amount > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  max_redemptions INT NOT NULL DEFAULT 1 CHECK (max_redemptions >= 1),
  redemptions_count INT NOT NULL DEFAULT 0 CHECK (redemptions_count >= 0),
  expires_at TIMESTAMPTZ,
  token_signature TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.credit_voucher_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.credit_token_vouchers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (voucher_id, email)
);

CREATE INDEX IF NOT EXISTS idx_credit_wallets_email ON public.credit_token_wallets(lower(email));
CREATE INDEX IF NOT EXISTS idx_credit_wallets_user ON public.credit_token_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_wallet ON public.credit_token_ledger(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_email ON public.credit_token_ledger(lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_vouchers_code ON public.credit_token_vouchers(upper(code));

-- ----------------------------------------------------------------------------
-- 2. TIER COMPUTATION & WALLET HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_loyalty_tier(p_lifetime_minted BIGINT)
RETURNS TEXT
IMMUTABLE
LANGUAGE sql AS $$
  SELECT CASE
    WHEN COALESCE(p_lifetime_minted, 0) >= 150000 THEN 'Obsidian'
    WHEN COALESCE(p_lifetime_minted, 0) >= 50000 THEN 'Gold'
    WHEN COALESCE(p_lifetime_minted, 0) >= 10000 THEN 'Silver'
    ELSE 'Bronze'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_credit_token_wallet(
  p_email TEXT,
  p_display_name TEXT DEFAULT 'Attendee',
  p_currency TEXT DEFAULT 'ZAR'
)
RETURNS public.credit_token_wallets
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_clean_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_clean_name TEXT := COALESCE(NULLIF(trim(COALESCE(p_display_name, '')), ''), 'Attendee');
  v_clean_currency TEXT := COALESCE(NULLIF(upper(trim(COALESCE(p_currency, ''))), ''), 'ZAR');
  v_user_id UUID;
  v_wallet public.credit_token_wallets%ROWTYPE;
BEGIN
  IF v_clean_email = '' OR position('@' IN v_clean_email) = 0 THEN
    RAISE EXCEPTION 'A valid email address is required for a credit token wallet';
  END IF;

  SELECT id INTO v_user_id FROM public.profiles WHERE lower(email) = v_clean_email LIMIT 1;

  INSERT INTO public.credit_token_wallets (
    user_id, email, display_name, currency
  ) VALUES (
    v_user_id, v_clean_email, v_clean_name, v_clean_currency
  )
  ON CONFLICT (email) DO UPDATE
    SET user_id = COALESCE(public.credit_token_wallets.user_id, EXCLUDED.user_id),
        display_name = CASE
          WHEN length(trim(EXCLUDED.display_name)) > 1 THEN EXCLUDED.display_name
          ELSE public.credit_token_wallets.display_name
        END,
        updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_wallet;

  RETURN v_wallet;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. ATOMIC MINT, REDEEM, WRISTBAND BRIDGE, TRANSFER & VOUCHER RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mint_credit_tokens(
  p_email TEXT,
  p_tokens_amount BIGINT,
  p_tx_type TEXT DEFAULT 'mint_cashback',
  p_currency TEXT DEFAULT 'ZAR',
  p_display_name TEXT DEFAULT 'Attendee',
  p_order_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_organizer_id UUID DEFAULT NULL,
  p_voucher_code TEXT DEFAULT NULL,
  p_token_signature TEXT DEFAULT NULL,
  p_description TEXT DEFAULT 'NXR Cashless & Loyalty Credit issuance'
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet public.credit_token_wallets%ROWTYPE;
  v_new_balance BIGINT;
  v_new_lifetime BIGINT;
  v_new_tier TEXT;
  v_sig TEXT;
  v_entry public.credit_token_ledger%ROWTYPE;
BEGIN
  IF p_tokens_amount IS NULL OR p_tokens_amount <= 0 THEN
    RAISE EXCEPTION 'Token mint amount must be strictly positive';
  END IF;

  IF p_tx_type NOT IN ('mint_cashback', 'mint_organizer_grant', 'mint_voucher', 'mint_pos_reward', 'wristband_refund') THEN
    RAISE EXCEPTION 'Unsupported mint transaction type: %', p_tx_type;
  END IF;

  IF p_tokens_amount > 100000000 THEN
    RAISE EXCEPTION 'Token mint amount exceeds single-operation ceiling';
  END IF;

  IF p_tx_type = 'mint_organizer_grant' THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.is_admin()
       AND (p_organizer_id IS NULL OR NOT public.is_organizer_member(p_organizer_id)) THEN
      RAISE EXCEPTION 'Insufficient privileges to mint organizer loyalty credits';
    END IF;
  ELSIF p_tx_type = 'mint_voucher' THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.is_admin()
       AND COALESCE(current_setting('nexora.internal_voucher_claim', true), '') IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'Vouchers must be claimed via claim_credit_voucher';
    END IF;
  ELSE
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.is_admin()
       AND (p_organizer_id IS NULL OR NOT public.is_organizer_member(p_organizer_id))
       AND lower(COALESCE(auth.jwt() ->> 'email', '')) IS DISTINCT FROM lower(trim(COALESCE(p_email, ''))) THEN
      RAISE EXCEPTION 'Unauthorized credit issuance for another account';
    END IF;
  END IF;

  v_wallet := public.ensure_credit_token_wallet(p_email, p_display_name, p_currency);

  SELECT * INTO v_wallet
  FROM public.credit_token_wallets
  WHERE id = v_wallet.id
  FOR UPDATE;

  v_new_balance := v_wallet.balance_tokens + p_tokens_amount;
  v_new_lifetime := v_wallet.lifetime_minted_tokens + p_tokens_amount;
  v_new_tier := public.compute_loyalty_tier(v_new_lifetime);

  v_sig := COALESCE(
    NULLIF(trim(COALESCE(p_token_signature, '')), ''),
    'nxr_' || encode(gen_random_bytes(16), 'hex')
  );

  UPDATE public.credit_token_wallets
  SET balance_tokens = v_new_balance,
      lifetime_minted_tokens = v_new_lifetime,
      loyalty_tier = v_new_tier,
      updated_at = timezone('utc'::text, now())
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.credit_token_ledger (
    wallet_id, email, tx_type, tokens_delta, balance_after_tokens, currency,
    order_id, event_id, organizer_id, voucher_code, token_signature, description
  ) VALUES (
    v_wallet.id, v_wallet.email, p_tx_type, p_tokens_amount, v_new_balance, v_wallet.currency,
    p_order_id, p_event_id, p_organizer_id, p_voucher_code, v_sig,
    COALESCE(NULLIF(trim(COALESCE(p_description, '')), ''), 'Minted NXR Loyalty Credits')
  )
  RETURNING * INTO v_entry;

  -- Record double-entry liability journal pair when tied to an organizer/order
  IF p_organizer_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      order_id, event_id, organizer_id, type, account_code, account_name,
      debit_minor, credit_minor, currency, description, reference
    ) VALUES
    (
      p_order_id, p_event_id, p_organizer_id,
      'credit_token_mint'::public.ledger_entry_type, '5020', 'Promotional & Loyalty Credit Issuance',
      p_tokens_amount, 0, v_wallet.currency,
      'Loyalty credit mint expense (' || p_tokens_amount || ' NXR)', v_sig
    ),
    (
      p_order_id, p_event_id, p_organizer_id,
      'credit_token_mint'::public.ledger_entry_type, '2030', 'Attendee Cashless & Loyalty Credit Liability',
      0, p_tokens_amount, v_wallet.currency,
      'Attendee NXR credit balance minted (' || p_tokens_amount || ' NXR)', v_sig
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'wallet', to_jsonb(v_wallet),
    'entry', to_jsonb(v_entry)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_credit_tokens(
  p_email TEXT,
  p_tokens_amount BIGINT,
  p_tx_type TEXT DEFAULT 'redeem_checkout',
  p_currency TEXT DEFAULT 'ZAR',
  p_order_id UUID DEFAULT NULL,
  p_event_id UUID DEFAULT NULL,
  p_organizer_id UUID DEFAULT NULL,
  p_wristband_uid TEXT DEFAULT NULL,
  p_description TEXT DEFAULT 'Redeemed NXR Cashless & Loyalty Credits'
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_clean_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_wallet public.credit_token_wallets%ROWTYPE;
  v_new_balance BIGINT;
  v_sig TEXT := 'nxr_red_' || encode(gen_random_bytes(16), 'hex');
  v_entry public.credit_token_ledger%ROWTYPE;
BEGIN
  IF p_tokens_amount IS NULL OR p_tokens_amount <= 0 THEN
    RAISE EXCEPTION 'Redemption amount must be strictly positive';
  END IF;

  IF p_tx_type NOT IN ('redeem_checkout', 'convert_wristband') THEN
    RAISE EXCEPTION 'Unsupported redemption type: %', p_tx_type;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND lower(COALESCE(auth.jwt() ->> 'email', '')) IS DISTINCT FROM v_clean_email THEN
    RAISE EXCEPTION 'Unauthorized credit redemption for another account';
  END IF;

  SELECT * INTO v_wallet
  FROM public.credit_token_wallets
  WHERE lower(email) = v_clean_email
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No NXR credit wallet found for %', v_clean_email;
  END IF;

  IF v_wallet.balance_tokens < p_tokens_amount THEN
    RAISE EXCEPTION 'Insufficient NXR credit balance (available: %, requested: %)', v_wallet.balance_tokens, p_tokens_amount;
  END IF;

  v_new_balance := v_wallet.balance_tokens - p_tokens_amount;

  UPDATE public.credit_token_wallets
  SET balance_tokens = v_new_balance,
      lifetime_redeemed_tokens = lifetime_redeemed_tokens + p_tokens_amount,
      updated_at = timezone('utc'::text, now())
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.credit_token_ledger (
    wallet_id, email, tx_type, tokens_delta, balance_after_tokens, currency,
    order_id, event_id, organizer_id, wristband_uid, token_signature, description
  ) VALUES (
    v_wallet.id, v_wallet.email, p_tx_type, -p_tokens_amount, v_new_balance, COALESCE(p_currency, v_wallet.currency),
    p_order_id, p_event_id, p_organizer_id, p_wristband_uid, v_sig,
    COALESCE(NULLIF(trim(COALESCE(p_description, '')), ''), 'Redeemed NXR Cashless Credits')
  )
  RETURNING * INTO v_entry;

  IF p_organizer_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      order_id, event_id, organizer_id, type, account_code, account_name,
      debit_minor, credit_minor, currency, description, reference
    ) VALUES
    (
      p_order_id, p_event_id, p_organizer_id,
      'credit_token_redeem'::public.ledger_entry_type, '2030', 'Attendee Cashless & Loyalty Credit Liability',
      p_tokens_amount, 0, COALESCE(p_currency, v_wallet.currency),
      'Redeemed attendee NXR credits (' || p_tokens_amount || ' NXR)', v_sig
    ),
    (
      p_order_id, p_event_id, p_organizer_id,
      'credit_token_redeem'::public.ledger_entry_type, '1010', 'Gateway Clearing Receivable',
      0, p_tokens_amount, COALESCE(p_currency, v_wallet.currency),
      'NXR credit clearing offset (' || p_tokens_amount || ' NXR)', v_sig
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'wallet', to_jsonb(v_wallet),
    'entry', to_jsonb(v_entry)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_credits_to_wristband(
  p_email TEXT,
  p_wristband_uid TEXT,
  p_tokens_amount BIGINT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_wb public.cashless_wristbands%ROWTYPE;
  v_redeem JSONB;
  v_new_wb_balance BIGINT;
BEGIN
  IF p_tokens_amount IS NULL OR p_tokens_amount <= 0 THEN
    RAISE EXCEPTION 'Conversion amount must be greater than zero';
  END IF;

  SELECT * INTO v_wb
  FROM public.cashless_wristbands
  WHERE upper(uid) = upper(trim(COALESCE(p_wristband_uid, '')))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NFC Wristband UID not found';
  END IF;

  v_redeem := public.redeem_credit_tokens(
    p_email => p_email,
    p_tokens_amount => p_tokens_amount,
    p_tx_type => 'convert_wristband',
    p_currency => v_wb.currency,
    p_event_id => v_wb.event_id,
    p_wristband_uid => v_wb.uid,
    p_description => 'Loaded ' || p_tokens_amount || ' NXR Credits onto NFC Wristband ' || v_wb.uid
  );

  v_new_wb_balance := v_wb.balance_minor + p_tokens_amount;

  UPDATE public.cashless_wristbands
  SET balance_minor = v_new_wb_balance,
      last_tapped_at = timezone('utc'::text, now())
  WHERE id = v_wb.id
  RETURNING * INTO v_wb;

  INSERT INTO public.wristband_transactions (
    wristband_id, wristband_uid, type, amount_minor, balance_after_minor, currency, vendor_name, reference
  ) VALUES (
    v_wb.id, v_wb.uid, 'topup'::public.wristband_tx_type, p_tokens_amount, v_new_wb_balance,
    v_wb.currency, 'NXR Loyalty Credit Top-up', 'NXR-WB-' || encode(gen_random_bytes(6), 'hex')
  );

  RETURN jsonb_build_object(
    'success', true,
    'wristband', to_jsonb(v_wb),
    'wallet', v_redeem->'wallet'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_credit_voucher(
  p_code TEXT,
  p_email TEXT,
  p_display_name TEXT DEFAULT 'Attendee'
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_clean_code TEXT := upper(trim(COALESCE(p_code, '')));
  v_clean_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_voucher public.credit_token_vouchers%ROWTYPE;
  v_mint JSONB;
BEGIN
  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'Voucher code is required';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND lower(COALESCE(auth.jwt() ->> 'email', '')) IS DISTINCT FROM v_clean_email THEN
    RAISE EXCEPTION 'Voucher claim email must match the signed-in account';
  END IF;

  SELECT * INTO v_voucher
  FROM public.credit_token_vouchers
  WHERE upper(code) = v_clean_code
  FOR UPDATE;

  IF NOT FOUND OR v_voucher.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Credit voucher code not found or inactive';
  END IF;

  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at <= timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'This credit voucher has expired';
  END IF;

  IF v_voucher.redemptions_count >= v_voucher.max_redemptions THEN
    RAISE EXCEPTION 'This credit voucher has reached its maximum redemptions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.credit_voucher_claims
    WHERE voucher_id = v_voucher.id AND lower(email) = v_clean_email
  ) THEN
    RAISE EXCEPTION 'You have already claimed this credit voucher';
  END IF;

  INSERT INTO public.credit_voucher_claims (voucher_id, email)
  VALUES (v_voucher.id, v_clean_email);

  UPDATE public.credit_token_vouchers
  SET redemptions_count = redemptions_count + 1
  WHERE id = v_voucher.id;

  PERFORM set_config('nexora.internal_voucher_claim', '1', true);

  v_mint := public.mint_credit_tokens(
    p_email => v_clean_email,
    p_tokens_amount => v_voucher.tokens_amount,
    p_tx_type => 'mint_voucher',
    p_currency => v_voucher.currency,
    p_display_name => p_display_name,
    p_event_id => v_voucher.event_id,
    p_organizer_id => v_voucher.organizer_id,
    p_voucher_code => v_voucher.code,
    p_token_signature => v_voucher.token_signature,
    p_description => 'Claimed signed NXR Credit Voucher ' || v_voucher.code
  );

  PERFORM set_config('nexora.internal_voucher_claim', '0', true);

  RETURN v_mint;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_credit_tokens(
  p_from_email TEXT,
  p_to_email TEXT,
  p_tokens_amount BIGINT,
  p_to_name TEXT DEFAULT 'Attendee',
  p_note TEXT DEFAULT 'Peer-to-peer NXR Credit transfer'
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_from TEXT := lower(trim(COALESCE(p_from_email, '')));
  v_to TEXT := lower(trim(COALESCE(p_to_email, '')));
  v_sender public.credit_token_wallets%ROWTYPE;
  v_recipient public.credit_token_wallets%ROWTYPE;
  v_sig TEXT := 'nxr_p2p_' || encode(gen_random_bytes(16), 'hex');
  v_sender_bal BIGINT;
  v_recipient_bal BIGINT;
BEGIN
  IF v_from = '' OR v_to = '' OR position('@' IN v_to) = 0 THEN
    RAISE EXCEPTION 'Valid sender and recipient email addresses are required';
  END IF;
  IF v_from = v_to THEN
    RAISE EXCEPTION 'Cannot transfer NXR credits to your own wallet';
  END IF;
  IF p_tokens_amount IS NULL OR p_tokens_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be strictly positive';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND lower(COALESCE(auth.jwt() ->> 'email', '')) IS DISTINCT FROM v_from THEN
    RAISE EXCEPTION 'Unauthorized transfer from another user wallet';
  END IF;

  SELECT * INTO v_sender
  FROM public.credit_token_wallets
  WHERE lower(email) = v_from
  FOR UPDATE;

  IF NOT FOUND OR v_sender.balance_tokens < p_tokens_amount THEN
    RAISE EXCEPTION 'Insufficient NXR credit balance for transfer';
  END IF;

  v_recipient := public.ensure_credit_token_wallet(v_to, p_to_name, v_sender.currency);
  SELECT * INTO v_recipient FROM public.credit_token_wallets WHERE id = v_recipient.id FOR UPDATE;

  v_sender_bal := v_sender.balance_tokens - p_tokens_amount;
  v_recipient_bal := v_recipient.balance_tokens + p_tokens_amount;

  UPDATE public.credit_token_wallets
  SET balance_tokens = v_sender_bal,
      lifetime_redeemed_tokens = lifetime_redeemed_tokens + p_tokens_amount,
      updated_at = timezone('utc'::text, now())
  WHERE id = v_sender.id
  RETURNING * INTO v_sender;

  UPDATE public.credit_token_wallets
  SET balance_tokens = v_recipient_bal,
      lifetime_minted_tokens = lifetime_minted_tokens + p_tokens_amount,
      loyalty_tier = public.compute_loyalty_tier(lifetime_minted_tokens + p_tokens_amount),
      updated_at = timezone('utc'::text, now())
  WHERE id = v_recipient.id
  RETURNING * INTO v_recipient;

  INSERT INTO public.credit_token_ledger (
    wallet_id, email, tx_type, tokens_delta, balance_after_tokens, currency, token_signature, description
  ) VALUES
  (
    v_sender.id, v_sender.email, 'transfer_out', -p_tokens_amount, v_sender_bal, v_sender.currency,
    v_sig, 'Transferred ' || p_tokens_amount || ' NXR to ' || v_recipient.email
  ),
  (
    v_recipient.id, v_recipient.email, 'transfer_in', p_tokens_amount, v_recipient_bal, v_recipient.currency,
    v_sig, COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), 'Received ' || p_tokens_amount || ' NXR from ' || v_sender.email)
  );

  RETURN jsonb_build_object(
    'success', true,
    'senderWallet', to_jsonb(v_sender),
    'recipientWallet', to_jsonb(v_recipient),
    'signature', v_sig
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_credit_summary(p_email TEXT)
RETURNS JSONB
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_clean_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_wallet public.credit_token_wallets%ROWTYPE;
  v_history JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND lower(COALESCE(auth.jwt() ->> 'email', '')) IS DISTINCT FROM v_clean_email THEN
    RAISE EXCEPTION 'Unauthorized wallet summary access';
  END IF;

  SELECT * INTO v_wallet
  FROM public.credit_token_wallets
  WHERE lower(email) = v_clean_email;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'email', v_clean_email,
      'tokenSymbol', 'NXR',
      'balanceTokens', 0,
      'lifetimeMintedTokens', 0,
      'lifetimeRedeemedTokens', 0,
      'loyaltyTier', 'Bronze',
      'transactions', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(l.*) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT * FROM public.credit_token_ledger
    WHERE wallet_id = v_wallet.id
    ORDER BY created_at DESC
    LIMIT 50
  ) l;

  RETURN jsonb_build_object(
    'wallet', to_jsonb(v_wallet),
    'transactions', v_history
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY (RLS) & FUNCTION GRANTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.credit_token_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_token_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_token_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_voucher_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_wallets_select_own ON public.credit_token_wallets;
CREATE POLICY credit_wallets_select_own ON public.credit_token_wallets
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS credit_ledger_select_own ON public.credit_token_ledger;
CREATE POLICY credit_ledger_select_own ON public.credit_token_ledger
  FOR SELECT TO authenticated
  USING (
    lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    OR (organizer_id IS NOT NULL AND public.is_organizer_member(organizer_id))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS credit_vouchers_select_org ON public.credit_token_vouchers;
CREATE POLICY credit_vouchers_select_org ON public.credit_token_vouchers
  FOR SELECT TO authenticated
  USING (
    (organizer_id IS NOT NULL AND public.is_organizer_member(organizer_id))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS credit_vouchers_insert_org ON public.credit_token_vouchers;
CREATE POLICY credit_vouchers_insert_org ON public.credit_token_vouchers
  FOR INSERT TO authenticated
  WITH CHECK (
    (organizer_id IS NOT NULL AND public.is_organizer_member(organizer_id))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS credit_voucher_claims_select_own ON public.credit_voucher_claims;
CREATE POLICY credit_voucher_claims_select_own ON public.credit_voucher_claims
  FOR SELECT TO authenticated
  USING (
    lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    OR public.is_admin()
  );

REVOKE ALL ON FUNCTION public.mint_credit_tokens(TEXT, BIGINT, TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mint_credit_tokens(TEXT, BIGINT, TEXT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.redeem_credit_tokens(TEXT, BIGINT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_credit_tokens(TEXT, BIGINT, TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.convert_credits_to_wristband(TEXT, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_credits_to_wristband(TEXT, TEXT, BIGINT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_credit_voucher(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_credit_voucher(TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.transfer_credit_tokens(TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_credit_tokens(TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_user_credit_summary(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_credit_summary(TEXT) TO authenticated, service_role;
