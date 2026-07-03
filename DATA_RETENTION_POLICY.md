# Data Retention Policy

**Goldenray Energy NZ Ltd** — last updated 2026-07-02
**Internal document, referenced from public [PRIVACY.md](./PRIVACY.md) section 8**

Under Information Privacy Principle 9 of the NZ Privacy Act 2020, we cannot keep personal information longer than we need it. This policy defines how long each type of information is retained, why, and how it is deleted.

---

## 1. Guiding principle

Every retention period should have an explicit business or legal justification. When both purposes have run out, the data must be deleted or anonymised.

We prefer **deletion** over **anonymisation**, because most personal data cannot be truly anonymised at our scale (a person + a partial address + a monthly bill = usually re-identifiable).

---

## 2. Retention periods by data category

### 2.1 Website enquiries that never became customers

**Table:** `website_enquiries` where `status IN ('new', 'partial', 'contacted', 'lost', 'disqualified')`

**Retention period:** 24 months after last customer interaction

**Justification:**
- Business — customers often return 6-18 months later after "thinking about it." Keeping their prior context avoids re-asking the same questions.
- Legal — none. Not a customer under any consumer protection or tax rule.

**Deletion:** Automated monthly cleanup job flags rows and hard-deletes them. Associated `contacts`, `tasks`, `activities` rows deleted in cascade.

### 2.2 Customer records (installed systems)

**Table:** `contacts`, `deals`, `projects_v2`, `quotes`, `quote_versions` where a system was installed

**Retention period:** 7 years after the last warranty period ends

**Justification:**
- Legal — Companies Act (7 years for financial records), Consumer Guarantees Act (durability claims possible), Electrical Safety Regulations (compliance records must be retained), IRD (7 years for tax records)
- Business — warranty claims, servicing records, follow-on system upgrades

**Deletion:** Annual review flags records past the retention window. Deletion is manual with a written note explaining what was deleted and why.

### 2.3 Uploaded power bills (customer-uploaded PDFs and extracted data)

**Table:** `bill_uploads`, `bill_analyses`; **Storage bucket:** `customer-bills`

**Retention period:** 5 years after final quote or, if installed, until end of contract with the retailer whose bills we hold — whichever comes first

**Justification:**
- Business — customers occasionally challenge our savings projections years later. Original bills verify our modelling assumptions.
- Legal — Electricity Industry Act allows use of customer usage data during and up to 12 months after supply period.
- Privacy — bills contain more identifying detail than most other data types (ICP, address, monthly usage patterns), so shorter retention than customer records.

**Deletion:** Annual sweep of the `customer-bills` bucket removes files older than the retention period. Extracted structured data in `bill_analyses` deleted at the same time.

### 2.4 Activity and system logs

**Table:** `activities`, `pm_task_events`, `error_reports`, `qr_scans`

**Retention period:** 12 months

**Justification:**
- Business — troubleshooting, sales performance, campaign attribution
- Legal — none specific

**Deletion:** Automated monthly cleanup deletes rows older than 12 months.

### 2.5 Authentication and session logs

**Table:** `users.last_login_at`, JWT tokens (never stored server-side)

**Retention period:** 24 months of login activity per user; JWTs expire per token settings (currently 7 days)

**Justification:**
- Business — identifying stale accounts for cleanup
- Legal — investigating security incidents
- Privacy — no benefit to keeping longer

**Deletion:** Login timestamps overwritten on each login; JWT tokens expire automatically.

### 2.6 Email delivery logs

**Table:** `quote_email_log`; also stored by Resend on their infrastructure

**Retention period:** 12 months in our DB; Resend retention per their policy (typically 30 days)

**Justification:**
- Business — delivery troubleshooting, resend on bounce
- Privacy — content is already sent, no need to retain long-term

**Deletion:** Automated cleanup of `quote_email_log` rows older than 12 months.

### 2.7 Marketing / newsletter consent

**Table:** future `marketing_consents` (planned)

**Retention period:** For as long as consent is active + 12 months after unsubscribe (to prove no unsolicited contact after opt-out)

**Justification:**
- Legal — Unsolicited Electronic Messages Act; proving consent on request
- Business — none once unsubscribed

**Deletion:** 12-month sweep of unsubscribe records past the window.

### 2.8 Financial records (payments, invoices, financing applications)

**Table:** `finance_applications`, future `payments` and `invoices` tables

**Retention period:** 7 years after transaction completion

**Justification:**
- Legal — IRD (7 years), Companies Act (7 years for financial records)
- Business — historical revenue analysis

**Deletion:** Manual annual review after 7-year window.

### 2.9 Support communications

**Table:** `contacts.notes`, `contacts.last_activity`

**Retention period:** Same as parent contact record (see 2.1 and 2.2)

**Justification:** Support notes are part of the customer relationship record.

**Deletion:** Follows parent record deletion.

### 2.10 Third-party held data

Some vendors we use retain data on their own systems:

| Vendor | What they hold | Their retention |
|---|---|---|
| Supabase | Full database backups | 7 days rolling (free tier) |
| Resend | Sent email content and metadata | ~30 days |
| Cloudflare | DNS query logs, email routing logs | See Cloudflare policy — typically short |
| Render | Application logs, deploy history | ~7 days for free tier |
| Vercel | Build logs, edge access logs | Per Vercel policy |

**Our responsibility:** we do not control these directly. When a data subject asks for deletion (see PRIVACY.md section 7), we complete deletion in our systems and note that vendor rolling backups will age out within the vendor's retention window.

---

## 3. Data subject deletion requests

When a customer requests deletion under IPP 7 or the general right in section 22:

1. Confirm the request via a channel we already know (their registered email or phone)
2. Delete their records from all tables listed above where legally permitted
3. Where legal obligations require retention (installed customers → 7-year rule), inform the customer we must retain the record but will restrict access
4. Note the deletion in our incident log with date, reason, requester
5. Confirm to the customer within 20 working days

If deletion isn't possible for a specific reason (audit obligation, live dispute, ongoing warranty work), explain the reason in writing.

---

## 4. Backup and restore considerations

Deletion from live systems does not immediately delete from backups. Our current setup:

- Supabase daily backups (free tier: 7 days rolling; paid: 30 days)
- If we restore from an older backup for any reason, we re-run the deletion sweep afterwards to remove records that had been deleted since the backup

---

## 5. Anonymisation vs deletion

We prefer full deletion. Where we retain data for aggregate reporting (e.g. "average kWh usage per Auckland home"):

- Aggregate to statistical minimums (never fewer than 20 records per bucket)
- Strip name, email, phone, address, ICP entirely
- Retain year + region + measurement only

Anonymised aggregate data is not personal information under the Privacy Act and can be retained indefinitely.

---

## 6. Review

This policy is reviewed:

- Annually
- After any privacy incident where retention was a factor
- When we add a new data type, table, or vendor
- If OPC guidance changes

**Next scheduled review:** 2027-07-02

---

_This policy operationalises Information Privacy Principle 9 (retention) and the individual-rights provisions of the NZ Privacy Act 2020. It is a working document — retention periods can be tightened as we gain operational experience, and must be widened only with explicit legal justification._
