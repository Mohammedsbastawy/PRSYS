This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Frontend design system

The UI follows the **"Warm Slate & Tangerine"** design system (Hanken Grotesk + JetBrains Mono,
tangerine `#a33900` accent on warm stone/slate neutrals). Full token spec:
`Frontend/warm_slate_tangerine/DESIGN.md`. Stitch screen mockups live in the other
`Frontend/prsys_*` folders; Tailwind tokens are defined in `tailwind.config.ts` with the same
names as the mockups so ports stay 1:1.

---

## PRSYS — Administration (Users / Departments / Groups)

Full professional CRUD for the **Users & Permissions** admin section.

### Pages
| Page | Capabilities |
| --- | --- |
| `/users` | Paginated search (name/email), filters (department, role, account type, status), create/edit user, activate/deactivate, delete (with FK-safety guards), role / department / manager assignment |
| `/departments` | Expandable rows with member lists, create/edit (name, code, manager), safe delete (blocked while members exist), move members in/out of a department |
| `/groups` | Expandable rows, inline member add/remove with search, "Used In" chips (workflows & form permissions), delete blocked while referenced |

### API endpoints added
- `PUT/DELETE /api/departments/[id]`, `GET /api/departments/[id]` (detail + members)
- `PUT/DELETE /api/groups/[id]`, `POST/DELETE /api/groups/[id]/members`
- Enhanced `/api/users` — query params `q`, `roleId`, `depId`, `status`, `accountType`, `page`, `pageSize`; returns the user's real department, manager, managed department and groups

Permissions honoured: `USER_VIEW / USER_CREATE / USER_EDIT / USER_DELETE`, `DEP_MANAGE`, `GROUP_MANAGE` (SUPER_ADMIN bypasses all).

### Local setup
```bash
npm install
# .env: DATABASE_URL="mysql://user:pass@host:3306/prsys"  +  JWT_SECRET
npx prisma generate
npx prisma db push
npm run db:seed        # creates admin@prsys.local / Admin@123 + demo roles/users
npm run dev
```

### Workflow builder (`/workflows/[id]`)

A visual, n8n-style canvas built on **@xyflow/react** (React Flow) — three panels:

| Panel | What it holds |
| --- | --- |
| **Nodes** (left) | searchable palette — drag a node onto the canvas at any point, or click to add it at the end of the flow; preset starters below |
| **Canvas** (middle) | the flow itself: drag nodes anywhere, drag a coloured port to connect, click a node to configure it; undo/redo + fit-view toolbar, minimap, dot grid |
| **Config / Readiness / Forms** (right) | settings for the selected node (with a live "runs after / leads to" summary), the list of open problems (click one to jump to the node), and the attached forms |

Node kinds:

* **Request submitted** (trigger) — the moment a request enters the queue; its port feeds everything that runs at submit. One per flow, cannot be deleted.
* **Approval / decision** — who decides (dept manager, direct manager, one person, group, role, any approver) plus an *only if* gate. It exposes two coloured output ports — **approved** (green) and **rejected** (red) — and whatever you wire to them runs on that answer.
* **Actions** — Set priority · Set ticket status · Apply SLA policy · Assign an owner / a group / a department · Notify people · Jump to a node. One input, one output, each with its own *only if* condition.
* **End · approved / rejected** — terminals that accept **several** inputs; every approved path should end in one, every rejected path in the other.

Connection rules (enforced while you drag, with a hint when refused): no loops, a node takes one input (end nodes excepted), one wire per output port (re-wiring replaces the old one), nothing feeds into the start, and an approval can never be reached through a *rejected* port.

**Two stores, one source of truth.** The canvas (node positions + wiring) is saved as `WFDefinitions.CanvasJson`
(TEXT), but the engine still runs on `WFSteps` / `WFRules` — on every save `src/lib/workflow-graph.ts` (pure,
round-trip tested, no React) derives both from the graph, so they can never drift:

* approval nodes → `WFSteps` in execution order · action nodes → `WFRules` whose trigger is the edge that feeds the
  node: start → `ON_SUBMIT`, an approval's green port → `ON_STEP_APPROVED` (bound by `ActionValue.fireOnStepOrder`),
  red port → `ON_STEP_REJECTED`; chains of actions keep their step, the "End" terminals carry `ON_REQUEST_APPROVED` /
  `ON_REQUEST_REJECTED`.
* **`npx prisma db push` is required once** for the new `CanvasJson` column.
* Legacy workflows (no `CanvasJson` yet) load by deriving a graph from their saved steps/rules — deterministic
  layout, hidden legacy settings (approval mode, due days, comment policy, on-approve/on-reject, jump targets)
  carried through unchanged and re-saved with the canvas on first save.
