import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useCustomer } from "../lib/customer";
import { useMyBookings, STATUS_LABEL } from "../lib/bookings";
import { useMyRentals, RENTAL_STATUS_LABEL, RENTAL_STATUS_TONE } from "../lib/rentals";
import { useMyPayments } from "../lib/payments";
import { PACKAGE_META } from "../lib/pricing";
import { fmtTZS, fmtDateShort, fmtTime } from "../lib/format";
import { fmtStamp } from "../lib/adminLabels";
import { WHATSAPP_NUMBER } from "../config";
import { StatCard, Badge, Countdown, Spinner, Empty, Ic } from "../components/ui";

const BOOKING_TONE = {
  pending: "gold", confirmed: "cyan", delivered: "green", completed: "gray", cancelled: "red",
} as const;

const PAYMENT_LABEL = { settled: "Paid", pending: "Pending", failed: "Failed", refunded: "Refunded" } as const;
const PAYMENT_TONE = { settled: "green", pending: "gold", failed: "red", refunded: "gray" } as const;

function pkgName(key: string | null | undefined): string {
  return key && key in PACKAGE_META ? PACKAGE_META[key as keyof typeof PACKAGE_META].name : "PS5 rental";
}

export function Dashboard() {
  const { profile } = useAuth();
  const { customer, linkPending } = useCustomer();
  const { bookings, error: bookingsError, reload: reloadBookings } = useMyBookings();
  const { rentals, error: rentalsError, reload: reloadRentals } = useMyRentals();
  const { payments, outstanding, error: paymentsError, reload: reloadPayments } = useMyPayments();

  if (!bookings || !rentals || !payments) return <Spinner />;

  const errors = [bookingsError, rentalsError, paymentsError].filter(Boolean);
  const activeRentals = rentals
    .filter((r) => r.status === "active" || r.status === "overdue")
    .sort((a, b) => (a.expected_return_at ?? "9999").localeCompare(b.expected_return_at ?? "9999"));
  const next = bookings
    .filter((b) => b.status === "pending" || b.status === "confirmed")
    .sort((a, b) => `${a.start_date}${a.start_time}`.localeCompare(`${b.start_date}${b.start_time}`))[0] ?? null;

  const bookedById = new Map(bookings.map((b) => [b.id, b]));
  const currentIds = new Set(activeRentals.map((r) => r.booking_id));
  if (next) currentIds.add(next.id);

  const debt = outstanding ?? 0;
  // Unpaid future bookings are commitments, not debt (Model C); they are
  // surfaced separately so nothing owed is ever hidden.
  const commitments = bookings.filter(
    (b) => b.payment_status === "unpaid" && (b.status === "pending" || b.status === "confirmed"),
  );
  const paidByBooking = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "settled" || !p.booking_id) continue;
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + p.amount);
  }
  const recent = payments.filter((p) => p.booking_id && currentIds.has(p.booking_id));
  const settled = debt <= 0 && commitments.length === 0;

  const premium = customer?.customer_tier === "premium" || (!customer && profile?.tier === "premium");
  const credit = customer?.credit_limit ?? 0;
  const firstName = (profile?.full_name ?? "Member").split(/\s+/)[0];
  const firstDue = activeRentals[0]?.expected_return_at ?? null;
  const soonest = activeRentals.find((r) => r.expected_return_at) ?? null;
  const soonestReturnAt = soonest?.expected_return_at ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            Welcome back, {firstName}{" "}
            {premium ? <Badge tone="gold">★ PREMIUM</Badge> : <Badge tone="cyan">STANDARD</Badge>}
          </h1>
          <p>Your current rentals, balance and next booking at a glance.</p>
        </div>
        <Link to="/browse" className="btn btn-primary"><Ic name="plus" size={15} /> Rent Now</Link>
      </div>

      {errors.length ? (
        <div className="banner warn">
          <span className="ico">!</span>
          <p className="grow">
            We couldn't refresh some of your details.{" "}
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => void Promise.all([reloadBookings(), reloadRentals(), reloadPayments()])}
            >
              Retry
            </button>
          </p>
        </div>
      ) : null}

      {linkPending ? (
        <div className="banner gold">
          <span className="ico">🔗</span>
          <p className="grow"><strong>Guest history link pending.</strong> We found bookings under your phone number — our team will verify and attach them to your account shortly.</p>
        </div>
      ) : null}

      {soonest && soonestReturnAt ? (
        <section className="card hero-countdown" aria-labelledby="countdown-title">
          <div className="hero-countdown-info">
            <span className="mini-label" id="countdown-title">Time remaining to return</span>
            <strong>
              {soonest.unit_code ?? pkgName(soonest.package_key)}{" "}
              <span className="mono cyan">{soonest.booking_ref ?? "—"}</span>
            </strong>
            <span className="hero-countdown-sub">
              Due back {fmtStamp(soonestReturnAt)}
              {activeRentals.length > 1 ? ` · ${activeRentals.length} consoles out — showing the next return` : ""}
            </span>
          </div>
          <Countdown to={new Date(soonestReturnAt)} />
        </section>
      ) : null}

      <div className="grid stats">
        <StatCard
          label="Active rentals"
          value={activeRentals.length}
          tone={activeRentals.length ? "cyan" : "gray"}
          sub={activeRentals.length ? `First due ${fmtStamp(firstDue)}` : "No console out with you"}
        />
        <StatCard
          label="Outstanding balance"
          value={fmtTZS(debt)}
          tone={debt > 0 ? "gold" : "green"}
          border={debt > 0 ? "gold" : "green"}
          sub={settled ? "All settled — nothing owed" : commitments.length ? `${commitments.length} unpaid upcoming booking${commitments.length === 1 ? "" : "s"}` : "Incurred balance to settle"}
        />
        <StatCard
          label="Next booking"
          value={next ? fmtDateShort(next.start_date) : "—"}
          tone={next ? "cyan" : "gray"}
          sub={next ? `${pkgName(next.package_key)} · ${fmtTime(next.start_time)}` : "Nothing scheduled"}
        />
        <StatCard
          label="Membership"
          value={premium ? "PREMIUM" : "STANDARD"}
          tone={premium ? "gold" : "cyan"}
          sub={premium ? `Credit limit ${fmtTZS(credit)}` : "Full payment before handover"}
        />
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <section aria-labelledby="current-rentals-title">
          <div className="section-head">
            <h2 id="current-rentals-title">Current rentals</h2>
            {activeRentals.length ? <Badge tone="cyan">{activeRentals.length} out</Badge> : null}
          </div>

          {activeRentals.length === 0 ? (
            <div className="card">
              <Empty title="No active rental right now">
                <p style={{ margin: "0 0 14px" }}>When a console is out with you, its return details and balance appear here.</p>
                <Link to="/browse" className="btn btn-primary btn-sm"><Ic name="plus" size={14} /> Rent Now</Link>
              </Empty>
            </div>
          ) : (
            <div className="dash-rentals">
              {activeRentals.map((rental) => {
                const booking = bookedById.get(rental.booking_id) ?? null;
                const balance = booking ? Math.max(0, booking.total - (paidByBooking.get(booking.id) ?? 0)) : 0;
                return (
                  <article className="card rental-card" key={rental.id} aria-label={`Rental ${rental.booking_ref ?? ""}`}>
                    <div className="rental-top">
                      <div>
                        <h3>
                          {rental.unit_code ?? pkgName(rental.package_key)}{" "}
                          <Badge tone={RENTAL_STATUS_TONE[rental.status]}>{RENTAL_STATUS_LABEL[rental.status].toUpperCase()}</Badge>
                        </h3>
                        <p className="rental-sub">
                          <span className="mono cyan">{rental.booking_ref ?? "—"}</span> · {pkgName(rental.package_key)} · out since {fmtStamp(rental.start_at)}
                        </p>
                      </div>
                    </div>

                    <div className="rental-grid">
                      <div>
                        <span className="mini-label">Due back</span>
                        <strong className="mono gold">{fmtStamp(rental.expected_return_at)}</strong>
                      </div>
                      <div>
                        <span className="mini-label">Booking total</span>
                        <strong className="mono">{booking ? fmtTZS(booking.total) : "—"}</strong>
                      </div>
                      <div>
                        <span className="mini-label">Outstanding balance</span>
                        {balance > 0 ? (
                          <Badge tone="gold">{fmtTZS(balance)} unpaid</Badge>
                        ) : (
                          <Badge tone="green">PAID</Badge>
                        )}
                      </div>
                    </div>

                    <p className="rental-note">
                      <strong>Return:</strong> our rider collects the console from your delivery address when your period ends.
                      {rental.status === "overdue" ? " This rental is overdue — late fees may apply." : ""}{" "}
                      <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener">Message us to extend.</a>
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="next-booking-title">
          <h3 id="next-booking-title">Next booking</h3>
          {next ? (
            <div className="next-booking">
              <div className="next-row">
                <span className="mono cyan">{next.ref}</span>
                <Badge tone={BOOKING_TONE[next.status]}>{STATUS_LABEL[next.status].toUpperCase()}</Badge>
              </div>
              <p className="next-when">
                <strong>{pkgName(next.package_key)}</strong>
                <span>{fmtDateShort(next.start_date)} at {fmtTime(next.start_time)}</span>
              </p>
              <div className="next-row">
                <span className="mono">{fmtTZS(next.total)}</span>
                <Badge tone={next.payment_status === "paid" ? "green" : "gold"}>
                  {next.payment_status === "paid" ? "PAID" : "PAYMENT DUE"}
                </Badge>
              </div>
              <a className="btn btn-ghost btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener">Change booking</a>
            </div>
          ) : (
            <Empty title="No upcoming bookings">
              <p style={{ margin: "0 0 12px" }}>Nothing scheduled yet.</p>
              <Link to="/browse" className="btn btn-primary btn-sm">Book a console</Link>
            </Empty>
          )}
        </section>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        {recent.length ? (
          <section className="card" aria-labelledby="activity-title">
            <h3 id="activity-title">Recent activity</h3>
            <p className="section-sub">Payments recorded against your current and next bookings.</p>
            <div
              className="update-list activity-scroll"
              style={{ marginTop: 12 }}
              tabIndex={recent.length > 1 ? 0 : -1}
              aria-label={recent.length > 1 ? "Recent payments. Scroll for earlier activity." : undefined}
            >
              {recent.map((p) => (
                <div className="update" key={p.id}>
                  <span className={`ico ${p.amount < 0 ? "gold" : p.status === "settled" ? "green" : "cyan"}`}>
                    {p.amount < 0 ? "↩" : "✓"}
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong>{p.kind === "refund" || p.amount < 0 ? "Refund / adjustment" : "Payment"}</strong>
                    <span>{p.ref} · {fmtStamp(p.occurred_at)} · {p.booking_ref ?? "—"}</span>
                  </span>
                  <span className="mono">{fmtTZS(p.amount)}</span>
                  <Badge tone={PAYMENT_TONE[p.status]}>{PAYMENT_LABEL[p.status]}</Badge>
                </div>
              ))}
            </div>
            {recent.length > 1 ? (
              <p className="activity-hint">Scroll to see {recent.length - 1} earlier {recent.length === 2 ? "activity" : "activities"} ↓</p>
            ) : null}
          </section>
        ) : (
          <section className="card" aria-labelledby="activity-title">
            <h3 id="activity-title">Recent activity</h3>
            <p className="section-sub">Payments recorded against your current and next bookings will appear here.</p>
            <Empty title="Nothing recent">Your payment receipts show up here once recorded.</Empty>
          </section>
        )}

        <section className="card" aria-labelledby="help-title">
          <h3 id="help-title">Need a hand?</h3>
          <p className="section-sub">Extensions, swaps or support — we reply within 30 minutes (8:00–22:00 EAT).</p>
          <div className="dash-actions">
            <a className="btn btn-gold btn-sm" href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener">WhatsApp us</a>
            <Link to="/profile" className="btn btn-ghost btn-sm">My profile</Link>
          </div>
        </section>
      </div>
    </>
  );
}
