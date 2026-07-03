# Breach Response Plan

**Goldenray Energy NZ Ltd** — last updated 2026-07-02
**Internal document — not for public distribution**

This plan sets out how Goldenray Energy NZ responds to a suspected or confirmed privacy breach. Under section 117 of the Privacy Act 2020, we must notify the Office of the Privacy Commissioner (OPC) and affected individuals of "notifiable privacy breaches" — those that have caused or are likely to cause "serious harm" to affected individuals.

**Speed matters.** OPC guidance is to notify within 72 hours of becoming aware of a notifiable breach.

---

## 1. Roles

| Role | Person | Contact |
|---|---|---|
| **Privacy Officer** (decision-maker) | Reddy | reddy@goldenrayenergy.nz / +64 21 839 356 |
| **Technical lead** (containment) | Reddy | Same |
| **Communications lead** (customer notification) | Reddy | Same |

*As the business grows, split these into distinct people. Solo-founder mode assumes one person handles all three — which makes speed even more important.*

---

## 2. Definition of a breach

A privacy breach is any of the following happening to personal information we hold:

- **Unauthorised access** — someone accessed data they shouldn't (whether via hack, leaked credential, misconfigured access control, or physical theft)
- **Unauthorised disclosure** — data was sent to or seen by someone it shouldn't have been
- **Loss** — data was destroyed or made permanently inaccessible in a way that harms individuals
- **Interference** — data was altered without authority, in a way that misleads or harms

Examples specific to our platform:
- A customer's uploaded power bill was downloaded by another party
- The `users` or `contacts` table was queried by an unauthorised person
- An admin account was compromised
- A backup file with customer data was leaked
- Emails intended for one customer were sent to another
- A staff laptop with local database credentials was stolen

---

## 3. First 60 minutes — CONTAIN

Before anything else, stop the bleeding. The goal is to prevent further data loss, not to figure out what happened.

**3.1 Assess the situation (5 min)**
- What data type is affected?
- How many people are potentially affected?
- Is the exposure ongoing right now?
- Is any evidence of active exploitation?

**3.2 Contain (varies by scenario)**

| Scenario | Immediate action |
|---|---|
| Suspected admin account compromise | Change the admin password + rotate JWT_SECRET on Render — invalidates all sessions |
| Leaked API key (Resend, Supabase, Twilio) | Rotate the key in the vendor dashboard immediately |
| Wide DB exposure (RLS gap, misconfigured grant) | Apply an emergency RLS-off migration or REVOKE, then investigate |
| Storage bucket accidentally made public | Toggle bucket to private in Supabase Studio |
| Malicious code in the repo | Revert the offending commit + force-push (after backup) |
| Stolen device with credentials | Rotate every credential the device had access to; revoke device-based 2FA if used |
| Phishing suspected on staff | Change password + revoke active sessions on affected accounts |

**3.3 Preserve evidence**
- Take screenshots of the affected state before fixing it
- Copy relevant server logs to a separate location
- Save any suspicious emails or messages in full (with headers)
- Do NOT wipe compromised systems until logs are safely off-box

**3.4 Do NOT panic-notify yet**
Notification is important, but premature notification without facts is worse than a short delay. Get containment done first, then notify within 72 hours from the point of becoming aware.

---

## 4. Next 24 hours — ASSESS

Now determine what happened and what harm is possible.

**4.1 Determine the scope**
- Which tables / buckets / files were accessed?
- How many people's data is affected?
- What specific data types? (Names alone are less serious than name + address + bill history)
- When did it start? When did it stop?
- Do we know who?

**4.2 Determine if it's "notifiable"**

A breach is notifiable if it caused or is likely to cause **serious harm** to any affected individual. Under section 113, factors include:

- Nature and sensitivity of the data (financial info + address = high risk)
- Whether identifying information was included
- Whether protective measures were in place (encrypted? bcrypt-hashed?)
- The person or people who obtained the information (competitor? random attacker?)
- Whether the information was disclosed publicly or contained
- Any other relevant factor

Rough guide:

| Situation | Likely notifiable? |
|---|---|
| Names + emails from `website_enquiries` seen by an internal test account | No — no serious harm expected |
| Customer bills (with ICP, address, amounts) downloaded by unknown party | **Yes** — financial + property identifiers = serious harm potential |
| Admin account phished — attacker had full DB access for an hour | **Yes** — even without evidence of data taken, potential serious harm |
| An employee accidentally emailed a proposal to the wrong customer | Possibly — depends on what was in the proposal |
| Rate limiter blocked 500 bot requests attempting SQL injection | No — no successful breach |

