// Customer identity: resolution, registration, profiles<->customers sync, and
// verified guest->account linking. Implements README §3/§7.1/§7.4.
//
// Model: a person has ONE customers row. Guests have auth_user_id NULL (basic);
// members have auth_user_id set (standard/premium). Linking attaches the auth user
// to the EXISTING guest customer (preserving its bookings/rentals/ledger history),
// never merging two customers and never using unverified contact details.
import { normalizePhone } from "./core.mjs";

export async function getProfile(supabase, userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error("database_request_failed");
  return data ?? null;
}

export async function getCustomerByAuth(supabase, userId) {
  const { data, error } = await supabase.from("customers").select("*").eq("auth_user_id", userId).maybeSingle();
  if (error) throw new Error("database_request_failed");
  return data ?? null;
}

// Oldest guest customer sharing this (unverified) phone, or null. Registered
// customers are excluded so a guest booking never attaches to a member by phone.
export async function findGuestByPhone(supabase, phone) {
  if (!phone) return null;
  const { data, error } = await supabase.from("customers").select("*")
    .eq("phone", phone).order("created_at", { ascending: true });
  if (error || !Array.isArray(data)) throw new Error("database_request_failed");
  return data.find((c) => c.auth_user_id === null) ?? null;
}

// Resolve (or create) the guest customer for a booking. Guests book indefinitely
// without an account; reuse the existing guest identity by normalized phone.
export async function resolveGuestCustomer(supabase, { phone, name }) {
  const existing = await findGuestByPhone(supabase, phone);
  if (existing) {
    if (name && existing.full_name !== name) {
      const { data, error } = await supabase.from("customers").update({ full_name: name })
        .eq("id", existing.id).select("*").maybeSingle();
      if (!error && data) return data;
    }
    return existing;
  }
  const row = {
    id: crypto.randomUUID(),
    auth_user_id: null,
    full_name: name,
    phone,
    email: null,
    customer_tier: "basic",
    credit_limit: 0,
    customer_status: "active",
  };
  const { data, error } = await supabase.from("customers").insert(row).select("*").single();
  if (error || !data) throw new Error("database_request_failed");
  return data;
}

// Copy current profile contact details into the customer row (audited by the
// customers_log_contact_change trigger). Only writes when something changed.
export async function syncCustomerFromProfile(supabase, customer, profile) {
  if (!customer || !profile) return customer;
  const patch = {};
  const name = typeof profile.full_name === "string" ? profile.full_name.trim() : null;
  const phone = normalizePhone(profile.phone);
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : null;
  if (name && name !== customer.full_name) patch.full_name = name;
  if (phone && phone !== customer.phone) patch.phone = phone;
  if (email && email !== customer.email) patch.email = email;
  if (Object.keys(patch).length === 0) return customer;
  const { data, error } = await supabase.from("customers").update(patch).eq("id", customer.id).select("*").maybeSingle();
  if (error || !data) return customer;
  return data;
}

// Create a standard customer for a member that has none (no guest history to claim).
async function createMemberCustomer(supabase, userId, profile, fallback) {
  const phone = normalizePhone(profile?.phone) ?? fallback?.phone ?? null;
  const name = (profile?.full_name && String(profile.full_name).trim()) || fallback?.name || "Member";
  const email = profile?.email ? String(profile.email).trim().toLowerCase() : null;
  const row = {
    id: crypto.randomUUID(),
    auth_user_id: userId,
    full_name: name.slice(0, 120),
    phone,
    email,
    email_verified_at: new Date().toISOString(), // Supabase Auth email confirmation
    customer_tier: "standard",
    credit_limit: 0,
    customer_status: "active",
  };
  const { data, error } = await supabase.from("customers").insert(row).select("*").single();
  if (error || !data) throw new Error("database_request_failed");
  return data;
}

// Member booking path: ensure the auth user has a customer, syncing profile data.
export async function resolveMemberCustomer(supabase, user, fallback) {
  const existing = await getCustomerByAuth(supabase, user.sub);
  const profile = await getProfile(supabase, user.sub);
  if (existing) return await syncCustomerFromProfile(supabase, existing, profile);
  return await createMemberCustomer(supabase, user.sub, profile, fallback);
}

