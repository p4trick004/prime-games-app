import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCustomer } from "../lib/customer";
import { buildRecordsBundle, historyFilename, TABLE_ORDER, type AccountInfo } from "../lib/records";
import { PDF_MIME, saveFile } from "../lib/download";
import type { Booking } from "../lib/bookings";
import type { Rental } from "../lib/rentals";
import type { PaymentItem } from "../lib/payments";

export function MyRecords() {
  const { profile, session, accessToken } = useAuth();
  const { customer } = useCustomer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const name = customer?.full_name ?? profile?.full_name ?? session?.user.email ?? "Customer";

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Please sign in again to download your history.");
      // The history endpoints scope every row to the JWT subject on the server;
      // no customer id is sent from the browser.
      const [b, r, p] = await Promise.all([
        api<{ items: Booking[] }>("my_bookings", { token }),
        api<{ items: Rental[] }>("my_rentals", { token }),
        api<{ items: PaymentItem[]; outstanding: number | null }>("my_payments", { token }),
      ]);
      const account: AccountInfo = {
        name,
        email: customer?.email ?? profile?.email ?? session?.user.email ?? null,
        phone: customer?.phone ?? profile?.phone ?? null,
        tier: customer?.customer_tier ?? profile?.tier ?? "standard",
        memberSince: customer?.created_at ?? profile?.created_at ?? null,
        creditLimit: customer?.customer_tier === "premium" ? customer.credit_limit : null,
      };
      const bundle = buildRecordsBundle({
        account,
        bookings: b.items,
        rentals: r.items,
        payments: p.items,
        outstanding: p.outstanding,
      });
      const filename = historyFilename(account.name, bundle.generatedAt);
      const { renderStatementPdf } = await import("../lib/pdf");
      saveFile(filename, PDF_MIME, renderStatementPdf(
        TABLE_ORDER.map((kind) => bundle.tables[kind]),
        { customerName: account.name, generatedAt: bundle.generatedAt },
      ));
      setNote(`Downloaded ${filename}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare your history. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card records" aria-labelledby="records-title">
      <div className="records-head">
        <div>
          <h3 id="records-title">My records</h3>
          <p>
            One PDF with your full account history: bookings, rentals, payments and a spending summary.
            It contains only records on your account.
          </p>
        </div>
      </div>

      <div className="records-foot">
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing…" : "Download Complete History"}
        </button>
      </div>

      <p className="records-note">
        The document is generated from your account records at the moment you download it.
      </p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {note ? <p className="records-ok" role="status">{note}</p> : null}
    </section>
  );
}
