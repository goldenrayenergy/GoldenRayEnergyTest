# ☀️ GoldenRay Energy — Full-Stack Solar CRM

A production-grade CRM platform for solar energy sales, marketing, and operations in New Zealand.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React.js + Tailwind CSS | Component-driven, responsive UI |
| **Backend** | Node.js / Express | RESTful API with modular services |
| **Database** | PostgreSQL | Relational data — leads, deals, users, pipeline |
| **PDF Generation** | Puppeteer | Server-side proposal rendering |
| **Email Service** | SendGrid / Nodemailer | Transactional email delivery |
| **Authentication** | JWT | Token-based auth with role enforcement |
| **Deployment** | Docker + Docker Compose | Cloud-ready (AWS / GCP / Azure) |

## Project Structure

```
goldenray-fullstack/
├── client/                     # React frontend (Vite + Tailwind)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/            # Badge, Button, Card, KPI, Modal, Tabs, DataTable
│   │   │   ├── layout/        # PortalLayout, Sidebar, Header
│   │   │   ├── website/       # Public website components
│   │   │   └── portal/        # CRM portal components
│   │   ├── pages/             # Route-level pages
│   │   ├── context/           # AuthContext (JWT state management)
│   │   ├── services/          # API client (Axios) with typed helpers
│   │   └── utils/             # Formatters, constants
│   ├── tailwind.config.js
│   └── package.json
├── server/                     # Express API
│   ├── config/                # Database pool, environment config
│   ├── middleware/            # JWT auth, role authorization
│   ├── models/                # User, Contact, Deal, Campaign, Task, Activity
│   ├── routes/                # RESTful endpoints (12 route files)
│   ├── services/              # PDF generation, email, solar calculations
│   └── db/
│       ├── schema.sql         # Full PostgreSQL schema (10 tables)
│       └── seed.sql           # Demo data (users, contacts, deals, campaigns)
├── docker-compose.yml
├── .env.example
└── README.md
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ (or Docker)
- npm or yarn

### 1. Clone & Install

```bash
git clone <repo-url> && cd goldenray-fullstack
npm run install:all
```

### 2. Setup Database

**Option A — Docker (recommended):**
```bash
docker compose up db -d
```

**Option B — Local PostgreSQL:**
```bash
createdb goldenray
psql goldenray < server/db/schema.sql
psql goldenray < server/db/seed.sql
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your database credentials and secrets
```

### 4. Generate Password Hashes for Seed Users

```bash
cd server && node -e "
  import('bcryptjs').then(b => b.default.hash('admin123', 10).then(h => console.log(h)))
"
```
Update the hashes in `server/db/seed.sql` accordingly.

### 5. Run Development

```bash
npm run dev
```

This starts both:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5000

### 6. Docker Full Stack

```bash
docker compose up --build
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| GET | `/api/auth/me` | Get current user profile |
| GET | `/api/auth/users` | List all users |

### Contacts (Leads)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leads` | List contacts (filterable) |
| GET | `/api/leads/stats` | Pipeline statistics |
| GET | `/api/leads/:id` | Get single contact |
| POST | `/api/leads` | Create contact |
| PATCH | `/api/leads/:id` | Update contact |
| DELETE | `/api/leads/:id` | Delete contact |

### Deals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/deals` | List deals |
| GET | `/api/deals/pipeline` | Pipeline breakdown |
| GET | `/api/deals/forecast` | Revenue forecast |
| POST | `/api/deals` | Create deal |
| PATCH | `/api/deals/:id` | Update deal (stage changes) |

### Campaigns, Tasks, Activities, Companies, Proposals
All follow the same RESTful pattern: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`

### Reports
| GET | `/api/reports/dashboard` | Aggregate dashboard data |
| GET | `/api/reports/team` | Team performance metrics |

### Proposals
| POST | `/api/proposals/calculate` | Run solar calculation |
| POST | `/api/proposals/generate` | Create proposal record |
| POST | `/api/proposals/:id/pdf` | Generate PDF (Puppeteer) |
| POST | `/api/proposals/:id/send` | Email proposal to customer |

## Portal Pages (HubSpot-style)

### Sales Hub
- **Deals** — Kanban pipeline with stage management
- **Sales Analytics** — Revenue trends, forecasting, source analysis
- **Tasks** — Team task management with priorities
- **Pipeline** — Lead stage kanban board

### Marketing Hub
- **Campaigns** — Campaign management with ROI tracking
- **Email Analytics** — Open rates, click rates, bounce tracking
- **Lead Scoring** — Contact scoring with hot/warm/cold segmentation

### Data Hub
- **Contacts** — Full CRM contact database
- **Companies** — B2B company records
- **Reports** — Revenue, funnel, regional, environmental reports

### Admin
- **Pricing Config** — Solar system pricing parameters
- **Team Management** — User/role administration

## Database Schema

10 tables with full relational integrity:
- `users` — Employee accounts with bcrypt passwords
- `contacts` — Leads/customers with lifecycle tracking
- `companies` — B2B company records
- `deals` — Sales pipeline with weighted probabilities
- `pipeline_stages` — Configurable lead stages
- `campaigns` — Marketing campaigns with channel tracking
- `tasks` — Team task management
- `activities` — Activity timeline (calls, emails, meetings)
- `proposals` — Solar quotes with PDF generation
- `system_config` — Application settings (JSONB)

## Demo Credentials

| User | Email | Password | Role |
|------|-------|----------|------|
| Aroha Mitchell | aroha@goldenray.co.nz | admin123 | Admin |
| Liam Patel | liam@goldenray.co.nz | manager123 | Sales Manager |
| Sophie Nguyen | sophie@goldenray.co.nz | sales123 | Sales Executive |
| Jack Te Awa | jack@goldenray.co.nz | proposal123 | Proposal Manager |

## Deployment

### AWS / GCP / Azure
1. Build frontend: `cd client && npm run build`
2. Serve `client/dist` via CDN or static hosting
3. Deploy server as container or EC2/Cloud Run/App Service
4. Use managed PostgreSQL (RDS / Cloud SQL / Azure DB)
5. Set environment variables in cloud console

### Environment Variables
See `.env.example` for all configuration options.

## License
Proprietary — GoldenRay Energy Ltd.
