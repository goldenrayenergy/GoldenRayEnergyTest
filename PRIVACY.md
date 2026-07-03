# Privacy Statement

**Goldenray Energy NZ Ltd** — last updated 2026-07-02

This statement explains what personal information Goldenray Energy NZ collects, why we collect it, how we use and share it, and what your rights are under the New Zealand Privacy Act 2020.

If you have any questions about this statement or how we handle your information, contact our Privacy Officer:

- **Email**: privacy@goldenrayenergy.nz
- **Phone**: +64 21 839 356
- **Post**: Privacy Officer, Goldenray Energy NZ, Auckland, New Zealand

---

## 1. Who we are

Goldenray Energy NZ Ltd designs, sells, and installs residential and commercial solar systems in New Zealand. Our website is https://goldenrayenergy.nz and our customer-facing portal (currently in soft launch) is https://golden-ray-energy-test.vercel.app.

We are an "agency" under the Privacy Act 2020 and are responsible for the personal information we hold.

## 2. What information we collect

We collect only the information we need to prepare a solar quote, install a system, and provide ongoing service. The specific types are:

### 2.1 Identity and contact information
- Full name, email address, phone number
- Physical address (street, suburb, city, postcode)
- Property ownership status

### 2.2 Property and technical information
- Roof type, number of floors, roof orientation
- Electricity connection identifier ("ICP number") — a NZ-wide unique identifier for your electrical connection
- Your electricity retailer, plan name, and network distributor

### 2.3 Electricity usage information
- Copies of recent power bills you choose to upload (typically as PDF or image)
- Extracted usage figures: kWh consumed, monthly spend, seasonal patterns
- These bills contain your name, address, ICP, and billing amounts

### 2.4 Referral information
- If you were referred to us by another customer, that person's name and phone

### 2.5 Enquiry preferences
- Your preferred installation timeframe
- Whether you want a callback
- Free-text notes you share with us

### 2.6 Technical logs
- The IP address of the device you submit forms from
- Timestamps of your interactions
- User-agent (browser and OS) strings
- Error reports if something breaks on our end

## 3. Why we collect it

We collect this information for the following purposes, and no others:

- **To prepare an accurate solar quote** — system sizing, savings modelling, and financial projections require your bill history and roof details.
- **To carry out an installation** — property address, ICP, and connection details are needed to design, permit, and commission a system.
- **To communicate with you** — email confirmations, follow-up calls, proposal delivery, warranty registration, maintenance reminders.
- **To improve our service** — anonymised usage patterns help us refine the wizard, calculator, and proposal accuracy. We do NOT use identifiable customer data for training AI models or selling insights.
- **To meet legal and regulatory obligations** — record-keeping requirements under NZ tax, consumer, and electrical safety law.

## 4. How we collect it

We collect information:

- **Directly from you** — when you complete our online enquiry form, upload a power bill, respond to an email, or speak with our team.
- **From your power bill uploads** — when you upload a bill, we automatically extract structured data (retailer, ICP, usage, cost) using text-recognition software (OCR). The bill file itself is stored securely.
- **From publicly-available registries** — some technical data about your electrical connection (distributor, capacity) may be looked up from the Electricity Authority's public ICP registry.
- **From our internal systems** — activity logs, communication history, and quote versions we generate as we work with you.

We do NOT purchase customer lists or acquire information from data brokers.

## 5. Who we share it with

We share your information only in the following situations:

### 5.1 Service providers we use to run our platform
The following third parties process your information on our behalf. Each has committed to specified security standards in their Data Processing Agreements:

| Service | Country | Purpose |
|---|---|---|
| **Supabase** | United States (with Sydney region option) | Database storage, file storage for uploaded bills, authentication |
| **Vercel** | United States | Website + customer portal hosting |
| **Render** | United States | Backend application hosting |
| **Cloudflare** | Global (edge network) | DNS, email routing, network security |
| **Resend** | United States | Transactional email delivery |
| **1stDomains** | New Zealand | Domain registration |