* Statuses an action may write: `DRAFT`, `PO_REGISTERED`, `COMPLETED`, `FULFILLED`, `CLARIFICATION_REQUESTED`,
  `CANCELLED` — `PENDING_APPROVAL`/`APPROVED`/`REJECTED` stay owned by the approval engine.
* Preset starters (e.g. *approve → set URGENT → apply SLA*) are **spliced into the end of the flow** with editable,
  empty payloads; they wire nodes only.
* Editing aids: undo/redo of structure (Ctrl+Z / Ctrl+Shift+Z), fit-to-view, `/` focuses the node search, Delete
  removes the selected node, Ctrl/Cmd+S saves, and an unsaved-changes badge + unload guard track the diff against
  the last save.

### Lost the admin password?

`prisma/seed.ts` never overwrites an existing admin (it logs "Admin already exists"), so re-seeding will **not** restore
`Admin@123`. Reset the hash instead — the app verifies with `bcrypt.compare` (`src/lib/auth.ts`, rounds = 10):

```bash
npm run db:reset-password -- --list                                  # see admin accounts + who has a hash
npm run db:reset-password -- admin@prsys.local 'NewPass@123'          # set a new password
npm run db:reset-password -- admin@prsys.local 'NewPass@123' --enable # also reactivate a disabled account
```

Prefer the UI if any `SUPER_ADMIN` account still works: `/users` → edit user → set password (`PUT /api/users/[id]`, min 6 chars).

### "No permission" when an employee opens a form (two independent gates)

Access to a request form is gated twice — a form marked **Public** only clears the second one:

| Gate | Where it's enforced | Symptom | Fix |
| --- | --- | --- | --- |
| **1 · Role permission** | `REQUEST_CREATE` on the user's role (`/requests/new` page, `POST /api/requests`) | *"No permission — Your account is not allowed to create requests"* | grant **Create Request** to the role (`USER` / `Self User` already have it in `prisma/seed.ts`) |
| **2 · Form visibility** | `FormPermissions` rows with `PermissionType = 'VIEW'` (`src/lib/form-visibility.ts`) — no rows = Public | *"No access to this form"* (403 on the fill page) | publish the form (`Status = ACTIVE`) and/or add the department/group/user to its allow-list |

Diagnose either user without touching the DB:

```bash
npm run db:check-access -- requester@prsys.local                      # gate 1
npm run db:check-access -- requester@prsys.local 'Hardware Request'  # gate 1 + gate 2
npm run db:check-access -- requester@prsys.local --grant REQUEST_CREATE   # writes the missing grant
```

Note: there is no UI/API to edit role permissions (`/api/roles` is read-only), and permissions are read at
login/page-load (from `GET /api/auth/me`), so after granting one the employee must **reload the page**.

### Approval routing rules (who decides a step)

`src/lib/workflow-targets.ts` resolves a step's approvers at read time, so fixing the org data unblocks
parked requests without touching the request:

| Step type | Resolves to | Fallback when empty |
| --- | --- | --- |
| Requester's direct manager (`REQUESTER_MANAGER`) | `Users.DirectManagerID` | the requester's department manager (`DEP.ManagerID`) |
| Requester's department manager (`DEPARTMENT_MANAGER`) | `DEP.ManagerID` of the requester's department | the requester's `DirectManagerID` |
| Role / Group / Specific user | members of that role (active users), group members, the user | none |
| Any approver (`ANY_APPROVER`) | everyone holding `REQUEST_APPROVE` | none |

Two invariants:

- **Super Admins never decide a step.** They see everything (queue is read-only, labelled *view only*) and fix
  routing, but Approve/Reject appear only for the user the step actually resolves to — including when an admin
  is that user in their capacity as a department manager. `ASSIGN`, publishing, workflow editing etc. are unaffected.
- **A step with no resolvable approver is never auto-passed.** It stays `PENDING_APPROVAL`, writes a
  `STEP_UNASSIGNED` audit entry and notifies the Super Admins. (`ALL`-approval steps used to complete vacuously
  when their target list was empty, silently skipping a whole approval level.)

### Access model (ticket-system style)

Three roles only — **Super Admin**, **Agent** (professional workspace: review/approve/assign/fulfill), **Self User** (portal: own requests). *Department Manager* is an **assignment** (`DEP.ManagerID`), not a role: any Self User assigned as manager sees their department's requests and approves steps routed with the **DEPARTMENT_MANAGER** approver type — seeded workflow migrates legacy role-based steps automatically, and legacy roles (REQUESTER, DEPT_MANAGER, …) are reassigned to USER/AGENT on `npm run db:seed`.

Demo accounts after seeding: `admin@prsys.local / Admin@123` (admin) · `requester@prsys.local / Requester@123` (self user) · `manager@prsys.local / Manager@123` (self user + dept manager assignment) · `procurement@prsys.local / Procurement@123` (agent)
