# PM Tool — `/pm` namespace

Parallel project-management tool for Goldenray Energy's solar install pipeline.
Lives alongside the existing `/portal` (sales-manager view) without overlap.

## Where to find what

```
server/
├── db/
│   ├── migrations/
│   │   ├── 016_pm_tool_phase_a.sql        # projects_v2 + 7 supporting tables
│   │   ├── 017_pm_task_events_comments.sql# audit log + slack-style comments
│   │   └── 018_pm_admin_config.sql        # company_settings, financing, terms
│   └── apply-migration-{016,017,018}.js   # one-shot applicators
├── routes/pm/
│   ├── index.js                # /api/pm namespace mount
│   ├── projects.js             # CRUD + lane state machine + commission
│   ├── artifacts.js            # file upload (Supabase Storage)
│   ├── owner.js                # 7-zone dashboard endpoint
│   └── admin.js                # company_settings, financing, terms admin
├── services/pm/
│   ├── laneDefinitions.js      # task definitions, state machines, gates
│   ├── proposalService.js      # Stage 1 + Stage 2 PDF generation
│   ├── storageService.js       # Supabase Storage helpers
│   ├── vppLookup.js            # VPP-compatible hardware lookup
│   └── README.md               # this file
├── data/
│   └── vpp-compatible-hardware.json
└── scripts/
    ├── seed-pm-test-projects.js          # 5 fixtures + payments + events
    ├── audit-product-catalogue.js
    ├── build-fixed-catalogue-xlsx.js     # generates catalogue v2 Excel
    ├── build-proposal-templates-xlsx.js  # generates 6-template Excel
    ├── sample-proposal-pdf.js            # standalone Stage 1 sample
    └── sample-proposal-stage2-pdf.js     # standalone Stage 2 sample

client/src/pm/
├── PmApp.jsx, PmLayout.jsx
├── pages/
│   ├── OwnerDashboardPage.jsx  # 7-zone single-screen view
│   ├── ProjectListPage.jsx     # filterable project list
│   ├── ProjectNewPage.jsx
│   ├── ProjectDetailPage.jsx   # 5-lane swim view
│   └── AdminPage.jsx           # 3-tab admin config
├── components/
│   ├── ItemPanel.jsx           # split-pane task work surface
│   ├── StateMachineControl.jsx # workflow stepper + Save & advance
│   ├── SmartFieldList.jsx      # Needed-now / Filled / Later grouping
│   ├── BlockersBanner.jsx
│   ├── ActivityTimeline.jsx
│   ├── CommentsThread.jsx
│   └── specialized/            # 6 specialized work surfaces
│       ├── SiteSurveyForm.jsx
│       ├── SystemDesignForm.jsx
│       ├── BomLockedForm.jsx
│       ├── CommissioningForm.jsx
│       ├── CocForm.jsx
│       └── ProposalForm.jsx
├── services/pmApi.js
└── utils/stateMachine.js
```

## Routes

| URL | Purpose |
|---|---|
| `/pm` | Owner Dashboard (default landing) |
| `/pm/owner` | Owner Dashboard (explicit) |
| `/pm/projects` | Project list |
| `/pm/projects/new` | Create project |
| `/pm/projects/:id` | Project detail (5 swim-lanes) |
| `/pm/admin` | Admin config (settings / financing / terms) |
| `/p/:share_token` | (Phase D) Customer magic-link viewer — not built yet |

| API | Purpose |
|---|---|
| `GET /api/pm/health` | Health probe |
| `GET POST /api/pm/projects` | List / create |
| `GET PATCH DELETE /api/pm/projects/:id` | CRUD + soft-cancel |
| `PATCH /api/pm/projects/:id/lanes/:lane` | Toggle items, transition state, save fields |
| `GET POST /api/pm/projects/:id/comments` | Slack-style task comments |
| `GET /api/pm/projects/:id/events` | Task audit log |
| `* /api/pm/projects/:id/artifacts/...` | File upload + signed-URL download |
| `POST /api/pm/projects/:id/commission` | Populate asset fields, set commissioned_at |
| `GET /api/pm/owner/dashboard` | All 7 dashboard zones in one call |
| `GET PATCH /api/pm/admin/settings` | Company settings (single row) |
| `* /api/pm/admin/financing` | Financing options CRUD |
| `* /api/pm/admin/terms` | Versioned T&Cs |

## How the state machine works

Each task lives in `lane_status.{lane}.item_meta.{itemKey}` as:

```js
{
  state: 'drafting',                  // current state from task's states[]
  fields: { panel_count: 32, ... },   // structured fields edited by users
  notes: 'free-text notes',
  state_history: [...],               // audit chain
  completed_at, completed_by, last_uncompleted_at, last_reopened_at, ...
}
```

The corresponding `lane_status.{lane}.items.{itemKey}` is a boolean mirror:
`true` if and only if `state === itemDef.doneState`. Used for cross-lane gate
checks and lane completion roll-ups.

### Task definitions

