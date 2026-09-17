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

A three-panel canvas built the way n8n / ServiceNow Flow Designer lay it out, and **nothing is pre-created**:

| Panel | What it holds |
| --- | --- |
| **Tools** (left) | searchable, grouped palette — drag a tool onto the canvas, or click it to append |
| **Canvas** (middle) | your nodes, in the order you dropped them; drag to reorder, drag into a port to attach |
| **Flow / Readiness / Forms** (right) | a tree of the flow, the list of open problems (click one to jump to the node), and the attached forms |

Tools available on the palette (`src/lib/workflow-tools.ts`):

* **Requester submits** — a marker node with no settings; drop actions on its port to run them at submit time.
* **Nothing is pre-selected.** A new node has no name, no approver type, no trigger and no payload value: every
  select opens on `— choose —` / `not set`, and the priority chips highlight nothing until you pick. A flow
  does not have to start with an approver at all — automations hanging on the submit marker are a complete workflow
  (zero `WFSteps` rows).
* Unchosen optional fields (quorum / approval mode, comment policy, due days) are **omitted** from the payload so the
  API's documented default applies, and `apiToNodes` maps those defaults back to an empty box instead of showing a
  value you never picked. Quorum, comment policy, due days and approve/reject routing are deliberately **not exposed
  in the UI**: any one approver is enough (the default), comments stay optional, due time is controlled by an
  **Apply SLA policy** step, approving moves on to the next node and rejecting ends the request; redirecting is done
  with a **Jump to a node** tool instead. Saved values for all of these still round-trip unchanged. Same for the
  name: `WFSteps.StepName` cannot be empty, so an unnamed approval gets a label derived from who decides
  (`Department manager approval`) at save time and loads back as an empty box.
* The only two mandatory picks are **who decides** (an approval node) and **when it runs** (an action node);
  anything else left unset is reported at save time rather than guessed for you.
* Presets in the palette wire **ports only** — they never fill in a priority, a policy or a name.
* **Approval / decision** — who decides (requester's dept manager, direct manager, one person, group, role, any
  approver) and an *only if* gate. It exposes two drop ports — **if approved**
  (green) and **if rejected** (red), each with a **+ add** button (or drag) — and nothing runs there until you drop
  a tool on them. Approving continues to the next node; rejecting ends the request. Due time comes from an
  **Apply SLA policy** step, not from the approval itself.
* **Set priority**, **Set ticket status**, **Apply SLA policy**, **Assign an owner**, **Notify people** — one action
  each, with their own *only if* condition.
* **Jump to a node** — move the approval chain elsewhere (a Jump stops the rest of its group).
* Optional **presets** at the bottom of the palette insert an editable chain (e.g. *approve → set URGENT → apply
  SLA*); they are never applied on their own.

How it maps to the database (`src/lib/workflow-builder.ts`, React-free and round-trip stable):

* approval nodes → `WFSteps` in canvas order · action nodes → `WFRules` · the submit marker → nothing on its own.
* the port a node sits in *is* its trigger: `ON_SUBMIT`, `ON_STEP_APPROVED`/`ON_STEP_REJECTED` bound to that step
  through `ActionValue.fireOnStepOrder` (so a node follows its approval when you drag it to another one), both
  ports at once = two rows that merge back into one node, and the two end-of-request ports = `ON_REQUEST_APPROVED`
  / `ON_REQUEST_REJECTED`. Rules never bound to a step stay flow-wide, which is how pre-existing rules load.
* `Apply SLA policy` re-snapshots `SLAPolicyID`, `ResponseDueAt`, `ResolveDueAt` from the target matching the
  request's *current* priority — so “approve → URGENT → 1h/8h clock” works as one chain in order.
* `Set ticket status` may write `DRAFT` (returns the request to the requester — the open step is dropped and they
  re-edit + resubmit), `PO_REGISTERED`, `COMPLETED`, `FULFILLED`, `CLARIFICATION_REQUESTED` (the requester is
  notified) or `CANCELLED`; `PENDING_APPROVAL`/`APPROVED`/`REJECTED` are rejected by the API because the approval
  engine owns them (a rule may never fake an approver's decision, and "pending" is set automatically on submit).
* **No schema change** — everything rides in existing columns and the `ActionValue` JSON, so no `prisma db push`.
* Editing aids: undo/redo of structure (Ctrl+Z / Ctrl+Shift+Z), `/` focuses the tool search, Delete removes the
  selected node, Ctrl/Cmd+S saves, pausing a node keeps it as an inactive rule instead of deleting it, and an
  unsaved-changes badge + unload guard track the diff against the last save.

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
