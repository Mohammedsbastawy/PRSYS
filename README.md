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

The editor is a **blank canvas**: nothing is created for you. Every block is yours — you add it, you name it, you
drag it into position. Two kinds of block:

| Block | What it is | Stored as |
| --- | --- | --- |
| **Approval** | who decides (department manager / direct manager / group / role / one person), quorum, comment policy, due days, what happens on approve and on reject, and when the block applies at all | one `WFSteps` row, `StepOrder` = its position among approval blocks |
| **Automation** | one action — set priority · apply an SLA policy · assign an owner · notify people · jump to a block — plus its own *Runs after* and its own condition | one `WFRules` row (`ActionValue` carries the payload) |

* An automation block decides **when it runs** by where it sits and what you pick in *Runs after*:
  `after the block above it` (bound to that approval, approve / reject / both), `after any approval block`,
  `when the request is submitted`, `after final approval`, `after final rejection`.
* Dragging a block between approvals **re-targets** it automatically — the binding is the nearest approval block
  above it, recomputed on every save. Steps can be duplicated, reordered (drag or ↑/↓), paused, and deleted.
* `Apply an SLA policy` (`SET_SLA`) re-snapshots `SLAPolicyID`, `ResponseDueAt`, `ResolveDueAt` from the policy
  target matching the request's *current* priority, so “approve → set URGENT → apply the 1h/8h clock” works as one
  chain, in the order the blocks are written (the SLA block sees the priority the block above it just set).
* Mapping lives in `src/lib/workflow-builder.ts` (`blocksToApi` / `apiToBlocks`) — React-free and round-trip
  stable, so a saved canvas reloads exactly as it was written.
* The right rail holds the flow map, a **Readiness** checklist (every issue focuses and opens the block that causes
  it) and the attached-forms picker. `Ctrl/Cmd+S` saves, and an *unsaved changes* badge + unload guard track the diff.
* No schema change: automation stays in `WFRules`, step bindings ride inside `ActionValue.fireOnStepOrder`, so
  nothing needs `prisma db push`. Old rules that were never bound to a step keep running flow-wide and load as
  “after any approval block” instead of disappearing.

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