For paid plans, each of these vendors publishes a Data Processing Agreement outlining their security controls and privacy commitments. We select vendors with formal privacy commitments comparable to the New Zealand Privacy Act.

### 5.2 Cross-border disclosure notice
Most of our service providers are based outside New Zealand (principally the United States). By providing us your information, you accept that it may be stored and processed overseas. We only use providers who apply comparable safeguards to those required by the NZ Privacy Act.

### 5.3 Installation partners
If we contract a licensed electrician or scaffolder to complete part of your installation, we share only the information they need: name, address, contact details, and site access instructions. We do not share your bill history or financial information.

### 5.4 Financing partners (only with your consent)
If you request financing (green loan, PPA, or hire-purchase), we share the specific information the finance provider requires to assess your application. We ask for your explicit consent before doing so.

### 5.5 Regulatory or legal obligations
We may disclose information when required by law: to the Inland Revenue for tax records, to the Electricity Authority for connection certification, to the Ministry of Business for solar-scheme reporting (aggregated only), or in response to a lawful court order.

### 5.6 What we do NOT do
- We do NOT sell your information to any third party
- We do NOT share your information for marketing purposes
- We do NOT provide your information to social media platforms
- We do NOT provide your information to insurance companies without your explicit consent

## 6. How we protect it

We take security seriously because most of our customers share sensitive financial and property information with us. Our current safeguards include:

- Encrypted transport (HTTPS / TLS 1.3) for all traffic between you and our systems
- Database access restricted to authenticated backend services only (Row Level Security enabled on every table)
- Bill files stored in access-controlled buckets, retrieved only through short-lived signed URLs
- Two-factor authentication on administrator accounts
- Password hashing using bcrypt with modern cost factors
- Rate limiting on all public endpoints to prevent abuse
- Regular dependency vulnerability scans
- Written incident response and breach notification plan
- Privacy Officer designated and reachable at the contact above

Full technical detail is published at [SECURITY.md](./SECURITY.md).

## 7. Your rights

Under the Privacy Act 2020, you have the right to:

### 7.1 Access
Request a copy of the personal information we hold about you. Email `privacy@goldenrayenergy.nz`. We will respond within 20 working days.

### 7.2 Correction
Request that we correct information we hold about you that is inaccurate, incomplete, misleading, or out of date. Same contact and timeframe.

### 7.3 Withdraw consent
Ask us to stop using your information for a specific purpose (for example, marketing emails).

### 7.4 Complain
Complain to us first — most issues can be resolved directly. If you are not satisfied with our response, you may complain to the Office of the Privacy Commissioner at https://privacy.org.nz.

## 8. How long we keep it

We retain personal information only for as long as we need it. Specific retention periods are set out in our [Data Retention Policy](./DATA_RETENTION_POLICY.md). Summary:

| Type | Retention |
|---|---|
| Enquiries that never became customers | 24 months after last contact |
| Customer records (installed systems) | 7 years after warranty end (regulatory requirement) |
| Uploaded power bills | 5 years after quote (for accuracy verification) |
| Activity logs | 12 months |
| Marketing consent records | Until you unsubscribe + 12 months |

## 9. Cookies and analytics

Our website uses minimal cookies:

- **Session cookies** — required for the enquiry form and customer portal to function
- **No third-party analytics cookies** at this time (no Google Analytics, no Facebook Pixel)

If we add analytics in future, we will update this statement and, where required, ask for your consent through a cookie banner.

## 10. Changes to this statement

We may update this statement to reflect changes in how we process information or in the law. The date at the top shows when it was last updated. Material changes will be highlighted at the top of the page for 30 days.

## 11. Contact and complaints

**Privacy Officer**
- Email: privacy@goldenrayenergy.nz
- Phone: +64 21 839 356

**Office of the Privacy Commissioner**
- Website: https://privacy.org.nz
- Free advice line: 0800 803 909

---

_This statement was prepared with reference to the Office of the Privacy Commissioner's Privacy Statement Generator and the Privacy Act 2020, and reflects our actual processing practices as of the last update date above._