// Registration orchestration. If a guest customer already exists for the member's
// phone, DO NOT create a separate customer (that would block history-preserving
// linking and risk an unverified merge). Instead record a pending verified-link
// request; the guest customer becomes the member customer once admin/OTP verifies.
export async function registerCustomer(supabase, user) {
  const existing = await getCustomerByAuth(supabase, user.sub);
  const profile = await getProfile(supabase, user.sub);
  if (existing) {
    const synced = await syncCustomerFromProfile(supabase, existing, profile);
    return { customer: synced, link_pending: false };
  }
  const phone = normalizePhone(profile?.phone);
  const guest = phone ? await findGuestByPhone(supabase, phone) : null;
  if (guest) {
    const link = await createLinkRequest(supabase, guest.id, user.sub, "registration request");
    return { customer: null, link_pending: true, link_id: link.id, guest_customer_id: guest.id };
  }
  const customer = await createMemberCustomer(supabase, user.sub, profile, null);
  return { customer, link_pending: false };
}

async function createLinkRequest(supabase, customerId, authUserId, evidence) {
  const row = {
    id: crypto.randomUUID(),
    customer_id: customerId,
    auth_user_id: authUserId,
    link_method: "admin_assisted",
    verified: false,
    evidence,
    status: "pending",
  };
  const { data, error } = await supabase.from("customer_links").insert(row).select("*").single();
  if (error || !data) throw new Error("database_request_failed");
  return data;
}

// Member explicitly claims a guest identity (e.g. a different phone than profile).
export async function requestGuestLink(supabase, user, rawPhone) {
  const existing = await getCustomerByAuth(supabase, user.sub);
  if (existing) return { error: "already_linked", status: 409 };
  const phone = normalizePhone(rawPhone);
  if (!phone) return { error: "invalid_input", status: 400 };
  const guest = await findGuestByPhone(supabase, phone);
  if (!guest) return { error: "guest_not_found", status: 404 };
  const link = await createLinkRequest(supabase, guest.id, user.sub, "member link request");
  return { ok: true, link_id: link.id, status: "pending_verification", guest_customer_id: guest.id };
}

// Admin approves a pending link after secure identity verification. Calls the
// SECURITY DEFINER link_customer_auth() which attaches auth to the guest customer,
// promotes basic->standard, and writes a verified 'linked' audit row.
export async function approveLink(supabase, linkId, evidence) {
  const { data: link, error } = await supabase.from("customer_links").select("*").eq("id", linkId).maybeSingle();
  if (error) throw new Error("database_request_failed");
  if (!link) return { error: "not_found", status: 404 };
  if (link.status !== "pending") return { error: "link_not_pending", status: 409 };
  if (typeof evidence !== "string" || evidence.trim().length < 3) return { error: "invalid_input", status: 400 };

  const { error: rpcErr } = await supabase.rpc("link_customer_auth", {
    p_customer_id: link.customer_id,
    p_auth_user_id: link.auth_user_id,
    p_method: "admin_assisted",
    p_evidence: evidence.trim(),
  });
  if (rpcErr) {
    const msg = String(rpcErr.message ?? "");
    if (msg.includes("auth_user_already_linked")) {
      await supabase.from("customer_links").update({ status: "conflict", resolved_at: new Date().toISOString() }).eq("id", linkId);
      return { error: "auth_user_already_linked", status: 409 };
    }
    if (msg.includes("customer_not_found")) return { error: "customer_not_found", status: 404 };
    return { error: "link_failed", status: 503 };
  }
  // Resolve the original request row (the RPC wrote the authoritative verified row).
  await supabase.from("customer_links").update({
    status: "linked", verified: true, evidence: evidence.trim(), resolved_at: new Date().toISOString(),
  }).eq("id", linkId);

  // Sync the legacy profile tier so the portal reflects the promoted membership.
  const { data: customer } = await supabase.from("customers").select("*").eq("id", link.customer_id).maybeSingle();
  if (customer?.auth_user_id) {
    await supabase.from("profiles").update({ tier: customer.customer_tier === "premium" ? "premium" : "standard" })
      .eq("id", customer.auth_user_id);
  }
  return { ok: true, customer_id: link.customer_id };
}

export async function rejectLink(supabase, linkId, reason) {
  const { data: link, error } = await supabase.from("customer_links").select("*").eq("id", linkId).maybeSingle();
  if (error) throw new Error("database_request_failed");
  if (!link) return { error: "not_found", status: 404 };
  if (link.status !== "pending") return { error: "link_not_pending", status: 409 };
  const { data, error: upErr } = await supabase.from("customer_links").update({
    status: "rejected", resolved_at: new Date().toISOString(), evidence: reason ?? link.evidence,
  }).eq("id", linkId).select("*").maybeSingle();
  if (upErr) throw new Error("database_request_failed");
  return { ok: true, item: data };
}