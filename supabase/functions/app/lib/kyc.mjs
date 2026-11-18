// KYC operations. The legacy masked-ID + WhatsApp verification flow is preserved
// on profiles (the portal writes it directly). This adds the Phase 3 private
// document subsystem: signed upload/download URLs in the kyc-private bucket,
// kyc_documents rows (masked numbers only) and the kyc_audit log.
import { KYC_DOC_TYPES, KYC_ACTIONS } from "./core.mjs";
import { getCustomerByAuth } from "./customers.mjs";

const ALLOWED_MIME = ["image/jpeg", "image/png", "application/pdf"];
const BUCKET = "kyc-private";
const maskId = (n) => `••••${String(n).trim().slice(-4)}`;

async function memberCustomer(supabase, user) {
  const customer = await getCustomerByAuth(supabase, user.sub);
  if (!customer) return null;
  return customer;
}

// Masked-ID submission (no document). Mirrors the portal's profiles write so the
// backend can also drive it; keeps kyc_status pending until admin verification.
export async function submitKyc(supabase, user, { id_type, id_number }) {
  if (!KYC_DOC_TYPES.includes(id_type) || !["nida", "licence", "passport"].includes(id_type)) {
    return { error: "invalid_input", status: 400 };
  }
  if (typeof id_number !== "string" || id_number.trim().length < 4) return { error: "invalid_input", status: 400 };
  const customer = await memberCustomer(supabase, user);
  if (!customer) return { error: "customer_not_found", status: 404 };
  const masked = maskId(id_number);
  const { error } = await supabase.from("profiles").update({
    kyc_status: "pending", kyc_id_type: id_type, kyc_id_masked: masked,
  }).eq("id", user.sub);
  if (error) return { error: "database_request_failed", status: 503 };
  return { ok: true, kyc_status: "pending", kyc_id_type: id_type, kyc_id_masked: masked };
}

