UPDATE public.customers
SET kyb_status = 'APPROVED',
    kyb_submitted_at = now()
WHERE id = '5df8cecc-c953-4782-a994-35c36f58470b';