**When in doubt, notify.** OPC treats over-notification as prudent; under-notification as negligent.

**4.3 Document everything**
Keep a running incident log with:
- Timeline of events (when detected, when contained, when investigated)
- What data types were affected
- Number of people affected (best estimate)
- Actions taken and by whom
- Evidence file locations

---

## 5. Within 72 hours — NOTIFY (if notifiable)

**5.1 Notify OPC first**
Submit via the NotifyUs form at https://privacy.org.nz/notify.

Include:
- What happened, when, and how
- What data types were affected
- Approximate number of people affected
- What we're doing about it
- Our Privacy Officer contact

OPC may follow up with questions or specific guidance for individual notifications.

**5.2 Notify affected individuals**

Two exceptions from section 116 where we don't need to notify individuals directly:
- Doing so would create a serious risk to their safety
- OPC has advised us not to (unusual)
- Notifying isn't reasonably practicable (only in specific edge cases)

Otherwise, notify each affected individual directly. Use email if we have it; postal address if not.

**Include in the notification:**

```
Subject: Important — a privacy incident that affects your account with us

Kia ora [Name],

We are writing to let you know that on [date], we became aware of a
privacy incident affecting Goldenray Energy NZ that we believe involves
some of your personal information.

WHAT HAPPENED
[Brief factual description — 2-3 sentences. What, when, how.]

WHAT INFORMATION WAS AFFECTED
[Specific data types. Be concrete: "your name, email, address, and
your uploaded power bill from May 2026". Vague notifications are
distrusted.]

WHAT WE'RE DOING
[Specific containment actions. E.g. "We revoked the compromised
access, changed all admin passwords, and enabled two-factor
authentication."]

WHAT YOU SHOULD DO
[If passwords were leaked → change them. If bank details → contact
your bank. If identity documents → contact IDCARE at
https://www.idcare.org.]

WHO TO CONTACT
[Your details, plus OPC.]

We are sorry this has happened. Protecting your information is a
core commitment of ours and we take this seriously.

Ngā mihi,
Reddy — Privacy Officer, Goldenray Energy NZ
```

**5.3 Publish a public notice (only if required)**
If we can't reach affected individuals directly, publish a notice on our website and via email to our full list. OPC may direct this.

---

## 6. After the incident — LEARN

**6.1 Post-incident review (within 2 weeks)**

Write a short incident report covering:
- Root cause (technical, procedural, or human)
- What the response did well
- What could have been faster or better
- Specific changes to prevent recurrence
- Any indirect exposures we should also close

**6.2 Update this plan**
If the incident revealed a gap in this plan, update it. If a role assumption didn't work, fix the roles.

**6.3 Consider bringing in outside help**
For anything above minor severity, consult:
- A privacy lawyer for legal exposure assessment
- A pen-test firm to audit whether the initial breach was symptomatic of broader gaps
- A public relations advisor if the incident is public-facing

**6.4 Legal / insurance**
- If we have cyber liability insurance, notify the insurer within the required window (usually 48h)
- Retain all logs and communications for legal review
- Keep the incident report itself confidential — internal privileged document

---

## 7. Contacts

| Contact | Purpose | Number / URL |
|---|---|---|
| Office of the Privacy Commissioner | Notification, guidance | https://privacy.org.nz/notify — 0800 803 909 |
| CERT NZ | Technical response support | https://www.cert.govt.nz — 0800 237 869 |
| NZ Police (if criminal) | Report crime | 105 (non-emergency) / 111 (emergency) |
| IDCARE (for customers who suffered identity loss) | Free customer support | https://www.idcare.org — 0800 121 068 |
| Bitwarden secure notes | Location of all critical account credentials | (only accessible with master password) |

---

## 8. Practice

Run a tabletop exercise at least once per year. Pick a realistic scenario ("suspected admin account phishing detected in Render logs at 11pm on Friday") and walk through this plan without touching anything real. Note what's slow, unclear, or missing.

**Next scheduled tabletop:** 2027-01-15 (six months from adoption)

---

_This plan complies with the Privacy Act 2020 sections 112-118 and OPC's published guidance on notifiable privacy breach response. It is an internal working document — update the roles, contacts, and containment scenarios as the business evolves._
