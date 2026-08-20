# Using the enquiries page

Written for whoever reads the enquiries — not for a developer. If you have been
handed a site with this installed, this is the page you were given and this is
what everything on it does.

It lives at **`/leads`** on your own site. Only you can open it: you sign in
with your email, and to anyone else the address simply does not exist.

---

## The list

Newest first, because you are looking for what just came in.

The **inbox** — what you see by default — is everything you have not dealt
with. Enquiries you mark *archived* or *spam* leave it. That is the point: a
list that never gets shorter is one you stop opening.

The counts at the top are always the whole picture:

| | |
| --- | --- |
| **unanswered** | the number that matters — enquiries still waiting for you |
| **total** | everything held, including archived and spam |
| **in the last 7 days** | whether things are busier than usual |
| **not verified** | see *"not verified" does not mean fake*, below |

The search box filters as you type, across names, addresses, services and
message text. It only searches the view you are in — filter to Spam first if
that is where you are looking.

---

## Dealing with an enquiry

Four buttons on each card, and each is one click:

- **Mark replied** — you have answered. It leaves the inbox.
- **Mark archived** — dealt with, no reply needed.
- **Mark spam** — should never have arrived.
- **Back to new** — you marked it too early.

Nothing is deleted by any of these. The enquiry is still there, still exported,
still searchable; it has only moved out of the way. Click **Spam** or
**Archived** at the top to see them.

### Deleting

**Delete is permanent and there is no undo.** It asks you to confirm, and names
the person so you can see who you are about to remove.

Every deletion is written to an audit log — who did it, when, and which
enquiry. That record keeps only the *domain* of the address (`example.com`),
never the address itself: a log that kept a copy of what you just deleted would
have undone the deletion.

Use the status buttons for tidying. Use delete when someone has asked you to
erase their data, or when you genuinely want it gone.

---

## "Not verified" does not mean fake

Every enquiry is checked by an anti-spam challenge, and the tag on the card
tells you how that went:

| Tag | What happened |
| --- | --- |
| **passed** | the challenge ran and was satisfied |
| **unverified** | no challenge was completed — usually someone with JavaScript disabled |
| **unavailable** | the challenge service was unreachable, so nothing was learnt |

**`unverified` and `unavailable` are not accusations.** They are recorded so a
message that arrived during an outage is distinguishable from one that passed a
real check — not so that you ignore it. Real customers appear in both. Read the
message.

### Spam score

Some cards show one. It counts things spam tends to have: many links, shouting,
known sales phrases, a message pasted within a second of the page loading.

It never blocks anything, and it never will. Every one of those signals has a
real customer who trips it — someone pasting three links to their old site,
someone who types fast. **A message you delete costs a second. A client you
never reply to is gone and you never find out.** The score is there to sort the
list, not to decide for you.

---

## Getting the enquiries out

**Download CSV / JSON / Excel** gives you everything, filtered the same way the
page is. Excel is a real workbook rather than a renamed CSV — worth knowing,
because opening a CSV in Excel turns a phone number like `+998901234567` into
scientific notation and strips leading zeros from IDs, and neither looks like an
error to whoever opens it.

**Save as PDF** prints what you are looking at. Filter to one person first and
you get their enquiries alone.

### ⚠ Contact list — read this before using it

The **Contact list** menu exports for Mailchimp, Klaviyo or a CRM.

**These people did not agree to receive marketing.** They filled in a contact
form, and your privacy notice almost certainly promises they will not be added
to a mailing list. Under GDPR that promise is binding, and a contact form is not
consent.

The files are built so that neither Mailchimp nor Klaviyo can mark anyone as
subscribed when you import: there is no subscribe column, and every row states
in plain words that no consent was given. **That is a guardrail, not
permission.** Import them as *non-subscribed*, use them to look someone up, and
do not send a campaign.

If you want a real mailing list, the form needs a separate unticked box and the
privacy notice needs changing to match. Both, not one. Ask before sending.

---

## If someone asks about their data

Two requests you are legally obliged to answer — one month under GDPR, 45 days
under CCPA. Neither cares that it is "just a contact form": a name, an address
and free text about someone's situation is personal data.

- **"What do you hold about me?"** — your developer can pull everything for one
  address in a single request.
- **"Delete everything you hold about me."** — same, and it removes every
  enquiry from that address at once.

Both are logged, including the lookups. If you only need to remove one enquiry,
the Delete button on the card is the same thing.

---

## How long enquiries are kept

They delete themselves after the period set for your site — commonly a year.
That is enforced by the storage, not by anyone remembering, and it matches what
your privacy notice promises.

**A file you download is not covered by that.** The moment a CSV is on your
laptop it is a copy nobody expires. Delete exports when you are done with them.

---

## If something looks wrong

- **The page says "not found"** — your sign-in has expired, or the access rule
  was changed. Sign in again first.
- **A download does nothing** — you are signed in to the page but the session
  behind it has lapsed. Reload and try again.
- **An enquiry arrived with no email notification** — the enquiry is safe. It
  is written down before any email is attempted, precisely so a mail outage
  costs a notification and never a lead. Check the page.