Each task in `laneDefinitions.js` declares:
- `key` — unique within the lane
- `label`, `gateKeeper`, `artifactType`
- `states` — the state-machine vocabulary
- `initialState`, `doneState`
- `transitions` — graph of allowed `from → [to]` edges
- `schema.fields` — typed structured fields (with `requiredAt: state` validators)
- `ux` — `'generic'` (default) or one of `'site_survey' | 'system_design' |
  'bom_locked' | 'commissioning_form' | 'coc' | 'initial_proposal' |
  'final_proposal'` to swap in a specialized React component

### Cross-lane gates

`CROSS_LANE_GATES[lane.item.targetState]` lists upstream tasks that must be
in their doneState before that transition is allowed. Server enforces. UI
surfaces blockers via `BlockersBanner`. 8 gates currently:

```
operations.materials_ordered.drafted        ← sales.contract_signed + finance.deposit_paid
operations.install_scheduled.date_proposed  ← compliance.distributor_approved + operations.materials_received
operations.commissioning_form.in_progress   ← operations.install_complete
compliance.coc_issued.pending               ← operations.install_complete
finance.final_paid.invoiced                 ← operations.install_complete
sales.proposal_final.drafted                ← engineering.site_survey + engineering.bom_locked
sales.contract_signed.drafted               ← engineering.bom_locked
compliance.distributor_app.drafting         ← engineering.system_design
compliance.distributor_inspect.scheduled    ← operations.commissioning_form
engineering.bom_locked.locked               ← engineering.system_design
engineering.site_survey.scheduled           ← sales.qualification_call
```

### Auto-advance walk

`computeReachableState(itemDef, currentState, fields, laneStatus, lane, item)`
walks the state graph forward step-by-step, validating fields + gates at each
hop. Returns the highest reachable state. The lane PATCH endpoint accepts
`{ auto_advance: true }` to invoke this, eliminating multi-click transitions.

### Lane auto-promotion

Once all gate-keeper items in a lane are done, the lane status auto-promotes
to `'done'` and emits a `lane_completed` audit event. Reopening a gate-keeper
auto-demotes back to `in_progress` and emits `lane_reopened`.

## Adding a new task

1. Add an entry under the appropriate lane in `BASE` of
   `services/pm/laneDefinitions.js`. Provide `key`, `label`, `gateKeeper`,
   `artifactType`, `states`, `initialState`, `doneState`, `transitions`,
   and `schema.fields` (with `requiredAt`).
2. (Optional) Add cross-lane gates if it depends on or unblocks other tasks.
3. (Optional) If the task needs custom UI beyond schema-driven fields,
   create a specialized component in `client/src/pm/components/specialized/`
   and route it via the `ux` marker in `ItemPanel.SpecializedOrGeneric`.

No DB migration needed — task definitions live in code.

## Adding a new project_type

Update `TYPE_OVERRIDES` in `laneDefinitions.js`. Same shape as `BASE`,
under the project_type key. Use `add: [ ... ]` for additional tasks and
`modify: { item_key: { ... } }` for gateKeeper / artifactType tweaks.

## Seed data

```bash
cd server
node scripts/seed-pm-test-projects.js   # idempotent
```

Creates 5 projects covering every workflow state:
1. `Smith family — fresh enquiry` — tests early gates
2. `Patel commercial — qualified, mid-design` — tests Stage-2 + contract gates
3. `Whangarei battery — sold, ordering` — tests install gates / mid-flow
4. `Auckland 12 kW — installed, awaiting commission` — tests Commission flow
5. `Wellington 6.6 kW — commissioned, in fleet` — tests read-only / Reopen

Plus 8 `project_payments` rows so the cashflow zone of the Owner Dashboard
shows real numbers.

## Migrations

```bash
cd server/db
node apply-migration-016.js   # projects_v2 + supporting tables
node apply-migration-017.js   # pm_task_events + pm_task_comments
node apply-migration-018.js   # company_settings + financing_options + proposal_terms
```

All idempotent. Wrapped in BEGIN/ROLLBACK so partial failures don't leave
the schema half-applied.

## Testing locally

```bash
# 1. Backend
cd server && npm run dev      # localhost:5000

# 2. Frontend (separate terminal)
cd client && npm run dev      # localhost:5173

# 3. Browse
# http://localhost:5173/pm                Owner Dashboard
# http://localhost:5173/pm/projects       Project list
# http://localhost:5173/pm/projects/:id   Project detail (5-lane swim view)
# http://localhost:5173/pm/admin          Admin config
# http://localhost:5173/portal            (legacy — unchanged)
```

## Revoking the entire PM tool

If the experiment fails:

```bash
git checkout feature/bill-analysis  # back to pre-PM state
# in Supabase SQL editor:
DROP TABLE IF EXISTS pm_task_comments, pm_task_events,
  project_notifications, project_ppa_contracts,
  project_maintenance_events, project_hardware,
  project_payments, project_artifacts, project_assignments,
  projects_v2,
  proposal_terms, financing_options, company_settings CASCADE;
```

Existing `/portal` and tables are completely untouched throughout. Roll-back
is ~10 minutes.
