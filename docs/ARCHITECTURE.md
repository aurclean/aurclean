# Architecture notes

Short notes on the decisions that are easy to get wrong later.

## Order status is derived, never typed in

`recomputeOrderStatus` (`src/lib/services/garments.ts`) runs inside the same
transaction as every shop-floor event. It reads the order's garments, finds the first
still-open `ProcessingTask` for each, and takes the least-advanced station across
them. That station is the order's status.

Two consequences worth knowing:

- A garment that has *finished* washing is reported at its **next** station, not the
  one it just cleared. "Where is my order" should answer with where the work is
  queued, not where it has been.
- `CANCELLED`, `REFUNDED` and `ON_HOLD` are terminal or manual and are never
  overwritten by shop-floor activity.

## Money is recomputed, not incremented

`recalcOrderPayments` re-derives `paidAmount`, `refundedAmount`, `outstandingAmount`
and `paymentStatus` from captured payments and processed refunds, then pushes the same
figures onto the invoice and the corporate account's outstanding balance. Nothing
maintains a running total by hand, so a failed mutation cannot leave the ledger drifting.

`computeTotals` in `src/lib/money.ts` is the single source of truth for arithmetic:
discount applies to the subtotal, GST applies to the discounted (taxable) value.

Prisma returns `Decimal`, which React Server Components cannot pass to Client
Components. `num()` converts at the boundary; `plain()` in `src/lib/serialize.ts` deep
-converts a whole query result when needed.

## The garment is the unit of tracking

An order is what gets billed; a garment is what gets handled. `createGarments`
makes one row per physical piece and allocates its id from a per-category
sequence (`TR-1042`), so the prefix on a tag identifies the bucket without a
lookup and two categories can never collide on a number. The category is copied
onto the garment at intake rather than read through `GarmentType`, so
reclassifying an item in the catalogue cannot move a garment that is already
tagged and on the floor.

## Mismatches are derived, exceptions are stored

`detectMismatches` compares each garment against its order and its scan ledger on
every read, so a problem that has been put right disappears without anyone
clearing it, and nothing can go stale. It reports, worst first: a garment marked
lost, a piece scanned under an order it does not belong to, a read from the wrong
category, the same tag read twice at one station, a piece filed on a rack its
order-mates are not on, and a station the garment is recorded as having cleared
with no scan behind it.

The one thing that must survive a refresh is a judgement a person made — a
garment reported missing, a wrong location acknowledged — and those live in
`GarmentException` with an open/resolved state. The dashboard tiles, the category
screens and the mismatch centre all call the same function, so a badge and the
list behind it can never disagree.

`recordGarmentScan` classifies on the way in rather than after the fact, which is
what lets a station tell the operator the piece in their hand belongs to someone
else's order while they are still holding it.

## A customer is a directory entry, not the billing record

Orders keep their own copy of the customer's name, phone, email and address. The
`Customer` row is the searchable directory and the place lifetime figures live; it is
created the first time a phone number is seen at a branch (`upsertCustomer`) and its
totals are re-derived by `recalcCustomerRollup` whenever an order or a payment
changes, on the same "recompute, never increment" rule as the order money columns.
Editing a directory entry therefore cannot rewrite an invoice already issued.

## Scanning resolves to an order, and never duplicates one

`resolveScan` accepts an order tag, a garment tag, a bare order number or a bare
garment code and answers with the same order card. Scanning a tag that is already
open reopens it rather than starting anything new, which is what makes a jumpy
hardware scanner safe at a counter. Every attempt — including the ones that fail and
the ones refused for branch access — is written to `ScanEvent`, together with any
action taken from the card, because "the tag would not scan" is a real support
question and the log is the answer.

## Tags print to a roll, not a page

The tag studio renders at a real millimetre width and injects the matching
`@page { size: <n>mm auto; margin: 0 }` rule, so the on-screen preview is the size of
the paper. Printing sets `data-print-mode="thermal"` on `<body>`, which blanks the
application and leaves only `.thermal-print-root` — a roll printer has no page
furniture to spare. Everything inside is forced to pure black on white. Prints are
counted on the order (`tagPrintCount`), so a reprint is distinguishable from the
original both on the tag and in the audit log.

## Document numbers are allocated atomically

`nextSequence` uses a single `INSERT … ON CONFLICT DO UPDATE … RETURNING` against the
`sequences` table, so concurrent counters can never receive the same number.
`nextGarmentCodeBlock` reserves a contiguous block in one round trip, which is what
makes booking a 40-piece order a single fast transaction.

## Pricing precedence

`resolvePrice` resolves in this order and stops at the first hit:

1. an active **B2B rate card** on the customer's contract (a garment-specific card
   beats a service-wide one)
2. the **service × garment-type** rate
3. the service's **base price**

The order form calls the same server function for its live quote that the server uses
when persisting, so the counter never sees a number the server disagrees with.

## Stations only show actionable work

A `ProcessingTask` can be `PENDING` at washing while the same garment is still
unsorted. Listing it would give operators a queue they cannot act on, so the
workstation filters to tasks whose earlier stages are all closed and reports the rest
as "still finishing an earlier station". `advanceGarment` enforces the same rule
server-side — the filter is a courtesy, not the control.

## Authorisation

- `authorize(permission)` — server actions and route handlers; throws.
- `requirePermission(permission)` — pages; redirects to `/forbidden`.
- `assertBranchAccess(user, branchId)` — reject cross-branch reads and writes.
- `requireWriteBranch(user, requested)` — decide which branch a new record belongs to.

The proxy (`src/proxy.ts`) checks only for the presence of a session, so it is a
convenience redirect and never the boundary.

## Messaging leaves the building only by email

There is no WhatsApp or SMS integration. Notifications are raised on the `IN_APP`
channel — stored, listed in the notification centre, and read out or printed at the
counter — so a deployment needs no messaging credentials to be complete. Email is the
one channel that reaches outside and stays inert unless `EMAIL_API_KEY` and
`EMAIL_FROM` are both set.

## Charts

Chart colours come from a categorical palette validated for colour-vision deficiency
separation and contrast (see `--chart-1 … --chart-6` in `globals.css`). The rules the
charts follow:

- Slots are assigned in fixed order and never cycled or re-ordered on filter.
- Never two y-scales on one plot — revenue and order volume are two charts.
- Nominal categories get one colour; bar length already encodes magnitude.
- Two or more series always carry a legend; every chart offers a table view.
- Dark mode uses its own steps chosen for the dark surface, not an automatic flip.
