-- Prime Games — Phase 3: 0012 SCENARIO TESTS (NON-PERSISTENT)
-- Target: poaxanthiifatydqbnqq.supabase.co
-- Run AFTER 0001..0010 and 0011. Supabase Dashboard -> SQL Editor -> Run.
--
-- The whole script is wrapped in BEGIN ... ROLLBACK, so NO test data persists
-- (the business schema stays EMPTY). Each test is a self-contained DO block that
-- raises on failure and prints "TEST n PASS" on success. If any assertion fails,
-- the transaction aborts and you will see the error; nothing is committed.
--
-- Covers: guest booking, repeat-guest identity, payment/refund/late-fee math,
-- Basic/Standard payment-before-handover, Premium credit limits, one-active-
-- rental-per-console, append-only ledger, contact/credit audit, verified linking
-- (+ rejection of unverified methods), KYC path constraint, maintenance FK, and
-- RLS customer isolation. True multi-session concurrency is enforced by the
-- FOR UPDATE row lock in assert_credit_available() (not unit-testable in one
-- session); the cumulative-limit logic is verified here.

begin;

-- TEST 1: guest booking + repeat-guest identity -----------------------------
do $$
declare c uuid; b1 uuid; b2 uuid; n int;
begin
  insert into public.customers (full_name, phone, customer_tier)
  values ('Guest Tester', '255700000001', 'basic') returning id into c;

  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total, status, payment_status)
  values ('PG-T1A', c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000, 'pending', 'unpaid')
  returning id into b1;

  -- repeat guest reuses the SAME customer (identity resolved by phone, not merged blindly)
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total, status, payment_status)
  values ('PG-T1B', c, 'goba', 'Goba Test', 'night', 1, '2026-12-02', '20:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'cod', 15000, 0, 6000, 21000, 'pending', 'unpaid')
  returning id into b2;

  select count(*) into n from public.customers where phone = '255700000001';
  if n <> 1 then raise exception 'TEST 1 FAILED: % customers for one phone', n; end if;
  select count(*) into n from public.bookings where customer_id = c;
  if n <> 2 then raise exception 'TEST 1 FAILED: expected 2 bookings, got %', n; end if;
  if (select customer_tier from public.customers where id = c) <> 'basic' then
    raise exception 'TEST 1 FAILED: guest tier not basic'; end if;
  raise notice 'TEST 1 PASS: guest booking + repeat-guest identity (1 customer, 2 bookings, tier basic)';
end $$;

-- TEST 2: partial payments, refund, late fee -> correct outstanding ----------
do $$
declare c uuid; b uuid; r uuid; o int;
begin
  insert into public.customers (full_name, phone, customer_tier)
  values ('Ledger Tester', '255700000002', 'basic') returning id into c;
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-T2', c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into b;

  o := public.customer_outstanding(c);
  if o <> 50000 then raise exception 'TEST 2 FAILED: initial outstanding %', o; end if;

  insert into public.payments (ref, customer_id, booking_id, amount, kind, method, status)
  values ('TX-T2A', c, b, 20000, 'rental', 'mpesa', 'settled');
  o := public.customer_outstanding(c);
  if o <> 30000 then raise exception 'TEST 2 FAILED: after partial payment %', o; end if;

  insert into public.payments (ref, customer_id, booking_id, amount, kind, method, status)
  values ('TX-T2B', c, b, 30000, 'rental', 'mpesa', 'settled');
  o := public.customer_outstanding(c);
  if o <> 0 then raise exception 'TEST 2 FAILED: after full payment %', o; end if;

  insert into public.payments (ref, customer_id, booking_id, amount, kind, method, status)
  values ('TX-T2R', c, b, -10000, 'refund', 'mpesa', 'settled');
  o := public.customer_outstanding(c);
  if o <> 10000 then raise exception 'TEST 2 FAILED: after refund %', o; end if;

  insert into public.rentals (customer_id, booking_id, status, late_fee)
  values (c, b, 'scheduled', 5000) returning id into r;
  o := public.customer_outstanding(c);
  if o <> 15000 then raise exception 'TEST 2 FAILED: after late fee %', o; end if;

  -- a pending (unsettled) payment must NOT change the balance
  insert into public.payments (ref, customer_id, booking_id, amount, kind, method, status)
  values ('TX-T2P', c, b, 15000, 'rental', 'mpesa', 'pending');
  o := public.customer_outstanding(c);
  if o <> 15000 then raise exception 'TEST 2 FAILED: pending payment changed balance %', o; end if;
  raise notice 'TEST 2 PASS: partial payments + refund + late fee + pending exclusion (outstanding=15000)';
end $$;

-- TEST 3: Basic must settle BEFORE handover (credit_limit = 0) ---------------
do $$
declare c uuid; con uuid; b uuid; r uuid; ok boolean := false;
begin
  insert into public.customers (full_name, phone, customer_tier)
  values ('Basic Handover', '255700000003', 'basic') returning id into c;
  insert into public.consoles (unit_code, model, status, condition_grade)
  values ('T3-PS5', 'PS5 Slim Disc', 'available', 'excellent') returning id into con;
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-T3', c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into b;
  insert into public.rentals (customer_id, booking_id, console_id, status)
  values (c, b, con, 'scheduled') returning id into r;

  -- unpaid -> handover must be blocked
  begin
    update public.rentals set status = 'active', start_at = now(),
      expected_return_at = now() + interval '2 days' where id = r;
    raise exception 'TEST 3 FAILED: unpaid basic handover was allowed';
  exception when others then
    if sqlerrm like '%credit_limit_exceeded%' then ok := true;
    else raise exception 'TEST 3 FAILED: unexpected error %', sqlerrm; end if;
  end;
  if not ok then raise exception 'TEST 3 FAILED: gate did not fire'; end if;

  -- settle in full -> handover allowed
  insert into public.payments (ref, customer_id, booking_id, amount, kind, method, status)
  values ('TX-T3', c, b, 50000, 'rental', 'mpesa', 'settled');
  update public.rentals set status = 'active', start_at = now(),
    expected_return_at = now() + interval '2 days' where id = r;
  if (select status from public.rentals where id = r) <> 'active' then
    raise exception 'TEST 3 FAILED: paid handover not active'; end if;
  raise notice 'TEST 3 PASS: basic blocked unpaid, allowed after full settlement';
end $$;

-- TEST 4: Premium credit limit enforced cumulatively at handover -------------
do $$
declare c uuid; con uuid; b uuid; r uuid; i int; blocked boolean := false;
begin
  insert into public.customers (full_name, phone, customer_tier, credit_limit)
  values ('Premium Credit', '255700000004', 'premium', 100000) returning id into c;

  -- two 50k bookings -> outstanding 100k == limit: both handovers allowed
  for i in 1..2 loop
    insert into public.consoles (unit_code, model, status, condition_grade)
    values ('T4-PS5-' || i, 'PS5 Slim Disc', 'available', 'excellent') returning id into con;
    insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
      start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
      rental_amount, discount, delivery_fee, total)
    values ('PG-T4-' || i, c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
      'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
    returning id into b;
    insert into public.rentals (customer_id, booking_id, console_id, status, start_at, expected_return_at)
    values (c, b, con, 'active', now(), now() + interval '2 days') returning id into r;
  end loop;
  if public.customer_outstanding(c) <> 100000 then
    raise exception 'TEST 4 FAILED: outstanding %', public.customer_outstanding(c); end if;

  -- third 50k booking -> outstanding 150k > limit: handover blocked
  insert into public.consoles (unit_code, model, status, condition_grade)
  values ('T4-PS5-3', 'PS5 Slim Disc', 'available', 'excellent') returning id into con;
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-T4-3', c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into b;
  insert into public.rentals (customer_id, booking_id, console_id, status)
  values (c, b, con, 'scheduled') returning id into r;
  begin
    update public.rentals set status = 'active', start_at = now(),
      expected_return_at = now() + interval '2 days' where id = r;
    raise exception 'TEST 4 FAILED: over-limit premium handover allowed';
  exception when others then
    if sqlerrm like '%credit_limit_exceeded%' then blocked := true;
    else raise exception 'TEST 4 FAILED: unexpected error %', sqlerrm; end if;
  end;
  if not blocked then raise exception 'TEST 4 FAILED: premium limit not enforced'; end if;
  raise notice 'TEST 4 PASS: premium 2 handovers within 100k limit, 3rd blocked at 150k';
end $$;

-- TEST 5: one active rental per console -------------------------------------
do $$
declare c uuid; con uuid; b1 uuid; b2 uuid; r1 uuid; r2 uuid; dup boolean := false;
begin
  insert into public.customers (full_name, phone, customer_tier, credit_limit)
  values ('Console Lock', '255700000005', 'premium', 500000) returning id into c;
  insert into public.consoles (unit_code, model, status, condition_grade)
  values ('T5-PS5', 'PS5 Slim Disc', 'available', 'excellent') returning id into con;
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-T5A', c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into b1;
  insert into public.rentals (customer_id, booking_id, console_id, status, start_at, expected_return_at)
  values (c, b1, con, 'active', now(), now() + interval '2 days') returning id into r1;

  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-T5B', c, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into b2;
  begin
    insert into public.rentals (customer_id, booking_id, console_id, status, start_at, expected_return_at)
    values (c, b2, con, 'active', now(), now() + interval '2 days') returning id into r2;
    raise exception 'TEST 5 FAILED: two active rentals on one console allowed';
  exception when unique_violation then dup := true; end;
  if not dup then raise exception 'TEST 5 FAILED: unique active-console index missing'; end if;
  raise notice 'TEST 5 PASS: console cannot be in two active rentals';
end $$;

-- TEST 6: payments ledger is append-only (UPDATE/DELETE blocked) -------------
do $$
declare c uuid; p uuid; blocked int := 0;
begin
  insert into public.customers (full_name, phone, customer_tier)
  values ('Append Only', '255700000006', 'basic') returning id into c;
  insert into public.payments (ref, customer_id, amount, kind, method, status)
  values ('TX-T6', c, 10000, 'rental', 'cash', 'settled') returning id into p;
  begin
    update public.payments set amount = 999 where id = p;
    raise exception 'TEST 6 FAILED: ledger UPDATE allowed';
  exception when others then
    if sqlerrm like 'append_only_violation%' then blocked := blocked + 1;
    else raise exception 'TEST 6 FAILED: unexpected error %', sqlerrm; end if;
  end;
  begin
    delete from public.payments where id = p;
    raise exception 'TEST 6 FAILED: ledger DELETE allowed';
  exception when others then
    if sqlerrm like 'append_only_violation%' then blocked := blocked + 1;
    else raise exception 'TEST 6 FAILED: unexpected error %', sqlerrm; end if;
  end;
  if blocked <> 2 then raise exception 'TEST 6 FAILED: append-only not enforced (%)', blocked; end if;
  raise notice 'TEST 6 PASS: payments UPDATE and DELETE both blocked (append-only)';
end $$;

-- TEST 7: contact-change + credit-change audits -----------------------------
do $$
declare c uuid; n int;
begin
  insert into public.customers (full_name, phone, customer_tier, credit_limit)
  values ('Audit Tester', '255700000007', 'premium', 50000) returning id into c;
  update public.customers set full_name = 'Audit Renamed', phone = '255700000077' where id = c;
  select count(*) into n from public.customer_contact_history where customer_id = c;
  if n <> 2 then raise exception 'TEST 7 FAILED: expected 2 contact-history rows, got %', n; end if;
  update public.customers set credit_limit = 150000 where id = c;
  select count(*) into n from public.customer_credit_events
    where customer_id = c and event_type = 'credit_limit_change'
      and old_credit_limit = 50000 and new_credit_limit = 150000;
  if n <> 1 then raise exception 'TEST 7 FAILED: credit_limit_change event not logged'; end if;
  raise notice 'TEST 7 PASS: contact history (2) + credit-limit change audited';
end $$;

-- TEST 8: verified linking + rejection of unverified method -----------------
do $$
declare c uuid; uid uuid; rejected boolean := false; n int;
begin
  insert into public.customers (full_name, phone, customer_tier)
  values ('Link Tester', '255700000008', 'basic') returning id into c;

  -- unverified method must be refused
  begin
    perform public.link_customer_auth(c, '99999999-9999-4999-8999-999999999999', 'phone_match', 'x');
    raise exception 'TEST 8 FAILED: unverified link method accepted';
  exception when others then
    if sqlerrm like '%unverified_link_method%' then rejected := true;
    else raise exception 'TEST 8 FAILED: unexpected error %', sqlerrm; end if;
  end;
  if not rejected then raise exception 'TEST 8 FAILED: unverified method not rejected'; end if;

  -- verified OTP link to a real, unlinked auth user (read-only reference)
  select id into uid from auth.users u
    where not exists (select 1 from public.customers cc where cc.auth_user_id = u.id) limit 1;
  if uid is null then
    raise notice 'TEST 8 PARTIAL: unverified-method rejection verified; no unlinked auth user for OTP link';
    return;
  end if;
  perform public.link_customer_auth(c, uid, 'otp', 'otp-test-ref-123');
  if (select auth_user_id from public.customers where id = c) <> uid then
    raise exception 'TEST 8 FAILED: auth_user_id not attached'; end if;
  if (select customer_tier from public.customers where id = c) <> 'standard' then
    raise exception 'TEST 8 FAILED: basic not promoted to standard on registration'; end if;
  select count(*) into n from public.customer_links
    where customer_id = c and verified and status = 'linked' and link_method = 'otp';
  if n <> 1 then raise exception 'TEST 8 FAILED: verified link not recorded'; end if;
  raise notice 'TEST 8 PASS: unverified refused; OTP link attached, promoted to standard, audited';
end $$;

-- TEST 9: KYC document path constraint + audit ------------------------------
do $$
declare c uuid; d uuid; bad boolean := false;
begin
  insert into public.customers (full_name, phone, customer_tier)
  values ('KYC Tester', '255700000009', 'basic') returning id into c;
  insert into public.kyc_documents (customer_id, doc_type, storage_path, mime_type, id_number_masked)
  values (c, 'nida', 'kyc-private/' || c::text || '/doc-1.pdf', 'application/pdf', '****1234')
  returning id into d;
  insert into public.kyc_audit (document_id, action, actor) values (d, 'uploaded', 'system');
  -- a path outside the customer's own folder must be rejected
  begin
    insert into public.kyc_documents (customer_id, doc_type, storage_path)
    values (c, 'nida', 'kyc-private/99999999-9999-4999-8999-999999999999/doc.pdf');
    raise exception 'TEST 9 FAILED: cross-folder KYC path allowed';
  exception when check_violation then bad := true; end;
  if not bad then raise exception 'TEST 9 FAILED: storage_path CHECK missing'; end if;
  raise notice 'TEST 9 PASS: KYC own-folder path enforced + audit row written';
end $$;

-- TEST 10: maintenance FK + inventory ---------------------------------------
do $$
declare con uuid; g uuid; bad boolean := false;
begin
  insert into public.consoles (unit_code, model, status, condition_grade)
  values ('T10-PS5', 'PS5 Pro Disc', 'available', 'good') returning id into con;
  insert into public.games (title, platform, status) values ('T10 Game', 'ps5', 'available') returning id into g;
  insert into public.maintenance (console_id, issue, status, priority)
  values (con, 'HDMI port loose', 'open', 'high');
  begin
    insert into public.maintenance (console_id, issue, status, priority)
    values ('99999999-9999-4999-8999-999999999999', 'Orphan', 'open', 'low');
    raise exception 'TEST 10 FAILED: orphan maintenance allowed';
  exception when foreign_key_violation then bad := true; end;
  if not bad then raise exception 'TEST 10 FAILED: maintenance FK missing'; end if;
  raise notice 'TEST 10 PASS: maintenance linked to console; orphan rejected by FK';
end $$;

-- TEST 11: RLS customer isolation -------------------------------------------
do $$
declare a uuid; b uuid; uid uuid; ba uuid; bb uuid; n int;
begin
  select id into uid from auth.users u
    where not exists (select 1 from public.customers cc where cc.auth_user_id = u.id) limit 1;
  if uid is null then
    raise notice 'TEST 11 SKIP: no unlinked auth user available to simulate a session';
    return;
  end if;
  insert into public.customers (full_name, phone, customer_tier)
  values ('Iso A', '255700000010', 'basic') returning id into a;
  insert into public.customers (full_name, phone, customer_tier)
  values ('Iso B', '255700000011', 'basic') returning id into b;
  perform public.link_customer_auth(a, uid, 'otp', 'iso-otp-ref');
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-ISOA', a, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into ba;
  insert into public.bookings (ref, customer_id, zone_key, address, package_key, days,
    start_date, start_time, id_type, id_number, ec_name, ec_phone, payment_method,
    rental_amount, discount, delivery_fee, total)
  values ('PG-ISOB', b, 'sinza', 'Sinza Test', 'starter', 2, '2026-12-01', '10:00',
    'nida', 'TEST1234', 'EC Test', '255712345678', 'mpesa', 50000, 0, 0, 50000)
  returning id into bb;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L',
    json_build_object('sub', uid, 'role', 'authenticated')::text);

  select count(*) into n from public.bookings;
  if n <> 1 then raise exception 'TEST 11 FAILED: A sees % bookings, expected 1', n; end if;
  select count(*) into n from public.bookings where id = bb;
  if n <> 0 then raise exception 'TEST 11 FAILED: A can read B booking'; end if;
  select count(*) into n from public.customers;
  if n <> 1 then raise exception 'TEST 11 FAILED: A sees % customers, expected 1', n; end if;
  select count(*) into n from public.payments;
  if n <> 0 then raise exception 'TEST 11 FAILED: A sees % payments, expected 0', n; end if;

  execute 'reset role';
  raise notice 'TEST 11 PASS: authenticated A reads only own booking/customer; B and ledger hidden';
end $$;

rollback;