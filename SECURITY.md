# Security Policy

We take the security of the Goldenray Energy NZ platform seriously, especially because our customers entrust us with personal and financial information (power bills, addresses, ICP numbers, contact details).

## Reporting a vulnerability

If you believe you have found a security vulnerability in any Goldenray Energy NZ system (this repository, our public website, the customer portal, or any internal tooling), please report it privately so we can fix it before disclosure.

**Email**: security@goldenrayenergy.nz

Please include, where possible:

- A clear description of the vulnerability
- Steps to reproduce, or a proof-of-concept
- The affected URL, endpoint, repository file, or system
- Your assessment of the severity and potential impact
- Whether you have shared this with anyone else

We aim to acknowledge reports within **2 business days** and provide an initial assessment within **5 business days**. Critical issues will be prioritised.

## What is in scope

- Code in this repository (server, client, scripts, migrations)
- Production endpoints under `*.goldenrayenergy.nz`, the Vercel deployment, and the Render backend
- Customer-facing flows: enquiry submission, bill upload, customer portal, magic-link access
- Authentication, authorisation, and session handling
- Data exposure (PII, financial details, internal cost data)
- Email infrastructure (SPF, DKIM, DMARC, mailbox routing)

## What is out of scope

- Third-party services we depend on (Supabase, Vercel, Render, Cloudflare, Resend) — report directly to the vendor
- Denial-of-service testing without explicit prior agreement
- Social engineering of Goldenray Energy staff
- Physical attacks against staff, premises, or hardware
- Issues that require a privileged role to already be compromised

## Safe harbour

If you make a good-faith effort to comply with this policy during your research, we will not pursue legal action against you. We ask that you:

- Do not access, modify, or destroy data that does not belong to you
- Do not degrade service for legitimate users
- Do not retain customer data discovered during testing — delete it after reporting
- Give us reasonable time to fix issues before public disclosure (we suggest 90 days as a default; faster for critical issues we acknowledge)

## Out-of-band disclosure

If you do not receive a response within 5 business days, please follow up via phone on **+64 21 839 356** or use the contact form on https://goldenrayenergy.nz/contact.

## Acknowledgements

We are grateful to the security community. Reporters who confirm valid issues and follow this policy will be acknowledged here (with permission) once fixes are deployed.

---

_Last reviewed: 2026-06-27_
