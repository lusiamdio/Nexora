-- ============================================================================
-- NEXORA PLATFORM — INCREMENTAL SUPABASE POSTGRESQL MIGRATION
-- Covers:
--   1. Payment Rails Consolidation (M-Pesa inside Mobile Money, Instant EFT, Card; no Sandbox)
--   2. Mandatory Confirmed Organizer Bank Account Details + Anytime Updates
--   3. Nexora Wallet Escrow, Post-Event Withdrawal Lock, & Atomic GAAP Settlement RPCs
--   4. Row-Level Security, Privilege Guards, and Zero-Drift Double-Entry Reconciliation
-- ============================================================================
-- Safe & idempotent to run directly in the Supabase SQL Editor on an existing deployment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMA ADDITIONS & CONSTRAINTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS bank_details_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_details_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bank_details_updated_at TIMESTAMPTZ;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS payout_settings JSONB;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_rail TEXT,
  ADD COLUMN IF NOT EXISTS mobile_money_channel TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_payment_rail_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_rail_check
  CHECK (payment_rail IS NULL OR payment_rail IN ('card', 'ozow', 'momo', 'free'));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_momo_channel_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_momo_channel_check
  CHECK (mobile_money_channel IS NULL OR mobile_money_channel IN ('M-Pesa', 'MTN MoMo', 'Airtel Money'));

ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS destination_branch_code TEXT,
  ADD COLUMN IF NOT EXISTS destination_account_type TEXT,
  ADD COLUMN IF NOT EXISTS wallet_source TEXT NOT NULL DEFAULT 'nexora_wallet';