// Issue a short-lived signed upload URL into the customer's own private folder.
export async function createKycUploadUrl(supabase, user, { doc_type, mime_type }) {
  if (!KYC_DOC_TYPES.includes(doc_type)) return { error: "invalid_input", status: 400 };
  if (!ALLOWED_MIME.includes(mime_type)) return { error: "invalid_input", status: 400 };
  const customer = await memberCustomer(supabase, user);
  if (!customer) return { error: "customer_not_found", status: 404 };
  const objectName = `${customer.id}/${crypto.randomUUID()}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(objectName);
  if (error || !data) return { error: "storage_unavailable", status: 503 };
  return {
    ok: true,
    bucket: BUCKET,
    path: objectName,
    storage_path: `${BUCKET}/${objectName}`,
    upload_url: data.signedUrl,
    token: data.token,
    doc_type,
    mime_type,
  };
}

// Register an uploaded document (after the client PUTs to the signed URL).
export async function registerKycDocument(supabase, user, input) {
  const customer = await memberCustomer(supabase, user);
  if (!customer) return { error: "customer_not_found", status: 404 };
  const storagePath = input.storage_path;
  const expectedPrefix = `${BUCKET}/${customer.id}/`;
  if (typeof storagePath !== "string" || !storagePath.startsWith(expectedPrefix) || storagePath.slice(expectedPrefix.length).includes("/")) {
    return { error: "invalid_input", status: 400 };
  }
  if (!KYC_DOC_TYPES.includes(input.doc_type)) return { error: "invalid_input", status: 400 };
  if (input.mime_type != null && !ALLOWED_MIME.includes(input.mime_type)) return { error: "invalid_input", status: 400 };
  const row = {
    id: crypto.randomUUID(),
    customer_id: customer.id,
    doc_type: input.doc_type,
    storage_path: storagePath,
    file_name: typeof input.file_name === "string" ? input.file_name.slice(0, 200) : null,
    mime_type: input.mime_type ?? null,
    size_bytes: Number.isInteger(input.size_bytes) && input.size_bytes >= 0 ? input.size_bytes : null,
    id_number_masked: typeof input.id_number === "string" && input.id_number.trim().length >= 4 ? maskId(input.id_number) : null,
    verification_status: "pending",
  };
  const { data, error } = await supabase.from("kyc_documents").insert(row).select("*").single();
  if (error || !data) return { error: error?.code === "23505" ? "duplicate_document" : "database_request_failed", status: error?.code === "23505" ? 409 : 503 };
  await supabase.from("kyc_audit").insert({
    id: crypto.randomUUID(), document_id: data.id, action: "uploaded", actor: `customer:${customer.id}`, detail: null,
  });
  await supabase.from("profiles").update({ kyc_status: "pending" }).eq("id", user.sub);
  return { ok: true, document: data };
}

// Admin verifies/rejects a customer's KYC (optionally a specific document).
export async function adminVerifyKyc(supabase, input) {
  const decision = input.decision;
  if (!["verified", "rejected"].includes(decision)) return { error: "invalid_input", status: 400 };
  const actor = input.verified_by ?? "admin";
  let customer = null;
  if (input.document_id) {
    const { data: doc, error } = await supabase.from("kyc_documents").select("*").eq("id", input.document_id).maybeSingle();
    if (error) throw new Error("database_request_failed");
    if (!doc) return { error: "not_found", status: 404 };
    const patch = decision === "verified"
      ? { verification_status: "verified", verified_by: actor, verified_at: new Date().toISOString(), rejection_reason: null }
      : { verification_status: "rejected", rejection_reason: input.reason ?? null, verified_by: actor, verified_at: new Date().toISOString() };
    const { data: updated, error: upErr } = await supabase.from("kyc_documents").update(patch).eq("id", doc.id).select("*").maybeSingle();
    if (upErr) throw new Error("database_request_failed");
    await supabase.from("kyc_audit").insert({
      id: crypto.randomUUID(), document_id: doc.id, action: decision === "verified" ? "verified" : "rejected", actor, detail: input.reason ?? null,
    });
    const { data: c } = await supabase.from("customers").select("*").eq("id", doc.customer_id).maybeSingle();
    customer = c ?? null;
  } else if (input.customer_id) {
    const { data: c, error } = await supabase.from("customers").select("*").eq("id", input.customer_id).maybeSingle();
    if (error) throw new Error("database_request_failed");
    if (!c) return { error: "not_found", status: 404 };
    customer = c;
  } else {
    return { error: "invalid_input", status: 400 };
  }
  // Reflect the decision on the legacy profile so the portal shows it (members only).
  if (customer?.auth_user_id) {
    await supabase.from("profiles").update({ kyc_status: decision === "verified" ? "verified" : "none" })
      .eq("id", customer.auth_user_id);
  }
  return { ok: true, kyc_status: decision, customer_id: customer?.id ?? null };
}

// Admin short-lived signed download URL for a private document (audited as viewed).
export async function adminKycDownloadUrl(supabase, documentId) {
  const { data: doc, error } = await supabase.from("kyc_documents").select("*").eq("id", documentId).maybeSingle();
  if (error) throw new Error("database_request_failed");
  if (!doc) return { error: "not_found", status: 404 };
  const objectName = doc.storage_path.replace(/^kyc-private\//, "");
  const { data, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(objectName, 300);
  if (sErr || !data) return { error: "storage_unavailable", status: 503 };
  await supabase.from("kyc_audit").insert({
    id: crypto.randomUUID(), document_id: doc.id, action: "viewed", actor: "admin", detail: null,
  });
  return { ok: true, url: data.signedUrl, expires_in: 300 };
}

export async function listKycDocuments(supabase, rows) {
  if (rows.length === 0) return [];
  const { mapById } = await import("./mapping.mjs");
  const customers = await mapById(supabase, "customers", rows.map((d) => d.customer_id), "id,full_name,phone");
  return rows.map((d) => ({
    ...d,
    customer_name: customers.get(d.customer_id)?.full_name ?? "",
    customer_phone: customers.get(d.customer_id)?.phone ?? null,
  }));
}

export { KYC_ACTIONS };