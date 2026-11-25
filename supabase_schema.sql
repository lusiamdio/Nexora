-- ============================================================================
-- NEXORA EVENT COMMERCE PLATFORM — FULL SUPABASE POSTGRESQL BACKEND SCHEMA
-- ============================================================================
-- Complete schema covering all roles (Attendee, Organizer, Scanner, Super Admin),
-- cryptographic ticketing, double-entry GAAP financial ledger, waitlist engine,
-- cashless RFID POS system, country launch gates, webhooks, and Row-Level Security (RLS).
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. ENUM TYPES
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'attendee',
    'organizer',
    'scanner',
    'admin',
    'support_lead',
    'gate_supervisor'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE kyb_status AS ENUM (
    'unverified',
    'pending_kyc',
    'verified',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE event_format AS ENUM (
    'in_person',
    'online',
    'hybrid'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE event_status AS ENUM (
    'draft',
    'published',
    'sold_out',
    'cancelled',
    'ended'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'created',
    'pending',
    'processing',
    'succeeded',
    'failed',
    'refunded'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_provider AS ENUM (
    'paystack',
    'flutterwave',
    'mpesa',
    'ozow',
    'stripe_card',
    'sandbox'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM (
    'valid',
    'checked_in',
    'transferred',
    'cancelled',
    'refunded',
    'revoked'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'customer_clearing',      -- Gross customer payment
    'organizer_payable',      -- Net amount credited to organizer escrow
    'platform_commission',    -- Platform take-rate (e.g. 5%)
    'processing_fee',         -- Gateway interchange pass-through
    'payout_transfer',        -- Settlement paid out to bank
    'refund_reserve',         -- Reserve allocated for chargebacks
    'refund_reversal'         -- Customer clearing reversal
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM (
    'pending',
    'approved',
    'processing',
    'completed',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE waitlist_status AS ENUM (
    'waiting',
    'notified',
    'claimed',
    'expired',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE wristband_status AS ENUM (
    'active',
    'blocked',
    'paired'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE wristband_tx_type AS ENUM (
    'topup',
    'purchase',
    'refund'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_status AS ENUM (
    'received',
    'verified',
    'processed',
    'signature_mismatch',
    'replayed_duplicate',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE announcement_urgency AS ENUM (
    'info',
    'warning',
    'critical'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE announcement_audience AS ENUM (
    'all',
    'organizers',
    'attendees'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 3. CORE TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1 PROFILES (Extends auth.users in Supabase)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'attendee',
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  avatar_url TEXT,
  country TEXT DEFAULT 'ZA',
  city TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_verification')),
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  risk_score INTEGER NOT NULL DEFAULT 5 CHECK (risk_score >= 0 AND risk_score <= 100),
  suspension_reason TEXT,
  notes TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.2 ORGANIZER PROFILES (Promoters, Event Companies, Collectives)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizer_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  legal_entity_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ZA',
  city TEXT NOT NULL,
  address TEXT,
  bio TEXT,
  website TEXT,
  logo_url TEXT,
  banner_url TEXT,
  tax_number TEXT,
  social_links JSONB DEFAULT '{}'::jsonb,
  verified BOOLEAN NOT NULL DEFAULT false,
  verification_status kyb_status NOT NULL DEFAULT 'unverified',
  verification_doc_name TEXT,
  verified_at TIMESTAMPTZ,
  subscription_plan TEXT NOT NULL DEFAULT 'growth' CHECK (subscription_plan IN ('starter', 'growth', 'business')),
  commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0500, -- 5.0% flat default
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_holder TEXT,
  bank_branch_code TEXT,
  bank_account_type TEXT DEFAULT 'Current/Checking',
  bank_details_confirmed BOOLEAN NOT NULL DEFAULT false,
  bank_details_confirmed_at TIMESTAMPTZ,
  bank_details_updated_at TIMESTAMPTZ,
  total_revenue_minor BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.3 TEAM MEMBERS (Organization Delegation & Multi-user Access)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizer_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'Organization Owner',
    'Administrator',
    'Event Manager',
    'Finance Manager',
    'Check-In Staff',
    'Read-Only Analyst'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'deactivated')),
  permissions JSONB NOT NULL DEFAULT '{"events": true, "scanners": true, "finance": false}'::jsonb,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  joined_at TIMESTAMPTZ,
  CONSTRAINT unique_org_email UNIQUE(organization_id, email)
);

-- ----------------------------------------------------------------------------
-- 3.4 EVENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizer_id UUID NOT NULL REFERENCES public.organizer_profiles(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Concerts & Music',
    'Tech & Innovation',
    'Food & Wine',
    'Arts & Culture',
    'Business & Summits',
    'Sports & Wellness',
    'Nightlife & Parties',
    'Faith & Community'
  )),
  format event_format NOT NULL DEFAULT 'in_person',
  description TEXT NOT NULL,
  short_summary TEXT NOT NULL,
  cover_image TEXT NOT NULL,
  banner_image TEXT,
  gallery TEXT[] DEFAULT ARRAY[]::TEXT[],
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  
  -- Venue JSON & Spatial Metadata
  venue_name TEXT NOT NULL,
  venue_address TEXT NOT NULL,
  venue_city TEXT NOT NULL,
  venue_country TEXT NOT NULL,
  venue_postal_code TEXT,
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  virtual_url TEXT,
  
  status event_status NOT NULL DEFAULT 'published',
  featured BOOLEAN NOT NULL DEFAULT false,
  age_restriction TEXT,
  refund_policy TEXT NOT NULL DEFAULT 'Refunds permitted up to 7 days prior to event commencement.',
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  currency TEXT NOT NULL DEFAULT 'ZAR',
  min_price_minor BIGINT NOT NULL DEFAULT 0,
  capacity_cap INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private', 'invitation')),
  
  -- Extended structured metadata
  agenda JSONB DEFAULT '[]'::jsonb,
  performers JSONB DEFAULT '[]'::jsonb,
  sponsors JSONB DEFAULT '[]'::jsonb,
  faqs JSONB DEFAULT '[]'::jsonb,
  custom_questions JSONB DEFAULT '[]'::jsonb,
  payout_settings JSONB,
  theme_preset TEXT DEFAULT 'onyx_gold',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.5 TICKET TIERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  sold_count INTEGER NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  min_per_order INTEGER NOT NULL DEFAULT 1,
  max_per_order INTEGER NOT NULL DEFAULT 10,
  sales_start TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  sales_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold_out', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT check_capacity_bounds CHECK (sold_count + reserved_count <= capacity)
);

-- ----------------------------------------------------------------------------
-- 3.6 PROMO CODES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  organizer_id UUID REFERENCES public.organizer_profiles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  discount_percentage INTEGER NOT NULL CHECK (discount_percentage >= 1 AND discount_percentage <= 100),
  max_uses INTEGER NOT NULL DEFAULT 100,
  times_used INTEGER NOT NULL DEFAULT 0 CHECK (times_used <= max_uses),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  valid_to TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.7 ORDERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_reference TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  event_title TEXT NOT NULL,
  
  -- Minor unit financial values
  subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
  fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  
  payment_status order_status NOT NULL DEFAULT 'created',
  payment_method TEXT NOT NULL,
  payment_provider payment_provider NOT NULL DEFAULT 'paystack',
  payment_rail TEXT CHECK (payment_rail IS NULL OR payment_rail IN ('card', 'ozow', 'momo', 'free')),
  mobile_money_channel TEXT CHECK (mobile_money_channel IS NULL OR mobile_money_channel IN ('M-Pesa', 'MTN MoMo', 'Airtel Money')),
  transaction_reference TEXT NOT NULL,
  promo_code_applied TEXT,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.8 ORDER ITEMS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES public.ticket_tiers(id) ON DELETE RESTRICT,
  tier_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  total_price_minor BIGINT NOT NULL CHECK (total_price_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.9 TICKETS (Cryptographic Passports & Tamper-Evident Passes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_code TEXT NOT NULL UNIQUE,          -- e.g. NX-TKT-84920
  token TEXT NOT NULL UNIQUE,                -- Random high-entropy validation token
  security_hash TEXT NOT NULL,               -- SHA-256 HMAC anti-counterfeit hash
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  tier_id UUID NOT NULL REFERENCES public.ticket_tiers(id) ON DELETE RESTRICT,
  attendee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attendee_name TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  attendee_phone TEXT,
  price_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status ticket_status NOT NULL DEFAULT 'valid',
  checked_in_at TIMESTAMPTZ,
  checked_in_by TEXT,
  gate TEXT,
  qr_payload TEXT NOT NULL,
  refund_reason TEXT,
  custom_answers JSONB DEFAULT '{}'::jsonb,
  transfer_allowed BOOLEAN NOT NULL DEFAULT true,
  resale_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.10 CHECK-IN LOGS (Fleet Gate Scanners & Anti-Passback Telemetry)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_ins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  ticket_code TEXT NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  staff_name TEXT NOT NULL,
  scanner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  gate TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN (
    'valid',
    'already_checked_in',
    'invalid',
    'refunded',
    'wrong_event'
  )),
  message TEXT NOT NULL,
  offline_sync BOOLEAN NOT NULL DEFAULT false,
  device_info JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.11 DOUBLE-ENTRY GENERAL LEDGER (Immutable GAAP Journal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  organizer_id UUID REFERENCES public.organizer_profiles(id) ON DELETE RESTRICT,
  type ledger_entry_type NOT NULL,
  account_code TEXT NOT NULL DEFAULT '2010', -- GAAP Chart of Accounts Code
  account_name TEXT NOT NULL DEFAULT 'Customer Clearing',
  debit_minor BIGINT NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor BIGINT NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  description TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT check_at_least_one_amount CHECK (debit_minor > 0 OR credit_minor > 0),
  CONSTRAINT check_cannot_have_both CHECK (NOT (debit_minor > 0 AND credit_minor > 0))
);

-- ----------------------------------------------------------------------------
-- 3.12 PAYOUT REQUESTS (Milestone & Post-Event Bank Transfers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organizer_id UUID NOT NULL REFERENCES public.organizer_profiles(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status payout_status NOT NULL DEFAULT 'pending',
  destination_bank_name TEXT NOT NULL,
  destination_account_number TEXT NOT NULL,
  destination_account_holder TEXT NOT NULL,
  destination_branch_code TEXT,
  destination_account_type TEXT,
  wallet_source TEXT NOT NULL DEFAULT 'nexora_wallet',
  transaction_reference TEXT,
  notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.13 REFUND REQUESTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processed')),
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.14 WAITLIST ENTRIES (Queue & 2-Hour Automated Reclamation Engine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES public.ticket_tiers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  phone TEXT,
  name TEXT,
  position INTEGER NOT NULL CHECK (position > 0),
  status waitlist_status NOT NULL DEFAULT 'waiting',
  claim_token TEXT UNIQUE,
  claim_expires_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  dispatch_log JSONB DEFAULT '{}'::jsonb,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_event_waitlist_email UNIQUE(event_id, email)
);

-- ----------------------------------------------------------------------------
-- 3.15 CASHLESS RFID WRISTBANDS & POS TRANSACTIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cashless_wristbands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uid TEXT NOT NULL UNIQUE,                   -- NFC Hardware UID (e.g. 04:A2:3B:18:9C)
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  linked_ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  attendee_name TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  attendee_phone TEXT,
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  status wristband_status NOT NULL DEFAULT 'active',
  pin_hash TEXT,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  last_tapped_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.wristband_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wristband_id UUID NOT NULL REFERENCES public.cashless_wristbands(id) ON DELETE CASCADE,
  wristband_uid TEXT NOT NULL,
  type wristband_tx_type NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  balance_after_minor BIGINT NOT NULL CHECK (balance_after_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ZAR',
  vendor_name TEXT NOT NULL,
  vendor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.16 COUNTRY LAUNCH GATES (Pan-African Compliance & Gateway Routing)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.country_launch_gates (
  country_code TEXT PRIMARY KEY,               -- ZA, KE, NG, GH, RW, EG
  country_name TEXT NOT NULL,
  flag TEXT NOT NULL,
  currency TEXT NOT NULL,
  wave INTEGER NOT NULL DEFAULT 1,
  legal_entity_approved BOOLEAN NOT NULL DEFAULT true,
  payment_provider_live BOOLEAN NOT NULL DEFAULT true,
  settlement_currency_confirmed BOOLEAN NOT NULL DEFAULT true,
  compliant_funds_flow_model BOOLEAN NOT NULL DEFAULT true,
  refund_procedures_documented BOOLEAN NOT NULL DEFAULT true,
  tax_invoicing_reviewed BOOLEAN NOT NULL DEFAULT true,
  privacy_popia_ready BOOLEAN NOT NULL DEFAULT true,
  support_escalation_tested BOOLEAN NOT NULL DEFAULT true,
  e2e_test_passed BOOLEAN NOT NULL DEFAULT true,
  paid_sales_authorized BOOLEAN NOT NULL DEFAULT true,
  supported_gateways payment_provider[] DEFAULT ARRAY['paystack', 'stripe_card']::payment_provider[],
  default_commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0500,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.17 WEBHOOK INGESTION LOGS (Cryptographic HMAC Audit Trail)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider payment_provider NOT NULL,
  event_id TEXT NOT NULL,
  event_signature TEXT NOT NULL,
  status webhook_status NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_summary TEXT NOT NULL,
  response_code INTEGER DEFAULT 200,
  amount_minor BIGINT,
  currency TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT unique_provider_event UNIQUE(provider, event_id)
);

-- ----------------------------------------------------------------------------
-- 3.18 PLATFORM ANNOUNCEMENTS (Global Broadcasts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  urgency announcement_urgency NOT NULL DEFAULT 'info',
  target_audience announcement_audience NOT NULL DEFAULT 'all',
  active BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- 3.19 COMMUNITY PULSE & HIGHLIGHTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_highlights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  event_title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_avatar TEXT NOT NULL,
  role_badge TEXT NOT NULL DEFAULT 'Festival Attendee',
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'x', 'tiktok')),
  image_url TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL DEFAULT 'portrait' CHECK (aspect_ratio IN ('square', 'portrait', 'tall')),
  quote TEXT NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  likes_count INTEGER NOT NULL DEFAULT 0,
  city TEXT NOT NULL DEFAULT 'Cape Town',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ----------------------------------------------------------------------------
-- 3.20 IMMUTABLE AUDIT LOGS (Super Admin Governance)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  actor_role user_role NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_state JSONB,
  new_state JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 4. PERFORMANCE & SEARCH INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_events_slug ON public.events(slug);
CREATE INDEX IF NOT EXISTS idx_events_organizer ON public.events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_status_date ON public.events(status, start_date);
CREATE INDEX IF NOT EXISTS idx_events_city ON public.events(venue_city);
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events(category);

CREATE INDEX IF NOT EXISTS idx_ticket_tiers_event ON public.ticket_tiers(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_reference ON public.orders(order_reference);
CREATE INDEX IF NOT EXISTS idx_orders_event ON public.orders(event_id);

CREATE INDEX IF NOT EXISTS idx_tickets_code ON public.tickets(ticket_code);
CREATE INDEX IF NOT EXISTS idx_tickets_token ON public.tickets(token);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON public.tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON public.tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_attendee ON public.tickets(attendee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_email ON public.tickets(attendee_email);

CREATE INDEX IF NOT EXISTS idx_checkins_ticket ON public.check_ins(ticket_id);
CREATE INDEX IF NOT EXISTS idx_checkins_event ON public.check_ins(event_id);
CREATE INDEX IF NOT EXISTS idx_checkins_timestamp ON public.check_ins(timestamp);

CREATE INDEX IF NOT EXISTS idx_ledger_order ON public.ledger_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_organizer ON public.ledger_entries(organizer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_currency ON public.ledger_entries(currency);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON public.ledger_entries(created_at);

CREATE INDEX IF NOT EXISTS idx_waitlist_event_pos ON public.waitlist_entries(event_id, position);
CREATE INDEX IF NOT EXISTS idx_waitlist_claim_token ON public.waitlist_entries(claim_token);

CREATE INDEX IF NOT EXISTS idx_wristbands_uid ON public.cashless_wristbands(uid);
CREATE INDEX IF NOT EXISTS idx_wristbands_event ON public.cashless_wristbands(event_id);
CREATE INDEX IF NOT EXISTS idx_wristband_tx_wristband ON public.wristband_transactions(wristband_id);

CREATE INDEX IF NOT EXISTS idx_webhooks_provider_event ON public.webhook_logs(provider, event_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_logs(created_at);

-- ============================================================================
-- 5. BUSINESS LOGIC FUNCTIONS & VIEWS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5.1 USER PROFILE AUTOMATION TRIGGER (Supabase auth.users -> public.profiles)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public, auth, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_role public.user_role := 'attendee';
  v_name TEXT;
  v_role_str TEXT;
BEGIN
  -- Safe name extraction (supports full_name, name, or email prefix)
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'New Member'
  );

  -- Restrict self-registration strictly to attendee or organizer (privileged roles assigned server-side/admin only)
  v_role_str := LOWER(COALESCE(NEW.raw_user_meta_data->>'role', 'attendee'));
  IF v_role_str = 'organizer' THEN
    v_role := 'organizer'::public.user_role;
  ELSE
    v_role := 'attendee'::public.user_role;
  END IF;

  INSERT INTO public.profiles (
    id,
    name,
    email,
    role,
    avatar_url,
    country,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    v_name,
    NEW.email,
    v_role,
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'country', 'ZA'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.profiles.name),
    updated_at = NOW();
    
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Guard against crashing user registration; log warning to database log
  RAISE WARNING 'handle_new_user trigger non-fatal issue for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Recreate clean trigger on auth.users (strictly AFTER INSERT)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 5.2 ANTI-PASSBACK TURNSTILE CHECK-IN PROCEDURE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_ticket_scan(
  p_ticket_code TEXT,
  p_staff_name TEXT,
  p_gate TEXT,
  p_scanner_user_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_ticket RECORD;
  v_result TEXT;
  v_msg TEXT;
BEGIN
  -- Verify caller is authorized to operate gate scanner
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND public.current_user_role() NOT IN ('scanner', 'gate_supervisor', 'organizer') THEN
    RAISE EXCEPTION 'Unauthorized gate scanner operation';
  END IF;

  -- Locate and lock ticket row to prevent concurrent duplicate check-in race condition
  SELECT * INTO v_ticket 
  FROM public.tickets 
  WHERE ticket_code = p_ticket_code
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.check_ins (
      ticket_id, ticket_code, event_id, staff_name, scanner_user_id, gate, result, message
    ) VALUES (
      NULL, p_ticket_code, NULL, p_staff_name, p_scanner_user_id, p_gate, 'invalid', 'Ticket code not found in registry.'
    );
    RETURN jsonb_build_object('success', false, 'result', 'invalid', 'message', 'Invalid Ticket Code.');
  END IF;

  -- Organizers may only scan tickets for their own events
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND public.current_user_role() = 'organizer'
     AND NOT EXISTS (
       SELECT 1 FROM public.events e
       JOIN public.organizer_profiles o ON e.organizer_id = o.id
       WHERE e.id = v_ticket.event_id AND o.owner_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Unauthorized: ticket does not belong to your organization';
  END IF;

  -- Check status
  IF v_ticket.status = 'checked_in' THEN
    v_result := 'already_checked_in';
    v_msg := 'PASSBACK REJECTED: Ticket was already checked in at ' || to_char(v_ticket.checked_in_at, 'HH24:MI:SS') || ' at ' || COALESCE(v_ticket.gate, 'Gate Alpha');
    
    INSERT INTO public.check_ins (
      ticket_id, ticket_code, event_id, staff_name, scanner_user_id, gate, result, message
    ) VALUES (
      v_ticket.id, v_ticket.ticket_code, v_ticket.event_id, p_staff_name, p_scanner_user_id, p_gate, v_result, v_msg
    );
    
    RETURN jsonb_build_object('success', false, 'result', v_result, 'message', v_msg, 'ticket', row_to_json(v_ticket));
  ELSIF v_ticket.status = 'refunded' OR v_ticket.status = 'cancelled' OR v_ticket.status = 'revoked' THEN
    v_result := 'refunded';
    v_msg := 'ADMISSION DENIED: Ticket has been ' || v_ticket.status || '.';
    
    INSERT INTO public.check_ins (
      ticket_id, ticket_code, event_id, staff_name, scanner_user_id, gate, result, message
    ) VALUES (
      v_ticket.id, v_ticket.ticket_code, v_ticket.event_id, p_staff_name, p_scanner_user_id, p_gate, v_result, v_msg
    );
    
    RETURN jsonb_build_object('success', false, 'result', v_result, 'message', v_msg);
  END IF;

  -- Mark ticket valid & checked in
  UPDATE public.tickets
  SET status = 'checked_in',
      checked_in_at = timezone('utc'::text, now()),
      checked_in_by = p_staff_name,
      gate = p_gate,
      updated_at = timezone('utc'::text, now())
  WHERE id = v_ticket.id;

  INSERT INTO public.check_ins (
    ticket_id, ticket_code, event_id, staff_name, scanner_user_id, gate, result, message
  ) VALUES (
    v_ticket.id, v_ticket.ticket_code, v_ticket.event_id, p_staff_name, p_scanner_user_id, p_gate, 'valid', 'Access Granted: Verified Attendee Pass.'
  );

  RETURN jsonb_build_object(
    'success', true, 
    'result', 'valid', 
    'message', 'Approved: Welcome ' || v_ticket.attendee_name || '!',
    'attendeeName', v_ticket.attendee_name,
    'tierName', (SELECT name FROM public.ticket_tiers WHERE id = v_ticket.tier_id)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5.3 CASHLESS RFID POS DEDUCTION FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_wristband_charge(
  p_uid TEXT,
  p_amount_minor BIGINT,
  p_vendor_name TEXT,
  p_vendor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_wb RECORD;
  v_new_bal BIGINT;
  v_ref TEXT;
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Charge amount must be positive.');
  END IF;

  SELECT * INTO v_wb 
  FROM public.cashless_wristbands 
  WHERE uid = p_uid FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wristband not paired.');
  END IF;

  IF v_wb.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wristband is ' || v_wb.status || '.');
  END IF;

  IF v_wb.balance_minor < p_amount_minor THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', 'Insufficient Funds. Current Balance: ' || v_wb.currency || ' ' || (v_wb.balance_minor::numeric / 100)::text
    );
  END IF;

  v_new_bal := v_wb.balance_minor - p_amount_minor;
  v_ref := 'POS-' || p_uid || '-' || substring(gen_random_uuid()::text, 1, 6);

  UPDATE public.cashless_wristbands
  SET balance_minor = v_new_bal,
      last_tapped_at = timezone('utc'::text, now())
  WHERE id = v_wb.id;

  INSERT INTO public.wristband_transactions (
    wristband_id, wristband_uid, type, amount_minor, balance_after_minor, currency, vendor_name, vendor_user_id, reference
  ) VALUES (
    v_wb.id, v_wb.uid, 'purchase', p_amount_minor, v_new_bal, v_wb.currency, p_vendor_name, p_vendor_user_id, v_ref
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Payment Approved: ' || v_wb.currency || ' ' || (p_amount_minor::numeric / 100)::text || ' deducted.',
    'newBalanceMinor', v_new_bal,
    'currency', v_wb.currency,
    'reference', v_ref
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5.4 DOUBLE-ENTRY LEDGER RECONCILIATION AUDIT VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ledger_reconciliation AS
SELECT 
  currency,
  SUM(debit_minor) AS total_debits_minor,
  SUM(credit_minor) AS total_credits_minor,
  (SUM(debit_minor) - SUM(credit_minor)) AS drift_minor,
  CASE 
    WHEN SUM(debit_minor) = SUM(credit_minor) THEN true 
    ELSE false 
  END AS is_balanced,
  COUNT(*) AS total_entries
FROM public.ledger_entries
GROUP BY currency;

-- ----------------------------------------------------------------------------
-- 5.5 BANKING CONFIRMATION, PAYMENT GATES & NEXORA WALLET ENGINE
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

-- ============================================================================
-- 6. ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashless_wristbands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wristband_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_launch_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Helper Functions for RLS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Prevent privilege escalation on self-update of profiles
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.risk_score IS DISTINCT FROM OLD.risk_score
       OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
       OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'Insufficient privileges to modify restricted profile security columns';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- ----------------------------------------------------------------------------
-- RLS: PROFILES
-- ----------------------------------------------------------------------------
CREATE POLICY "Profiles readable by owner or admins"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role full access on profiles"
  ON public.profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- RLS: ORGANIZER PROFILES & TEAM MEMBERS
-- ----------------------------------------------------------------------------
CREATE POLICY "Verified organizer profiles readable publicly or by owner/admin"
  ON public.organizer_profiles FOR SELECT
  USING (verified = true OR owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "Authenticated users can create their organizer profile"
  ON public.organizer_profiles FOR INSERT
  WITH CHECK (auth.uid() = owner_id OR public.is_admin());

CREATE POLICY "Organizer owners or admins can update organizer profiles"
  ON public.organizer_profiles FOR UPDATE
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

CREATE POLICY "Team members readable by self, org owner, or admin"
  ON public.team_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    public.is_admin() OR
    organization_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

CREATE POLICY "Org owners and admins manage team members"
  ON public.team_members FOR ALL
  USING (
    public.is_admin() OR
    organization_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin() OR
    organization_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- RLS: EVENTS
-- ----------------------------------------------------------------------------
CREATE POLICY "Public events readable by everyone"
  ON public.events FOR SELECT
  USING (status = 'published' OR public.is_admin() OR organizer_id IN (
    SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid()
  ));

CREATE POLICY "Organizers can create events"
  ON public.events FOR INSERT
  WITH CHECK (
    public.is_admin() OR 
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

CREATE POLICY "Organizers can update their own events"
  ON public.events FOR UPDATE
  USING (
    public.is_admin() OR 
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- RLS: TICKET TIERS
-- ----------------------------------------------------------------------------
CREATE POLICY "Tiers readable by everyone"
  ON public.ticket_tiers FOR SELECT
  USING (true);

CREATE POLICY "Organizers manage their event tiers"
  ON public.ticket_tiers FOR ALL
  USING (
    public.is_admin() OR 
    event_id IN (
      SELECT e.id FROM public.events e 
      JOIN public.organizer_profiles o ON e.organizer_id = o.id 
      WHERE o.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: ORDERS & ORDER ITEMS
-- ----------------------------------------------------------------------------
CREATE POLICY "Customers view their own orders"
  ON public.orders FOR SELECT
  USING (
    auth.uid() = customer_id OR 
    public.is_admin() OR
    event_id IN (
      SELECT e.id FROM public.events e 
      JOIN public.organizer_profiles o ON e.organizer_id = o.id 
      WHERE o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Customers can create orders"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = customer_id OR customer_id IS NULL);

CREATE POLICY "Order items readable with order"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.customer_id = auth.uid() OR public.is_admin()))
  );

-- ----------------------------------------------------------------------------
-- RLS: TICKETS
-- ----------------------------------------------------------------------------
CREATE POLICY "Attendees view their own tickets"
  ON public.tickets FOR SELECT
  USING (
    auth.uid() = attendee_id OR
    attendee_email = (SELECT email FROM public.profiles WHERE id = auth.uid()) OR
    public.is_admin() OR
    event_id IN (
      SELECT e.id FROM public.events e 
      JOIN public.organizer_profiles o ON e.organizer_id = o.id 
      WHERE o.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: CHECK-INS
-- ----------------------------------------------------------------------------
CREATE POLICY "Check-in logs viewable by organizers, staff, and admins"
  ON public.check_ins FOR SELECT
  USING (
    public.is_admin() OR
    event_id IN (
      SELECT e.id FROM public.events e 
      JOIN public.organizer_profiles o ON e.organizer_id = o.id 
      WHERE o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Gate staff can insert check-in records"
  ON public.check_ins FOR INSERT
  WITH CHECK (
    public.is_admin() OR
    public.current_user_role() IN ('scanner', 'gate_supervisor') OR
    event_id IN (
      SELECT e.id FROM public.events e
      JOIN public.organizer_profiles o ON e.organizer_id = o.id
      WHERE o.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: PROMO CODES, PAYOUTS, REFUNDS & WAITLIST
-- ----------------------------------------------------------------------------
CREATE POLICY "Active promo codes verifiable or managed by owner/admin"
  ON public.promo_codes FOR SELECT
  USING (
    active = true OR
    public.is_admin() OR
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

CREATE POLICY "Organizers and admins manage promo codes"
  ON public.promo_codes FOR ALL
  USING (
    public.is_admin() OR
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin() OR
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

CREATE POLICY "Payout requests viewable by owning organizer or admin"
  ON public.payout_requests FOR SELECT
  USING (
    public.is_admin() OR
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

CREATE POLICY "Organizers can submit payout requests"
  ON public.payout_requests FOR INSERT
  WITH CHECK (
    (
      public.is_admin() OR
      organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
    )
    AND public.has_confirmed_bank_details(organizer_id)
  );

CREATE POLICY "Only admins can approve or update payout status"
  ON public.payout_requests FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Refund requests readable by attendee, organizer, or admin"
  ON public.refund_requests FOR SELECT
  USING (
    public.is_admin() OR
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.attendee_id = auth.uid()) OR
    event_id IN (
      SELECT e.id FROM public.events e
      JOIN public.organizer_profiles o ON e.organizer_id = o.id
      WHERE o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Attendees can submit refund requests for their tickets"
  ON public.refund_requests FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.attendee_id = auth.uid())
  );

CREATE POLICY "Organizers and admins can review refund requests"
  ON public.refund_requests FOR UPDATE
  USING (
    public.is_admin() OR
    event_id IN (
      SELECT e.id FROM public.events e
      JOIN public.organizer_profiles o ON e.organizer_id = o.id
      WHERE o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Waitlist viewable by member, organizer, or admin"
  ON public.waitlist_entries FOR SELECT
  USING (
    auth.uid() = user_id OR
    public.is_admin() OR
    event_id IN (
      SELECT e.id FROM public.events e
      JOIN public.organizer_profiles o ON e.organizer_id = o.id
      WHERE o.owner_id = auth.uid()
    )
  );

CREATE POLICY "Waitlist entries creatable by authenticated or guest users"
  ON public.waitlist_entries FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Organizers and admins manage waitlist state"
  ON public.waitlist_entries FOR UPDATE
  USING (
    public.is_admin() OR
    event_id IN (
      SELECT e.id FROM public.events e
      JOIN public.organizer_profiles o ON e.organizer_id = o.id
      WHERE o.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: GENERAL LEDGER
-- ----------------------------------------------------------------------------
CREATE POLICY "Only Super Admins and owning Organizers can view ledger"
  ON public.ledger_entries FOR SELECT
  USING (
    public.is_admin() OR
    organizer_id IN (SELECT id FROM public.organizer_profiles WHERE owner_id = auth.uid())
  );

CREATE POLICY "Ledger entries can only be written by system or admin"
  ON public.ledger_entries FOR INSERT
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- RLS: CASHLESS WRISTBANDS
-- ----------------------------------------------------------------------------
CREATE POLICY "Wristbands viewable by owner or admin"
  ON public.cashless_wristbands FOR SELECT
  USING (
    auth.uid() = user_id OR
    attendee_email = (SELECT email FROM public.profiles WHERE id = auth.uid()) OR
    public.is_admin()
  );

CREATE POLICY "Wristband transactions viewable by owner or admin"
  ON public.wristband_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cashless_wristbands w 
      WHERE w.id = wristband_id AND (w.user_id = auth.uid() OR public.is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- RLS: LAUNCH GATES, ANNOUNCEMENTS, WEBHOOKS & AUDIT LOGS
-- ----------------------------------------------------------------------------
CREATE POLICY "Launch gates readable by all"
  ON public.country_launch_gates FOR SELECT
  USING (true);

CREATE POLICY "Only admins can update launch gates"
  ON public.country_launch_gates FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Announcements readable by all"
  ON public.platform_announcements FOR SELECT
  USING (active = true OR public.is_admin());

CREATE POLICY "Only admins manage announcements"
  ON public.platform_announcements FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Community pulse readable by all"
  ON public.community_highlights FOR SELECT
  USING (true);

CREATE POLICY "Only admins can read webhook logs"
  ON public.webhook_logs FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Only admins can read audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can write audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6.1 BANKING PROTECTION, RAIL VALIDATION & ATOMIC SETTLEMENT TRIGGERS / RPCS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_organizer_privileged_columns()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql AS $$
DECLARE
  v_bank_changed BOOLEAN;
BEGIN
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

  v_bank_changed := (
    NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
    OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder
    OR NEW.bank_branch_code IS DISTINCT FROM OLD.bank_branch_code
    OR NEW.bank_account_type IS DISTINCT FROM OLD.bank_account_type
  );

  IF v_bank_changed THEN
    NEW.bank_details_updated_at := timezone('utc'::text, now());
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
  IF NEW.payment_provider = 'sandbox'::public.payment_provider
     AND (NEW.payment_status IN ('processing'::public.order_status, 'succeeded'::public.order_status)
          OR NEW.payment_rail IS NOT NULL) THEN
    RAISE EXCEPTION 'Sandbox simulation rail is disabled. Select Card, Instant EFT, or Mobile Money (M-Pesa, MTN MoMo, Airtel Money)';
  END IF;

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

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin()
     AND NOT (v_order.customer_id IS NOT NULL AND v_order.customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized payment settlement attempt for order %', p_order_id;
  END IF;

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

  IF v_order.total_minor > 0 AND NOT public.has_confirmed_bank_details(v_event.organizer_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ticket payments are paused until the organizer adds and confirms their settlement bank account details.'
    );
  END IF;

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

  IF v_order.promo_code_applied IS NOT NULL AND length(trim(v_order.promo_code_applied)) > 0 THEN
    UPDATE public.promo_codes
    SET times_used = LEAST(max_uses, times_used + 1)
    WHERE code = upper(trim(v_order.promo_code_applied))
      AND active = true;
  END IF;

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

  IF v_order.total_minor > 0 THEN
    v_organizer_proceeds := GREATEST(0, v_order.subtotal_minor - v_order.discount_minor);
    v_gateway_fee := ROUND(v_order.total_minor * 0.015)::BIGINT;

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
    organizer_id, amount_minor, currency, status,
    destination_bank_name, destination_account_number, destination_account_holder,
    destination_branch_code, destination_account_type, wallet_source,
    transaction_reference, notes, requested_at, processed_at
  ) VALUES (
    p_organizer_id, p_amount_minor,
    COALESCE(NULLIF(trim(COALESCE(p_currency, '')), ''), 'ZAR'),
    'approved'::public.payout_status,
    trim(v_org.bank_name), trim(v_org.bank_account_number), trim(v_org.bank_account_holder),
    v_org.bank_branch_code, v_org.bank_account_type, 'nexora_wallet',
    v_tx_ref, 'Post-event Nexora Wallet settlement withdrawal to ' || v_masked_dest,
    v_now, v_now
  )
  RETURNING * INTO v_payout;

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

-- ============================================================================
-- 7. INITIAL PAN-AFRICAN LAUNCH GATES SEEDING
-- ============================================================================
INSERT INTO public.country_launch_gates (
  country_code, country_name, flag, currency, wave, legal_entity_approved, 
  payment_provider_live, settlement_currency_confirmed, compliant_funds_flow_model,
  refund_procedures_documented, tax_invoicing_reviewed, privacy_popia_ready,
  support_escalation_tested, e2e_test_passed, paid_sales_authorized, supported_gateways
) VALUES 
('ZA', 'South Africa', '🇿🇦', 'ZAR', 1, true, true, true, true, true, true, true, true, true, true, ARRAY['paystack', 'ozow', 'stripe_card']::payment_provider[]),
('KE', 'Kenya', '🇰🇪', 'KES', 1, true, true, true, true, true, true, true, true, true, true, ARRAY['mpesa', 'flutterwave', 'paystack']::payment_provider[]),
('NG', 'Nigeria', '🇳🇬', 'NGN', 1, true, true, true, true, true, true, true, true, true, true, ARRAY['paystack', 'flutterwave']::payment_provider[]),
('GH', 'Ghana', '🇬🇭', 'GHS', 2, true, true, true, true, true, true, true, true, true, true, ARRAY['flutterwave', 'paystack']::payment_provider[]),
('RW', 'Rwanda', '🇷🇼', 'RWF', 2, true, true, true, true, true, true, true, true, true, true, ARRAY['flutterwave', 'mpesa']::payment_provider[]),
('EG', 'Egypt', '🇪🇬', 'USD', 3, true, true, true, true, true, true, true, true, true, true, ARRAY['stripe_card', 'paystack']::payment_provider[])
ON CONFLICT (country_code) DO NOTHING;

-- ============================================================================
-- END OF NEXORA SUPABASE SCHEMA
-- ============================================================================
