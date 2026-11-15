-- Prime Games — Phase 3 (customer-centred): 0008 KYC documents + audit
-- Target: poaxanthiifatydqbnqq.supabase.co (public). Idempotent + reversible.
-- Depends on: 0002_customers.sql. Storage bucket/policies are in 0009_storage.sql.
--
-- The legacy masked-ID + manual WhatsApp verification flow is PRESERVED (it lives
-- on profiles/customers). These tables add OPTIONAL private document uploads in
-- the restricted kyc-private bucket. Only MASKED id numbers are stored here —
-- never a full government ID number. Documents are soft-managed via
-- verification_status; kyc_audit is an append-only-by-policy log (service-role
-- only) so that GDPR account deletion can still cascade when required.

-- 1) kyc_documents ----------------------------------------------------------
create table if not exists public.kyc_documents (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null,
  doc_type            text not null,
  storage_path        text not null,
  file_name           text,
  mime_type           text,
  size_bytes          integer,
  id_number_masked    text,
  verification_status text not null default 'pending',
  verified_by         text,
  verified_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint kyc_documents_customer_id_fkey
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint kyc_documents_storage_path_key unique (storage_path),
  constraint kyc_documents_doc_type_check
    check (doc_type in ('nida', 'licence', 'passport', 'selfie', 'proof_of_address', 'other')),
  constraint kyc_documents_status_check
    check (verification_status in ('pending', 'verified', 'rejected', 'expired')),
  constraint kyc_documents_size_check check (size_bytes is null or size_bytes >= 0),
  constraint kyc_documents_mime_check
    check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  constraint kyc_documents_masked_check
    check (id_number_masked is null or char_length(id_number_masked) <= 32),
  -- Object must live in this customer's own private folder (matches Storage RLS).
  constraint kyc_documents_storage_path_check
    check (storage_path ~ ('^kyc-private/' || customer_id::text || '/[^/]+$'))
);

create index if not exists kyc_documents_customer_idx on public.kyc_documents (customer_id);
create index if not exists kyc_documents_status_idx   on public.kyc_documents (verification_status);

drop trigger if exists kyc_documents_set_updated_at on public.kyc_documents;
create trigger kyc_documents_set_updated_at
  before update on public.kyc_documents
  for each row execute function public.set_updated_at();

-- 2) kyc_audit — append-only-by-policy verification log ---------------------
-- detail holds non-sensitive context only (NO raw PII, IDs, or secrets).
create table if not exists public.kyc_audit (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  action      text not null,
  actor       text,
  detail      text,
  created_at  timestamptz not null default now(),
  constraint kyc_audit_document_id_fkey
    foreign key (document_id) references public.kyc_documents (id) on delete cascade,
  constraint kyc_audit_action_check
    check (action in ('uploaded', 'verified', 'rejected', 'expired', 'viewed'))
);

create index if not exists kyc_audit_document_idx on public.kyc_audit (document_id);
create index if not exists kyc_audit_created_idx  on public.kyc_audit (created_at);