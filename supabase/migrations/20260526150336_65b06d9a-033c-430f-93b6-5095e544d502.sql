-- 1. Replace duplicate inline admin check on wallets with has_role() helper
DROP POLICY IF EXISTS "wallets_admin_select_all" ON public.wallets;

-- 2. Allow KYB document owners to delete their own files
DROP POLICY IF EXISTS "Customers delete own kyb documents" ON storage.objects;
CREATE POLICY "Customers delete own kyb documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'kyb-documents'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);