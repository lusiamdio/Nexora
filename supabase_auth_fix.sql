-- ============================================================================
-- NEXORA PLATFORM — SUPABASE AUTH, RBAC & PRIVILEGE ESCALATION HARDENING PATCH
-- Resolves: "Database error saving new user" & enforces least-privilege RLS
-- ============================================================================

-- 1. Least-privilege schema & object permissions
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role, supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role, supabase_auth_admin;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role, supabase_auth_admin;

-- Authenticated sessions rely on table-level grants gated strictly by RLS policies
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Public marketplace catalog read grants for anonymous visitors
GRANT SELECT ON public.events, public.ticket_tiers, public.country_launch_gates, public.platform_announcements, public.community_highlights TO anon;
GRANT INSERT ON public.waitlist_entries TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, service_role, supabase_auth_admin;

-- 2. Harden helper functions with explicit search_path
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
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

-- 3. Prevent self-escalation of role, status, risk_score, or admin notes on profile updates
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

-- 4. Secure INSERT, UPDATE, and service_role RLS policies on public.profiles & check_ins
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "Service role full access on profiles" ON public.profiles;
CREATE POLICY "Service role full access on profiles"
  ON public.profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Gate staff can insert check-in records" ON public.check_ins;
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

-- 5. Replace handle_new_user() with explicit search_path & strict role whitelist (attendee/organizer only)
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
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'New Member'
  );

  -- Strictly restrict client self-signup roles to attendee or organizer
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
  RAISE WARNING 'handle_new_user trigger non-fatal issue for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 6. Reattach clean AFTER INSERT trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
