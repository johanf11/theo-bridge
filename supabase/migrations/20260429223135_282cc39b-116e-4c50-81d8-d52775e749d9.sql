-- ========== ENUMS ==========
CREATE TYPE public.app_role AS ENUM ('admin', 'customer');
CREATE TYPE public.kyb_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE public.order_status AS ENUM ('CREATED', 'QUOTED', 'FUNDED', 'RELEASING', 'COMPLETED', 'FAILED', 'EXPIRED', 'REFUNDED');
CREATE TYPE public.wallet_type AS ENUM ('TREASURY', 'CUSTOMER');
CREATE TYPE public.job_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE public.job_type AS ENUM ('SPIH_RECONCILE', 'USDC_RELEASE', 'STELLAR_CONFIRM');

-- ========== USER ROLES ==========
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== CUSTOMERS ==========
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  company_name text NOT NULL,
  email text NOT NULL,
  phone text,
  stellar_wallet_address text,
  kyb_status public.kyb_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own profile" ON public.customers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Customers insert own profile" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Customers update own profile" ON public.customers FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete customers" ON public.customers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Prevent customers from changing kyb_status or stellar_wallet_address (admin-only fields)
CREATE OR REPLACE FUNCTION public.protect_customer_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.kyb_status := OLD.kyb_status;
    NEW.stellar_wallet_address := OLD.stellar_wallet_address;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER customers_protect BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.protect_customer_fields();

-- ========== WALLETS ==========
CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  wallet_type public.wallet_type NOT NULL,
  stellar_address text NOT NULL UNIQUE,
  label text,
  usdc_balance numeric(20, 7) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own wallet" ON public.wallets FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins manage wallets" ON public.wallets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== ORDERS ==========
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT NOT NULL,
  status public.order_status NOT NULL DEFAULT 'CREATED',
  htg_amount numeric(18, 2) NOT NULL,
  usdc_amount numeric(20, 7) NOT NULL,
  rate numeric(10, 4) NOT NULL,
  spot_rate numeric(10, 4) NOT NULL,
  forward_premium numeric(10, 4) NOT NULL DEFAULT 2,
  margin numeric(10, 4) NOT NULL DEFAULT 3,
  reference_number text NOT NULL UNIQUE,
  quote_expires_at timestamptz NOT NULL,
  funded_at timestamptz,
  released_at timestamptz,
  completed_at timestamptz,
  stellar_tx_hash text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usdc_min CHECK (usdc_amount >= 1000),
  CONSTRAINT usdc_max CHECK (usdc_amount <= 50000)
);
CREATE INDEX orders_customer_idx ON public.orders(customer_id);
CREATE INDEX orders_status_idx ON public.orders(status);
CREATE INDEX orders_reference_idx ON public.orders(reference_number);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own orders" ON public.orders FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
  );
-- Inserts go through edge function with service role; deny direct inserts
CREATE POLICY "Admins manage orders" ON public.orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER wallets_touch BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ========== JOB QUEUE ==========
CREATE TABLE public.job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type public.job_type NOT NULL,
  status public.job_status NOT NULL DEFAULT 'PENDING',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_queue_pending_idx ON public.job_queue(status, scheduled_for) WHERE status = 'PENDING';
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view jobs" ON public.job_queue FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER job_queue_touch BEFORE UPDATE ON public.job_queue FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ========== SPIH IMPORTS ==========
CREATE TABLE public.spih_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  total_rows int NOT NULL DEFAULT 0,
  matched_rows int NOT NULL DEFAULT 0,
  unmatched_rows int NOT NULL DEFAULT 0,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.spih_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage imports" ON public.spih_imports FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== RATE SNAPSHOTS ==========
CREATE TABLE public.rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_rate numeric(10, 4) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rate_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read rates" ON public.rate_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins write rates" ON public.rate_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== AUTO-CREATE CUSTOMER + ROLE ON SIGNUP ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.customers (user_id, company_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'company_name', 'Unnamed Company'),
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== REALTIME for orders ==========
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

-- ========== SEED initial spot rate + treasury wallet placeholder ==========
INSERT INTO public.rate_snapshots (spot_rate, source) VALUES (130.0000, 'seed');
INSERT INTO public.wallets (wallet_type, stellar_address, label, usdc_balance)
  VALUES ('TREASURY', 'GTREASURY_PLACEHOLDER_REPLACE_ME', 'Theo Treasury', 0);