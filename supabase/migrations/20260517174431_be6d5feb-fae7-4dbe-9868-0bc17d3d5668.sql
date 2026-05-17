DROP TRIGGER IF EXISTS customers_protect ON public.customers;
DROP TRIGGER IF EXISTS protect_customer_fields_trigger ON public.customers;

UPDATE public.customers
SET kyb_status = 'APPROVED',
    kyb_submitted_at = now()
WHERE id = '5df8cecc-c953-4782-a994-35c36f58470b';

CREATE TRIGGER customers_protect
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION protect_customer_fields();

CREATE TRIGGER protect_customer_fields_trigger
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION protect_customer_fields();