-- ----------------------------------------------------------------------------
-- 2. BANK CONFIRMATION & EVENT COMPLETION HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_confirmed_bank_details(p_organizer_id UUID)
RETURNS BOOLEAN
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizer_profiles o
    WHERE o.id = p_organizer_id
      AND length(trim(COALESCE(o.bank_name, ''))) >= 2
      AND length(trim(COALESCE(o.bank_account_holder, ''))) >= 2
      AND length(trim(COALESCE(o.bank_account_number, ''))) >= 5
      AND o.bank_details_confirmed = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_event_completed(
  p_status public.event_status,
  p_end_date TIMESTAMPTZ
)
RETURNS BOOLEAN
STABLE
LANGUAGE sql AS $$
  SELECT (
    p_status = 'ended'::public.event_status
    OR (
      p_status IN ('published'::public.event_status, 'sold_out'::public.event_status)
      AND p_end_date <= timezone('utc'::text, now())
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_organizer_member(p_organizer_id UUID, p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizer_profiles o
    WHERE o.id = p_organizer_id AND o.owner_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.organization_id = p_organizer_id
      AND tm.user_id = p_user_id
      AND tm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_organizer_receive_payment(
  p_event_id UUID,
  p_total_minor BIGINT DEFAULT NULL
)
RETURNS JSONB
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_organizer_id UUID;
  v_has_paid_tier BOOLEAN;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Event record not found.');
  END IF;

  SELECT organizer_id INTO v_organizer_id
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Event record not found.');
  END IF;

  IF p_total_minor IS NOT NULL AND p_total_minor <= 0 THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  IF p_total_minor IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ticket_tiers
      WHERE event_id = p_event_id AND price_minor > 0
    ) INTO v_has_paid_tier;

    IF NOT v_has_paid_tier THEN
      RETURN jsonb_build_object('allowed', true);
    END IF;
  END IF;

  IF NOT public.has_confirmed_bank_details(v_organizer_id) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Ticket payments are paused until the organizer adds and confirms their settlement bank account details.'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. ORGANIZER BANKING TRIGGERS & ANYTIME UPDATE RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_organizer_privileged_columns()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_bank_changed BOOLEAN;
BEGIN
  -- Block non-admins from elevating verification, commission rates, or ownership
  IF auth.uid() IS NOT NULL
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin() THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.verified IS DISTINCT FROM OLD.verified
       OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
       OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
       OR NEW.total_revenue_minor IS DISTINCT FROM OLD.total_revenue_minor THEN
      RAISE EXCEPTION 'Insufficient privileges to modify restricted organizer compliance or billing columns';
    END IF;
  END IF;

  -- Track anytime banking updates and require explicit re-confirmation whenever bank fields change
  v_bank_changed := (
    NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
    OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder
    OR NEW.bank_branch_code IS DISTINCT FROM OLD.bank_branch_code
    OR NEW.bank_account_type IS DISTINCT FROM OLD.bank_account_type
  );

  IF v_bank_changed THEN
    NEW.bank_details_updated_at := timezone('utc'::text, now());

    -- If core account details changed without explicit confirmation in the same statement, require re-confirmation
    IF (NEW.bank_name IS DISTINCT FROM OLD.bank_name
        OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
        OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder)
       AND NEW.bank_details_confirmed IS NOT TRUE THEN
      NEW.bank_details_confirmed := false;
      NEW.bank_details_confirmed_at := NULL;
    END IF;
  END IF;

  IF NEW.bank_details_confirmed = true THEN
    IF length(trim(COALESCE(NEW.bank_name, ''))) < 2
       OR length(trim(COALESCE(NEW.bank_account_holder, ''))) < 2
       OR length(trim(COALESCE(NEW.bank_account_number, ''))) < 5 THEN
      RAISE EXCEPTION 'Bank name, account holder, and a valid account number are required to confirm settlement banking details';
    END IF;

    IF OLD.bank_details_confirmed IS DISTINCT FROM true OR v_bank_changed THEN
      NEW.bank_details_confirmed_at := timezone('utc'::text, now());
    END IF;
  ELSE
    NEW.bank_details_confirmed_at := NULL;
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_organizer_privileged_columns ON public.organizer_profiles;
CREATE TRIGGER trg_protect_organizer_privileged_columns
  BEFORE UPDATE ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_organizer_privileged_columns();

CREATE OR REPLACE FUNCTION public.upsert_organizer_bank_details(
  p_organizer_id UUID,
  p_bank_name TEXT,
  p_account_holder TEXT,
  p_account_number TEXT,
  p_confirm_account_number TEXT,
  p_branch_code TEXT DEFAULT NULL,
  p_account_type TEXT DEFAULT 'Business Cheque',
  p_confirmed BOOLEAN DEFAULT true
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_org public.organizer_profiles%ROWTYPE;
  v_bank TEXT := trim(COALESCE(p_bank_name, ''));
  v_holder TEXT := trim(COALESCE(p_account_holder, ''));
  v_acc TEXT := trim(COALESCE(p_account_number, ''));
  v_confirm_acc TEXT := trim(COALESCE(p_confirm_account_number, ''));
  v_branch TEXT := trim(COALESCE(p_branch_code, ''));
  v_type TEXT := COALESCE(NULLIF(trim(COALESCE(p_account_type, '')), ''), 'Business Cheque');
  v_actor_email TEXT;
  v_actor_role public.user_role;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.organizer_profiles o
       WHERE o.id = p_organizer_id AND o.owner_id = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members tm
       WHERE tm.organization_id = p_organizer_id
         AND tm.user_id = auth.uid()
         AND tm.status = 'active'
         AND tm.role IN ('Organization Owner', 'Administrator', 'Finance Manager')
     ) THEN
    RAISE EXCEPTION 'Unauthorized: only organization owners, admins, or finance managers can update settlement bank details';
  END IF;

  IF p_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'You must confirm your settlement bank account details before saving';
  END IF;

  IF length(v_bank) < 2 OR length(v_holder) < 2 OR length(v_acc) < 5 THEN
    RAISE EXCEPTION 'Provide a valid bank name, account holder name, and account number (minimum 5 characters)';
  END IF;

  IF v_acc <> v_confirm_acc THEN
    RAISE EXCEPTION 'Account number and confirmation account number do not match';
  END IF;

  UPDATE public.organizer_profiles
  SET bank_name = v_bank,
      bank_account_holder = v_holder,
      bank_account_number = v_acc,
      bank_branch_code = NULLIF(v_branch, ''),
      bank_account_type = v_type,
      bank_details_confirmed = true,
      bank_details_confirmed_at = v_now,
      bank_details_updated_at = v_now,
      updated_at = v_now
  WHERE id = p_organizer_id
  RETURNING * INTO v_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer profile not found';
  END IF;

  -- Sync updated bank snapshot across all events owned by this organizer
  UPDATE public.events
  SET payout_settings = jsonb_build_object(
        'bankName', v_bank,
        'accountNumber', v_acc,
        'accountHolder', v_holder,
        'branchCode', NULLIF(v_branch, ''),
        'accountType', v_type,
        'confirmed', true,
        'confirmedAt', v_now,
        'currency', currency
      ),
      updated_at = v_now
  WHERE organizer_id = p_organizer_id;

  SELECT email, role INTO v_actor_email, v_actor_role
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.audit_logs (
    actor_id, actor_email, actor_role, action, entity_type, entity_id, new_state
  ) VALUES (
    auth.uid(),
    COALESCE(v_actor_email, v_org.email),
    COALESCE(v_actor_role, 'organizer'::public.user_role),
    'SETTLEMENT_BANK_DETAILS_CONFIRMED',
    'organizer_profile',
    p_organizer_id::text,
    jsonb_build_object(
      'bank_name', v_bank,
      'account_holder', v_holder,
      'masked_account', '••••' || right(v_acc, 4),
      'account_type', v_type,
      'confirmed', true,
      'confirmed_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'organizer_id', v_org.id,
    'bank_name', v_org.bank_name,
    'account_holder', v_org.bank_account_holder,
    'masked_account', '••••' || right(v_acc, 4),
    'confirmed', v_org.bank_details_confirmed,
    'confirmed_at', v_org.bank_details_confirmed_at
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. EVENT PUBLISH & ORDER PAYMENT ENFORCEMENT TRIGGERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_event_publish_bank_gate()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_has_paid_tier BOOLEAN;
BEGIN
  IF NEW.status = 'published'::public.event_status
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published'::public.event_status) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ticket_tiers
      WHERE event_id = NEW.id AND price_minor > 0
    ) INTO v_has_paid_tier;

    IF v_has_paid_tier AND NOT public.has_confirmed_bank_details(NEW.organizer_id) THEN
      RAISE EXCEPTION 'Organizers must add and confirm their settlement bank account details before publishing paid events';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_publish_bank_gate ON public.events;
CREATE TRIGGER trg_enforce_event_publish_bank_gate
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_publish_bank_gate();

CREATE OR REPLACE FUNCTION public.enforce_order_payment_gate()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_organizer_id UUID;
BEGIN
  -- Reject deprecated Sandbox provider on active rails or completed orders
  IF NEW.payment_provider = 'sandbox'::public.payment_provider
     AND (NEW.payment_status IN ('processing'::public.order_status, 'succeeded'::public.order_status)
          OR NEW.payment_rail IS NOT NULL) THEN
    RAISE EXCEPTION 'Sandbox simulation rail is disabled. Select Card, Instant EFT, or Mobile Money (M-Pesa, MTN MoMo, Airtel Money)';
  END IF;

  -- Enforce consolidated Pan-African rail-to-provider routing
  IF NEW.payment_rail = 'momo' THEN
    IF NEW.mobile_money_channel NOT IN ('M-Pesa', 'MTN MoMo', 'Airtel Money') THEN
      RAISE EXCEPTION 'Mobile Money orders require channel M-Pesa, MTN MoMo, or Airtel Money';
    END IF;
    IF NEW.mobile_money_channel = 'M-Pesa' THEN
      NEW.payment_provider := 'mpesa'::public.payment_provider;
    ELSE
      NEW.payment_provider := 'flutterwave'::public.payment_provider;
    END IF;
  ELSIF NEW.payment_rail = 'ozow' THEN
    NEW.payment_provider := 'ozow'::public.payment_provider;
  ELSIF NEW.payment_rail = 'card' THEN
    IF NEW.payment_provider NOT IN (
      'paystack'::public.payment_provider,
      'flutterwave'::public.payment_provider,
      'stripe_card'::public.payment_provider
    ) THEN
      RAISE EXCEPTION 'Card payments must route through paystack, flutterwave, or stripe_card';
    END IF;
  END IF;

  -- Require confirmed organizer settlement bank account for paid orders
  IF NEW.total_minor > 0 THEN
    SELECT organizer_id INTO v_organizer_id
    FROM public.events
    WHERE id = NEW.event_id;

    IF v_organizer_id IS NULL OR NOT public.has_confirmed_bank_details(v_organizer_id) THEN
      RAISE EXCEPTION 'Ticket payments are paused until the organizer adds and confirms their settlement bank account details';
    END IF;
  END IF;

  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_order_payment_gate ON public.orders;
CREATE TRIGGER trg_enforce_order_payment_gate
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_payment_gate();

-- ----------------------------------------------------------------------------
-- 5. NEXORA WALLET SUMMARY VIEW & POST-EVENT LOCK ENGINE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_organizer_wallet_summary
WITH (security_invoker = true) AS
WITH event_ledger AS (
  SELECT
    le.organizer_id,
    le.event_id,
    le.currency,
    SUM(CASE WHEN le.type = 'organizer_payable'::public.ledger_entry_type THEN le.credit_minor ELSE 0 END)::BIGINT AS credited_minor,
    SUM(CASE WHEN le.type = 'refund_reversal'::public.ledger_entry_type THEN le.debit_minor ELSE 0 END)::BIGINT AS reversed_minor
  FROM public.ledger_entries le
  WHERE le.organizer_id IS NOT NULL
  GROUP BY le.organizer_id, le.event_id, le.currency
),
event_holdings AS (
  SELECT
    el.organizer_id,
    GREATEST(0::BIGINT, el.credited_minor - el.reversed_minor) AS net_wallet_minor,
    public.is_event_completed(e.status, e.end_date) AS is_completed
  FROM event_ledger el
  LEFT JOIN public.events e ON e.id = el.event_id
),
org_totals AS (
  SELECT
    eh.organizer_id,
    SUM(eh.net_wallet_minor)::BIGINT AS net_proceeds_minor,
    SUM(CASE WHEN NOT eh.is_completed THEN eh.net_wallet_minor ELSE 0 END)::BIGINT AS escrow_locked_minor,
    SUM(CASE WHEN eh.is_completed THEN eh.net_wallet_minor ELSE 0 END)::BIGINT AS unlocked_gross_minor
  FROM event_holdings eh
  GROUP BY eh.organizer_id
),
payout_totals AS (
  SELECT
    pr.organizer_id,
    SUM(CASE WHEN pr.status IN ('pending', 'approved', 'processing', 'completed') THEN pr.amount_minor ELSE 0 END)::BIGINT AS payouts_completed_minor
  FROM public.payout_requests pr
  GROUP BY pr.organizer_id
)
SELECT
  op.id AS organizer_id,
  op.name AS organizer_name,
  op.bank_details_confirmed,
  op.bank_details_confirmed_at,
  COALESCE(ot.net_proceeds_minor, 0)::BIGINT AS net_proceeds_minor,
  COALESCE(ot.escrow_locked_minor, 0)::BIGINT AS escrow_locked_minor,
  COALESCE(ot.unlocked_gross_minor, 0)::BIGINT AS unlocked_gross_minor,
  COALESCE(pt.payouts_completed_minor, 0)::BIGINT AS payouts_completed_minor,
  GREATEST(0::BIGINT, COALESCE(ot.net_proceeds_minor, 0) - COALESCE(pt.payouts_completed_minor, 0))::BIGINT AS wallet_balance_minor,
  LEAST(
    GREATEST(0::BIGINT, COALESCE(ot.net_proceeds_minor, 0) - COALESCE(pt.payouts_completed_minor, 0)),
    GREATEST(0::BIGINT, COALESCE(ot.unlocked_gross_minor, 0) - COALESCE(pt.payouts_completed_minor, 0))
  )::BIGINT AS available_payout_minor
FROM public.organizer_profiles op
LEFT JOIN org_totals ot ON ot.organizer_id = op.id
LEFT JOIN payout_totals pt ON pt.organizer_id = op.id;

CREATE OR REPLACE FUNCTION public.get_organizer_wallet_summary(p_organizer_id UUID)
RETURNS JSONB
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_org public.organizer_profiles%ROWTYPE;
  v_summary RECORD;
  v_holdings JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND NOT public.is_organizer_member(p_organizer_id) THEN
    RAISE EXCEPTION 'Unauthorized: cannot inspect another organizer wallet';
  END IF;

  SELECT * INTO v_org
  FROM public.organizer_profiles
  WHERE id = p_organizer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer profile not found';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN le.type = 'organizer_payable'::public.ledger_entry_type THEN le.credit_minor ELSE 0 END), 0)::BIGINT AS gross_minor,
    COALESCE(SUM(CASE WHEN le.type = 'platform_commission'::public.ledger_entry_type THEN le.credit_minor ELSE 0 END), 0)::BIGINT AS platform_fee_minor,
    COALESCE(SUM(CASE WHEN le.type = 'refund_reversal'::public.ledger_entry_type THEN le.debit_minor ELSE 0 END), 0)::BIGINT AS refunds_reversed_minor
  INTO v_summary
  FROM public.ledger_entries le
  WHERE le.organizer_id = p_organizer_id;

  WITH per_event AS (
    SELECT
      le.event_id,
      e.title AS event_title,
      e.end_date,
      COALESCE(e.currency, MAX(le.currency), 'ZAR') AS currency,
      COALESCE(e.status::text, 'published') AS status,
      public.is_event_completed(e.status, e.end_date) AS is_completed,
      GREATEST(
        0::BIGINT,
        SUM(CASE WHEN le.type = 'organizer_payable'::public.ledger_entry_type THEN le.credit_minor ELSE 0 END)
        - SUM(CASE WHEN le.type = 'refund_reversal'::public.ledger_entry_type THEN le.debit_minor ELSE 0 END)
      )::BIGINT AS net_wallet_minor
    FROM public.ledger_entries le
    LEFT JOIN public.events e ON e.id = le.event_id
    WHERE le.organizer_id = p_organizer_id
    GROUP BY le.event_id, e.title, e.end_date, e.currency, e.status
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'eventId', pe.event_id,
        'eventTitle', COALESCE(pe.event_title, 'Event Settlement'),
        'endDate', pe.end_date,
        'currency', pe.currency,
        'status', pe.status,
        'netWalletMinor', pe.net_wallet_minor,
        'isCompleted', pe.is_completed,
        'unlockLabel',
          CASE
            WHEN pe.status = 'cancelled' THEN 'Cancelled — Held for Refunds'
            WHEN pe.is_completed THEN 'Event Completed · Unlocked'
            ELSE 'Locked until ' || COALESCE(to_char(pe.end_date, 'DD Mon YYYY'), 'TBD')
          END
      )
      ORDER BY pe.end_date ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_holdings
  FROM per_event pe
  WHERE pe.net_wallet_minor > 0;

  RETURN (
    SELECT jsonb_build_object(
      'organizerId', w.organizer_id,
      'grossMinor', v_summary.gross_minor,
      'platformFeeMinor', v_summary.platform_fee_minor,
      'refundsReversedMinor', v_summary.refunds_reversed_minor,
      'payoutsCompletedMinor', w.payouts_completed_minor,
      'walletBalanceMinor', w.wallet_balance_minor,
      'escrowLockedMinor', w.escrow_locked_minor,
      'availablePayoutMinor', w.available_payout_minor,
      'bankDetailsConfirmed', public.has_confirmed_bank_details(p_organizer_id),
      'bankDetailsConfirmedAt', v_org.bank_details_confirmed_at,
      'maskedBankAccount',
        CASE
          WHEN length(trim(COALESCE(v_org.bank_account_number, ''))) >= 4
          THEN trim(v_org.bank_name) || ' ••••' || right(trim(v_org.bank_account_number), 4)
          ELSE NULL
        END,
      'eventHoldings', v_holdings
    )
    FROM public.v_organizer_wallet_summary w
    WHERE w.organizer_id = p_organizer_id
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. ATOMIC ORDER PAYMENT SETTLEMENT -> ORGANIZER NEXORA WALLET + GAAP LEDGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_order_payment(
  p_order_id UUID,
  p_payment_provider public.payment_provider,
  p_payment_method TEXT,
  p_payment_rail TEXT DEFAULT NULL,
  p_mobile_money_channel TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_item RECORD;
  v_tier public.ticket_tiers%ROWTYPE;
  v_i INTEGER;
  v_ticket_code TEXT;
  v_token TEXT;
  v_hash TEXT;
  v_qr_payload TEXT;
  v_tickets JSONB := '[]'::jsonb;
  v_organizer_proceeds BIGINT;
  v_gateway_fee BIGINT;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
  v_provider public.payment_provider := p_payment_provider;
  v_rail TEXT := NULLIF(trim(COALESCE(p_payment_rail, '')), '');
  v_momo_channel TEXT := NULLIF(trim(COALESCE(p_mobile_money_channel, '')), '');
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found.');
  END IF;

  -- Authorize payment finalization strictly to service_role, platform admin, or owning buyer
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND NOT (v_order.customer_id IS NOT NULL AND v_order.customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized payment settlement attempt for order %', p_order_id;
  END IF;

  -- Idempotent return if order already succeeded
  IF v_order.payment_status = 'succeeded'::public.order_status THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_tickets
    FROM public.tickets t
    WHERE t.order_id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order', to_jsonb(v_order),
      'tickets', v_tickets
    );
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = v_order.event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Associated event not found.');
  END IF;

  -- Enforce confirmed organizer bank account for paid orders
  IF v_order.total_minor > 0 AND NOT public.has_confirmed_bank_details(v_event.organizer_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ticket payments are paused until the organizer adds and confirms their settlement bank account details.'
    );
  END IF;

  -- Validate rail normalization (no Sandbox; M-Pesa inside Mobile Money)
  IF v_provider = 'sandbox'::public.payment_provider THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sandbox payment method is not permitted for ticket settlement.'
    );
  END IF;

  IF v_rail = 'momo' THEN
    IF v_momo_channel NOT IN ('M-Pesa', 'MTN MoMo', 'Airtel Money') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Mobile Money checkout requires channel M-Pesa, MTN MoMo, or Airtel Money.'
      );
    END IF;
    v_provider := CASE WHEN v_momo_channel = 'M-Pesa' THEN 'mpesa'::public.payment_provider ELSE 'flutterwave'::public.payment_provider END;
  ELSIF v_rail = 'ozow' THEN
    v_provider := 'ozow'::public.payment_provider;
  END IF;

  -- Lock & deduct inventory across all order items
  FOR v_item IN
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.id
  LOOP
    SELECT * INTO v_tier
    FROM public.ticket_tiers
    WHERE id = v_item.tier_id
    FOR UPDATE;

    IF NOT FOUND OR (v_tier.capacity - v_tier.sold_count) < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient remaining inventory for tier %', v_item.tier_name;
    END IF;

    UPDATE public.ticket_tiers
    SET sold_count = sold_count + v_item.quantity,
        reserved_count = GREATEST(0, reserved_count - v_item.quantity),
        status = CASE WHEN (sold_count + v_item.quantity) >= capacity THEN 'sold_out' ELSE status END,
        updated_at = v_now
    WHERE id = v_tier.id;
  END LOOP;

  -- Mark order succeeded
  UPDATE public.orders
  SET payment_status = 'succeeded'::public.order_status,
      payment_provider = v_provider,
      payment_method = COALESCE(NULLIF(trim(COALESCE(p_payment_method, '')), ''), v_provider::text),
      payment_rail = COALESCE(v_rail, payment_rail),
      mobile_money_channel = COALESCE(v_momo_channel, mobile_money_channel),
      completed_at = v_now,
      updated_at = v_now
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Redeem promo code if present
  IF v_order.promo_code_applied IS NOT NULL AND length(trim(v_order.promo_code_applied)) > 0 THEN
    UPDATE public.promo_codes
    SET times_used = LEAST(max_uses, times_used + 1)
    WHERE code = upper(trim(v_order.promo_code_applied))
      AND active = true;
  END IF;

  -- Mint cryptographic tickets
  FOR v_item IN
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    FOR v_i IN 1..v_item.quantity LOOP
      v_ticket_code := 'NX-TKT-' || upper(substring(encode(gen_random_bytes(4), 'hex'), 1, 7));
      v_token := encode(gen_random_bytes(16), 'hex');
      v_hash := encode(
        digest(v_ticket_code || '|' || v_order.event_id::text || '|' || v_token, 'sha256'),
        'hex'
      );
      v_qr_payload := jsonb_build_object(
        'code', v_ticket_code,
        'eventId', v_order.event_id,
        'token', v_token,
        'tier', v_item.tier_name,
        'attendee', v_order.customer_name,
        'issuedAt', v_now
      )::text;

      WITH inserted_ticket AS (
        INSERT INTO public.tickets (
          ticket_code, token, security_hash, order_id, event_id, tier_id,
          attendee_id, attendee_name, attendee_email, attendee_phone,
          price_minor, currency, status, qr_payload
        ) VALUES (
          v_ticket_code, v_token, v_hash, v_order.id, v_order.event_id, v_item.tier_id,
          v_order.customer_id, v_order.customer_name, v_order.customer_email, v_order.customer_phone,
          v_item.unit_price_minor, v_order.currency, 'valid'::public.ticket_status, v_qr_payload
        )
        RETURNING *
      )
      SELECT v_tickets || jsonb_build_array(to_jsonb(inserted_ticket.*))
      INTO v_tickets
      FROM inserted_ticket;
    END LOOP;
  END LOOP;

  -- Post strictly balanced double-entry GAAP journal entries into Organizer Nexora Wallet
  IF v_order.total_minor > 0 THEN
    v_organizer_proceeds := GREATEST(0, v_order.subtotal_minor - v_order.discount_minor);
    v_gateway_fee := ROUND(v_order.total_minor * 0.015)::BIGINT;

    -- 1. Gross customer clearing (Asset Debit)
    INSERT INTO public.ledger_entries (
      order_id, event_id, organizer_id, type, account_code, account_name,
      debit_minor, credit_minor, currency, description, reference
    ) VALUES (
      v_order.id, v_order.event_id, v_event.organizer_id,
      'customer_clearing'::public.ledger_entry_type, '1010', 'Gateway Clearing Receivable',
      v_order.total_minor, 0, v_order.currency,
      'Customer payment received for Order #' || v_order.order_reference,
      v_order.transaction_reference
    );

    -- 2. Net ticket proceeds -> Organizer Nexora Wallet (Liability Credit, locked until event ends)
    IF v_organizer_proceeds > 0 THEN
      INSERT INTO public.ledger_entries (
        order_id, event_id, organizer_id, type, account_code, account_name,
        debit_minor, credit_minor, currency, description, reference
      ) VALUES (
        v_order.id, v_order.event_id, v_event.organizer_id,
        'organizer_payable'::public.ledger_entry_type, '2020', 'Organizer Nexora Wallet Payable',
        0, v_organizer_proceeds, v_order.currency,
        'Ticket proceeds credited to Organizer Nexora Wallet for Order #' || v_order.order_reference || ' (withdrawable after event ends)',
        v_order.transaction_reference
      );
    END IF;

    -- 3. Nexora Platform Fee (Revenue Credit)
    IF (v_order.fee_minor + v_order.tax_minor) > 0 THEN
      INSERT INTO public.ledger_entries (
        order_id, event_id, organizer_id, type, account_code, account_name,
        debit_minor, credit_minor, currency, description, reference
      ) VALUES (
        v_order.id, v_order.event_id, v_event.organizer_id,
        'platform_commission'::public.ledger_entry_type, '4010', 'Nexora Platform Commission',
        0, (v_order.fee_minor + v_order.tax_minor), v_order.currency,
        'NEXORA platform commission for Order #' || v_order.order_reference,
        v_order.transaction_reference
      );
    END IF;

    -- 4. Gateway Interchange Fee pair (keeps Debit = Credit at zero GAAP drift)
    IF v_gateway_fee > 0 THEN
      INSERT INTO public.ledger_entries (
        order_id, event_id, organizer_id, type, account_code, account_name,
        debit_minor, credit_minor, currency, description, reference
      ) VALUES
      (
        v_order.id, v_order.event_id, v_event.organizer_id,
        'processing_fee'::public.ledger_entry_type, '5010', 'Gateway Interchange Expense',
        v_gateway_fee, 0, v_order.currency,
        'Interchange settlement fee for Order #' || v_order.order_reference,
        v_order.transaction_reference
      ),
      (
        v_order.id, v_order.event_id, v_event.organizer_id,
        'customer_clearing'::public.ledger_entry_type, '1010', 'Gateway Clearing Receivable',
        0, v_gateway_fee, v_order.currency,
        'Gateway interchange netting for Order #' || v_order.order_reference,
        v_order.transaction_reference
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order', to_jsonb(v_order),
    'tickets', v_tickets
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. POST-EVENT WALLET WITHDRAWAL LOCK & PAYOUT RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_payout_post_event_and_bank_gate()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_available BIGINT;
BEGIN
  IF NOT public.has_confirmed_bank_details(NEW.organizer_id) THEN
    RAISE EXCEPTION 'Add and confirm your settlement bank account details before withdrawing funds';
  END IF;

  SELECT COALESCE(w.available_payout_minor, 0)
  INTO v_available
  FROM public.v_organizer_wallet_summary w
  WHERE w.organizer_id = NEW.organizer_id;

  IF v_available <= 0 THEN
    RAISE EXCEPTION 'Withdrawals are locked until your event ends. All ticket proceeds remain safely held in your Nexora Wallet';
  END IF;

  IF NEW.amount_minor > v_available THEN
    RAISE EXCEPTION 'Requested withdrawal exceeds your unlocked post-event Nexora Wallet balance';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payout_post_event_and_bank_gate ON public.payout_requests;
CREATE TRIGGER trg_enforce_payout_post_event_and_bank_gate
  BEFORE INSERT ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payout_post_event_and_bank_gate();

CREATE OR REPLACE FUNCTION public.request_organizer_payout(
  p_organizer_id UUID,
  p_amount_minor BIGINT,
  p_currency TEXT DEFAULT 'ZAR'
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_org public.organizer_profiles%ROWTYPE;
  v_available BIGINT;
  v_payout public.payout_requests%ROWTYPE;
  v_tx_ref TEXT;
  v_masked_dest TEXT;
  v_actor_email TEXT;
  v_actor_role public.user_role;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.organizer_profiles o
       WHERE o.id = p_organizer_id AND o.owner_id = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members tm
       WHERE tm.organization_id = p_organizer_id
         AND tm.user_id = auth.uid()
         AND tm.status = 'active'
         AND tm.role IN ('Organization Owner', 'Administrator', 'Finance Manager')
     ) THEN
    RAISE EXCEPTION 'Unauthorized: only the organization owner, admin, or finance manager can withdraw wallet funds';
  END IF;

  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
  END IF;

  -- Lock organizer row to prevent concurrent double-withdrawal races
  SELECT * INTO v_org
  FROM public.organizer_profiles
  WHERE id = p_organizer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer profile not found';
  END IF;

  IF NOT public.has_confirmed_bank_details(p_organizer_id) THEN
    RAISE EXCEPTION 'Add and confirm your settlement bank account details in Nexora Wallet or Organizer Profile before withdrawing funds';
  END IF;

  SELECT COALESCE(w.available_payout_minor, 0)
  INTO v_available
  FROM public.v_organizer_wallet_summary w
  WHERE w.organizer_id = p_organizer_id;

  IF v_available <= 0 THEN
    RAISE EXCEPTION 'Withdrawals are locked until your event ends. All ticket proceeds remain safely held in your Nexora Wallet';
  END IF;

  IF p_amount_minor > v_available THEN
    RAISE EXCEPTION 'Requested withdrawal exceeds your unlocked post-event Nexora Wallet balance';
  END IF;

  v_tx_ref := 'WDR-' || upper(substring(encode(gen_random_bytes(5), 'hex'), 1, 10));
  v_masked_dest := trim(v_org.bank_name) || ' ••••' || right(trim(v_org.bank_account_number), 4);

  INSERT INTO public.payout_requests (
    organizer_id,
    amount_minor,
    currency,
    status,
    destination_bank_name,
    destination_account_number,
    destination_account_holder,
    destination_branch_code,
    destination_account_type,
    wallet_source,
    transaction_reference,
    notes,
    requested_at,
    processed_at
  ) VALUES (
    p_organizer_id,
    p_amount_minor,
    COALESCE(NULLIF(trim(COALESCE(p_currency, '')), ''), 'ZAR'),
    'approved'::public.payout_status,
    trim(v_org.bank_name),
    trim(v_org.bank_account_number),
    trim(v_org.bank_account_holder),
    v_org.bank_branch_code,
    v_org.bank_account_type,
    'nexora_wallet',
    v_tx_ref,
    'Post-event Nexora Wallet settlement withdrawal to ' || v_masked_dest,
    v_now,
    v_now
  )
  RETURNING * INTO v_payout;

  -- Balanced double-entry withdrawal journal pair (Organizer Wallet Debit + Bank Cash Clearing Credit)
  INSERT INTO public.ledger_entries (
    organizer_id, type, account_code, account_name,
    debit_minor, credit_minor, currency, description, reference
  ) VALUES
  (
    p_organizer_id,
    'payout_transfer'::public.ledger_entry_type, '2020', 'Organizer Nexora Wallet Payable',
    p_amount_minor, 0, v_payout.currency,
    'Nexora Wallet withdrawal to ' || v_masked_dest,
    v_tx_ref
  ),
  (
    p_organizer_id,
    'payout_transfer'::public.ledger_entry_type, '1020', 'Settlement Bank Clearing',
    0, p_amount_minor, v_payout.currency,
    'Bank disbursement to ' || v_masked_dest,
    v_tx_ref
  );

  SELECT email, role INTO v_actor_email, v_actor_role
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.audit_logs (
    actor_id, actor_email, actor_role, action, entity_type, entity_id, new_state
  ) VALUES (
    auth.uid(),
    COALESCE(v_actor_email, v_org.email),
    COALESCE(v_actor_role, 'organizer'::public.user_role),
    'NEXORA_WALLET_WITHDRAWAL',
    'payout_request',
    v_payout.id::text,
    jsonb_build_object(
      'organizer_id', p_organizer_id,
      'amount_minor', p_amount_minor,
      'currency', v_payout.currency,
      'destination', v_masked_dest,
      'transaction_reference', v_tx_ref
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payout', jsonb_build_object(
      'id', v_payout.id,
      'organizerId', v_payout.organizer_id,
      'amountMinor', v_payout.amount_minor,
      'currency', v_payout.currency,
      'status', v_payout.status,
      'destinationAccount', v_masked_dest,
      'transactionReference', v_payout.transaction_reference,
      'requestedAt', v_payout.requested_at,
      'processedAt', v_payout.processed_at
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. UPDATED RLS POLICIES & LEAST-PRIVILEGE RPC GRANTS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Organizers can submit payout requests" ON public.payout_requests;
CREATE POLICY "Organizers can submit payout requests"
  ON public.payout_requests FOR INSERT
  WITH CHECK (
    (
      public.is_admin() OR
      organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
    )
    AND public.has_confirmed_bank_details(organizer_id)
  );

DROP POLICY IF EXISTS "Authenticated buyers update own pending orders via checkout" ON public.orders;
CREATE POLICY "Authenticated buyers update own pending orders via checkout"
  ON public.orders FOR UPDATE
  USING (
    public.is_admin() OR
    (auth.uid() = customer_id AND payment_status IN ('created'::public.order_status, 'pending'::public.order_status))
  )
  WITH CHECK (
    public.is_admin() OR
    (auth.uid() = customer_id)
  );

-- Align Pan-African gateway routing in country_launch_gates (Card + Instant EFT + Mobile Money)
UPDATE public.country_launch_gates
SET supported_gateways = CASE country_code
  WHEN 'ZA' THEN ARRAY['paystack', 'ozow', 'stripe_card']::public.payment_provider[]
  WHEN 'KE' THEN ARRAY['mpesa', 'flutterwave', 'paystack']::public.payment_provider[]
  WHEN 'NG' THEN ARRAY['paystack', 'flutterwave']::public.payment_provider[]
  WHEN 'GH' THEN ARRAY['flutterwave', 'paystack']::public.payment_provider[]
  WHEN 'RW' THEN ARRAY['flutterwave', 'mpesa']::public.payment_provider[]
  WHEN 'EG' THEN ARRAY['stripe_card', 'paystack']::public.payment_provider[]
  ELSE array_remove(supported_gateways, 'sandbox'::public.payment_provider)
END,
updated_at = timezone('utc'::text, now())
WHERE country_code IN ('ZA', 'KE', 'NG', 'GH', 'RW', 'EG')
   OR 'sandbox'::public.payment_provider = ANY(supported_gateways);

-- Lock down RPC execution privileges
REVOKE ALL ON FUNCTION public.has_confirmed_bank_details(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_confirmed_bank_details(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_organizer_receive_payment(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_organizer_receive_payment(UUID, BIGINT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_organizer_bank_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_organizer_bank_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_organizer_wallet_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organizer_wallet_summary(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.finalize_order_payment(UUID, public.payment_provider, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_order_payment(UUID, public.payment_provider, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_organizer_payout(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_organizer_payout(UUID, BIGINT, TEXT) TO authenticated, service_role;

GRANT SELECT ON public.v_organizer_wallet_summary TO authenticated, service_role;
