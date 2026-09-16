# PRSYS — New Frontend Design Prompt

> **ملاحظة ليك (مش جزء من البرومت):** ابعت الملف ده كله للديزاينر أو الذكاء الاصطناعي اللي هيصمم لك الـ UI.
> لما يرجعلك الملفات، حطها في `Frontend/` وارجعلي، وأنا هعمل الربط مع الـ API.
> البرومت كله بالإنجليزي عشان الذكاء الاصطناعي والدزايررز يشتغلوا عليه بأفضل نتيجة.

---

## 📋 PROMPT (copy everything below this line and send it)

You are a senior product designer + frontend engineer. Design **the complete frontend** for **PRSYS**, a procurement request & approval workflow system. This is a **full UI redesign** — do not clone any existing screens. The result will be ported 1:1 into a Next.js + TypeScript + Tailwind CSS application and wired to a live REST API, so **the data fields, status names, and navigation below are a fixed contract** — use them exactly.

---

### 1. What the product is

PRSYS is an internal B2B web application where employees submit **procurement requests** (hardware, raw materials, utilities, general items), requests flow through a **configurable approval workflow**, and agents/admins track, approve, assign, fulfill and report on them. It is an **enterprise tool**: dense, precise, calm — think Stripe / Linear / n8n quality, NOT a marketing site.

**Roles (who sees what):**

| Role | Description | Main area |
| --- | --- | --- |
| **Self User** (employee) | Submits & tracks their own requests | Dashboard, New Request, My Requests, Request detail |
| **Agent** (procurement) | Professional workspace: reviews, approves, assigns, fulfills, registers POs | Queue dashboard, Requests, Request detail (agent actions), Reports |
| **Super Admin** | Everything + administration | Admin dashboard, Users, Departments, Groups, Forms, Workflows, SLA, Settings |
| *Department Manager* | An **assignment**, not a role — any Self User marked manager of a department also sees their department's requests and approves steps routed to "Department manager" | Same screens as Self User + department queue |

A logged-in user's visible sidebar items and page actions are **permission-gated** (e.g. an employee never sees Users/Forms/Workflows; only users with `REQUEST_APPROVE` see Approvals).

---

### 2. Deliverable format (IMPORTANT — the dev integrates this exactly)

For **each screen**, deliver a **standalone HTML file** that I can open directly in a browser:

1. One folder per screen inside `Frontend/`, named lowercase with underscores, e.g. `Frontend/employee_dashboard/`
2. Inside each folder: `code.html` (the full screen) and `screen.png` (a clean 1440px desktop screenshot of it)
3. `code.html` conventions (same tooling as our previous mockups — **do not change the token names**):
   - `<!DOCTYPE html><html class="light" lang="en">` — light mode only, English only, LTR, no RTL
   - Tailwind via CDN: `<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>` with a `tailwind.config` block whose `colors` are **exactly the token names in §3** (paste the same color map as the previous mockups)
   - Fonts: **Inter** (Google Fonts, weights 400/500/600/700) + **Material Symbols Outlined** icons
   - Use the token-based utility classes exactly: `bg-surface-container-lowest`, `text-on-surface-variant`, `border-surface-variant`, `rounded-xl`, `shadow-sm`, spacing `p-lg / gap-md / p-margin-*`, text scales `font-display / font-headline-md / font-body-md / font-body-sm / font-label-md / font-label-sm`
   - Fill everything with **realistic sample data** (Egyptian/Gulf procurement context: "Laptop — Dell Latitude 5550", "Steel sheet 2mm", "Cement — 50 bags", departments "Procurement", "IT", "Facilities", "Production"). Sample data must use **the exact field names from §6** so the port is mechanical.
   - Buttons/inputs should look interactive (hover states), modals should be shown as open overlays on a dimmed page where relevant, and every screen needs its **empty state** and **loading state** sketched as a small secondary section at the bottom of the same HTML (clearly labelled)
   - Design desktop-first at 1440px; the app shell sidebar collapses below 1024px (show the collapsed state once, in the shell spec)
4. Do **not** invent backend logic, routing, or state. Static sample data inside the HTML is expected.
5. Keep every screen **visually consistent**: same shell (§4), same table style, same badge system, same form style, same spacing rhythm. A reviewer should not be able to tell which screens were designed first.

**Screen list to deliver (one folder each):**

| # | Folder name | Screen |
| --- | --- | --- |
| 1 | `login_screen` | Login |
| 2 | `app_shell_nav` | The shared shell (sidebar + topbar) as a standalone reference — pick the Requests page content as the body |
| 3 | `employee_dashboard` | Dashboard for a Self User (employee) |
| 4 | `agent_queue_dashboard` | Queue dashboard for Agent / approver / dept manager |
| 5 | `admin_dashboard` | Overview dashboard for Super Admin |
| 6 | `new_request_catalog` | "New Request" — choose a form type |
| 7 | `request_form_generic` | The dynamic request form (use a rich sample form, see §5.4) |
| 8 | `requests_list` | Requests table with filters (employee "My Requests" and admin "All Requests" — design both, labelled) |
| 9 | `request_detail_employee` | Request detail as seen by the requester |
| 10 | `request_detail_agent` | Request detail with **agent actions** (assign / register PO / fulfill / complete / cancel) |
| 11 | `request_detail_approver` | Request detail with **approval actions** (approve / reject / request clarification + SLA countdown) |
| 12 | `approvals_queue` | Approvals queue page (pending for me / assigned / decided tabs) |
| 13 | `users_list` | Admin: users table + create/edit user dialog |
| 14 | `user_detail` | Admin: single user detail view (profile, role, department, manager, groups, password reset) |
| 15 | `departments_list` | Admin: departments, expandable rows with member lists, move member in/out |
| 16 | `groups_list` | Admin: groups, expandable rows, inline add/remove members, "Used In" chips |
| 17 | `forms_list` | Admin: form templates table (category, fields count, requests count, status, linked workflow) |
| 18 | `form_builder` | No-code form builder (fields palette, canvas, per-field config, category & visibility, linked workflow) |
| 19 | `form_categories` | Admin: form categories CRUD (name, order, templates count) |
| 20 | `workflows_list` | Admin: workflows table (steps count, active, used-by templates) |
| 21 | `workflow_builder` | Workflow builder — three-panel canvas (tools palette / node canvas / flow & problems panel), see §5.7 |
| 22 | `sla_policies` | Admin: SLA policies table + editor (respond within TTA / resolve within TTR per priority) |
| 23 | `reports_dashboard` | Reports & analytics: KPI cards, status breakdown, by-department, by-requester, aging, fulfillment rate |
| 24 | `system_settings` | Admin settings: roles & permissions matrix (read-only view is fine), system info, audit |
| 25 | `help_page` | Help / FAQ: request statuses glossary, how to submit, how approvals work, contact |

> If you design the three request-detail variants (9–11) as **one page with three labelled states** instead of three folders, that is acceptable — but the action areas must be clearly distinct per role.

---

### 3. Design system (fixed — reuse these exact tokens)

Design language name: **"Systematic Utility"** (see `Frontend/systematic_utility/DESIGN.md` in the repo for the full spec).

- **Palette:** primary `#004ac6` (deep corporate blue) · on-primary `#ffffff` · background/surface `#f8f9fb` · surface-container-lowest `#ffffff` · on-surface `#191c1e` · on-surface-variant `#434655` · outline-variant `#c3c6d7` · error `#ba1a1a` · error-container `#ffdad6` · primary-container `#2563eb` / on-primary-container `#eeefff` · secondary-container `#d0e1fb`. Use the full token set from the previous mockups' `tailwind.config` block.
- **Status colors (semantic badges — pick consistent treatments):**
  - `DRAFT` → neutral gray · `PENDING_APPROVAL` → amber · `APPROVED` → blue · `PO_REGISTERED` → indigo/violet · `FULFILLED` → teal · `COMPLETED` → green · `REJECTED` → red (use `error`/`error-container`) · `CANCELLED` → gray (outlined, muted) · `CLARIFICATION_REQUESTED` → orange
- **Priority:** `LOW` → muted gray · `MEDIUM` → blue · `HIGH` → orange · `URGENT` → red
- **Typography:** Inter. Display 36/700, headline-md 20/600, body-md 14/400 (primary text size for enterprise density), body-sm 13, label-md/label-sm for buttons & table headers (12–13px, medium weight, slight tracking).
- **Radius & elevation:** cards `rounded-xl` + `border border-surface-variant` + `shadow-sm`. Modals `rounded-2xl` + `shadow-xl`. Inputs `rounded-lg h-[40px]`.
- **Density:** enterprise — table row height ~44–48px, 13–14px table text, tight but breathing spacing. No giant hero sections inside the app; the app is 100% utility.
- **Icons:** Material Symbols Outlined, `text-[18px]` in nav/rows, 20px in buttons.
- **Do not** add dark mode, RTL, or a second brand color. Do not use gradients except a very subtle one on the login screen's brand panel.

---

### 4. App shell (shared by every screen — design it once, perfectly)

- **Left sidebar (fixed, 260px, collapsible to 72px icons):**
  - Top: brand — "PRSYS" wordmark + small logomark (a clean geometric mark, blue `primary`).
  - **Navigation groups** (items show only when the user's permissions allow them):
    - *(no group)* **Dashboard** (`/`), **Requests** (`/requests`), **New Request** (`/requests/new`, shown only with `REQUEST_CREATE`)
    - **Approvals** (`/approvals`, badge with the count of pending approvals, shown only with `REQUEST_APPROVE`)
    - **ADMINISTRATION** (Super Admin only): **Users**, **Departments**, **Groups**, **Forms**, **Workflows**, **SLA Policies**
    - **INSIGHTS**: **Reports** (permission-gated)
    - Bottom: **Help**, and a user block (avatar initial, name, role code) + logout icon.
  - Active item: `bg-primary-container` tint + `on-primary-container` text + a 3px left indicator.
- **Topbar (56px, white, hairline border-bottom):** page title (headline-md), search box (global search — searches requests by ID/title/item, users, forms), notification bell with unread dot (dropdown: notification title, message, relative time, link), user menu (profile, Help, Log out).
- **Content area:** `p-margin-desktop` padding on a `#f8f9fb` background; white cards for content blocks.
- **Shared components (define each once, in `app_shell_nav` or a `components` section):**
  - Table (header: label-sm uppercase-ish gray, sortable columns with sort arrows, row hover, checkbox column optional, pagination footer "Showing 1–20 of 134" + page buttons)
  - Status & priority badges (pill, 12px, dot + label — use the §3 color mapping)
  - KPI stat card (icon tile, value 28px, label, small delta/sub-line)
  - Filter bar (search input, selects: status / priority / department / date range, "Clear filters" text button, results count)
  - Dialogs (create/edit entities; confirm-danger with red action button), toast notifications (top-right, success/error variants), empty state (icon + one line + primary action), loading skeleton (gray shimmer rows), inline "only if" / helper text (`body-sm` gray), file chips, avatar initial circles, timeline component (see §5.3).

---

### 5. Screen specifications

#### 5.1 `login_screen`
- Split or centered card layout. Fields: **Email**, **Password** (show/hide), "Forgot password?" link, **Sign in** button (primary, full width), error line (red, 13px) under the form.
- Brand panel: "PRSYS — Procurement & Workflow". Footer: "© 2026 PRSYS · v2".
- Accounts hint (small, muted): demo accounts list — `admin@prsys.local`, `procurement@prsys.local` (agent), `requester@prsys.local` (employee), `manager@prsys.local` (dept manager).

#### 5.2 Dashboards (3 variants — same shell, different content)
- **`employee_dashboard`:** greeting "Welcome back, {first name}" · KPI row (My requests, Pending approval, Approved, Fulfilled) · **"Start a New Request"** card (list of available form types as clickable cards: icon, name, one-line description) · **"My Recent Requests"** table (5 rows: ID & title, form type, date submitted, priority badge, status badge) · optional side card: pending items needing my action.
- **`agent_queue_dashboard`:** KPI row (Pending my approval, Overdue (SLA), Assigned to me, Awaiting PO, Fulfilled this month) · **My Approvals** table (request, requester, department, days pending, SLA remaining countdown, current step, action) · **Assigned to me** section · SLA risk highlight (red left border on overdue rows).
- **`admin_dashboard`:** KPI row (Total requests, Pending, Rejected, Fulfillment rate, Avg. approval time) · status breakdown bar/donut · by-department mini bars · recent activity feed (audit: "Request R-… approved by …", "Workflow updated") · top pending by age.

#### 5.3 `request_detail_*` (core screen — design it three times)
Layout: **breadcrumb** (Requests / R-XXXXXXXX) · header card: reference ID (mono, copyable), title, form type chip, requester (avatar + name + department), date, **priority badge**, **status badge**, total value (sum of items), and a role-dependent **action bar** (see below). Body in two columns (main 2fr / side 1fr):
- **Approval timeline (main, top):** vertical stepper of the workflow steps: each step shows order, step name, who decides (e.g. "IT Department manager", "Role: Finance"), status icon (waiting / in progress with SLA countdown / approved with date+name / rejected with reason / skipped), and the decision comment when present. A "Requester submitted" marker is step 0.
- **Items table (main):** Item (name + code), Qty, Unit price, Line total; footer: **Total**. For non-item forms, show a read-only field value grid instead (2-col label/value).
- **Attachments:** file chips (name, size, download icon).
- **Comments thread (main, bottom):** comment bubbles (name, role tag, time, text) + composer (textarea + Post).
- **Side column:** request meta card (requester, department, manager, form, category, created/updated dates) · **Approval steps summary** (compact list with current step highlighted) · **Audit trail** (time, action e.g. `SUBMITTED / STEP_APPROVED / STEP_REJECTED / ASSIGNED / PO_REGISTERED / RULE_APPLIED`, from→to status, actor, note).
- **Action bar per role:**
  - *Employee:* Edit (only while DRAFT) · Cancel (only while pending) · Print.
  - *Agent:* Assign owner · Register PO (dialog: PO number, date, supplier) · Mark Fulfilled · Mark Completed · Request clarification (dialog) · Cancel · full details drawer.
  - *Approver:* **Approve** (green/primary, optional comment) · **Reject** (red, comment required) · **Request clarification** (orange, comment) · SLA countdown chip ("Due in 3h 12m" or red "Overdue 2h").

#### 5.4 `request_form_generic` (the no-code form, as filled by an employee)
Header: form name + category chip + description. The form is **field-driven** — design it with this rich sample field set to show every control the builder can produce:
- **Reference** (read-only auto: "R-2026-0001") · **Notes** (textarea)
- **Item rows table (built-in):** columns Item (a searchable item picker: shows item code + name + unit, with a dropdown of matches like "ITM-00142 · Dell Latitude 5550 · PCS"), Quantity (number), Unit price (currency, auto-filled from catalog, editable), Line total (computed); "Add item" button; rows removable.
- **Date needed** (date picker) · **Cost center / Department** (select: Production / Facilities / IT / Admin) · **Approver (user picker)**: shows avatar + name + dept in a searchable dropdown · **Urgent?** (checkbox) · **Reason for urgency** (textarea, *shown only when "Urgent" is checked* — show it visible to demonstrate the conditional field) · **Attachments** (file upload dropzone, 2 sample files attached) · **Preferred supplier** (multi-select chips: "Al-Ahly Trading", "Emirates Supply Co.", "Cairo Hardware") · **Contact person** (user picker) · **Email** (email input) · **Phone** (tel input) · **URL / link** (url input)
- Sticky footer bar: **Save as draft** (outlined) + **Submit for approval** (primary) · validation errors shown inline under fields (one field in error state: "Please enter a quantity greater than 0").

#### 5.5 `new_request_catalog`
"New Request — Choose a request type". Grid of form cards: icon, form name (e.g. **Raw Material Request**, **General Items Request**, **Hardware & IT Equipment**, **Utility & Maintenance**, **Service Contract**), category chip, description line, "who approves" hint (e.g. "2 approval steps"). Clicking opens the form. Search box filters by name. Note: only forms the user is allowed to fill appear.

#### 5.6 `requests_list`
Filter bar: global search (ID / title / item), Status (multi), Priority (multi), Department, Date submitted (range), Requester (admin only). Table columns: **Ref / Title**, **Form type**, **Requester**, **Department**, **Date**, **Priority**, **Status**, **Current step** (admin/agent: whose approval is pending), **Total**. Row click → detail. Bulk select (admin): export, cancel. Both variants (My Requests / All Requests) — All Requests has the Requester + Department columns and bulk actions.

#### 5.7 `workflow_builder` (the most complex screen)
Three-panel canvas, n8n / ServiceNow Flow Designer layout:
- **Left — Tools palette (260px):** search box ("/"), grouped tool list, draggable items:
  - *Start:* **Requester submits** (marker node)
  - *Approvals:* **Approval step** (config: who decides — Requester's department manager / Requester's direct manager / Specific person / Group / Role / Any approver; quorum: ANY / ALL / N of M; comment required?; due days; *only if* condition; on approve / on reject behavior)
  - *Actions:* **Set priority** (LOW…URGENT) · **Set ticket status** (COMPLETED / FULFILLED / CLARIFICATION_REQUESTED / CANCELLED) · **Apply SLA policy** (pick policy) · **Assign an owner** (user/role) · **Notify people** (users/groups) · **Jump to a node**
  - *Presets:* e.g. "Approve → set URGENT → apply SLA" (inserts an editable chain)
  - Each tool card: icon, name, one-line description, drag handle.
- **Middle — Canvas:** nodes as rounded cards in flow order. The **Requester submits** marker at top with a single output port; each approval node has two labeled output ports: **"if approved"** (green) and **"if rejected"** (red); actions attach to ports. Drawn connectors (bezier), selected node highlighted, drag-to-reorder. Show a realistic 6-node sample flow.
- **Right — Context panel (320px), tabs:**
  - *Flow:* indented tree of the whole flow (approvals with their action chains)
  - *Readiness / Problems:* list of open issues (e.g. "Step 2 has no approver type", "Action 'Notify' has no recipients") — clicking jumps to the node; green "Flow is ready" state when clean
  - *Forms:* form templates attached to this workflow
- **Top toolbar:** workflow name (editable), **Active/Draft** status chip, Undo/Redo, **Save** (Ctrl+S), unsaved-changes dot, "Publish" (primary).
- Node detail (right panel when a node is selected): name field (default empty — "— choose —" pattern), all settings as labelled selects/chips, "Pause node" toggle.

#### 5.8 `form_builder` (no-code form editor)
Same three-panel idea:
- **Left:** field type palette, grouped: *Basic Input* (Text, Textarea, Email, Phone, URL, File upload) · *Numbers & Dates* (Number, Currency, Date, Time, Date & Time) · *Selection* (Dropdown, Multi-select, Checkbox, Radio) · *Organization* (User picker, Department picker) · *Built-in* (Item rows table, Notes). Each item: icon + label, draggable.
- **Middle — form preview canvas:** a live preview of the form being built (fields rendered exactly like §5.4). Fields are draggable to reorder; selected field highlighted; "Item rows" and "Notes" are locked built-ins.
- **Right — field config (when a field is selected):** Label*, Field key (auto from label, editable once), Type (fixed once created), Required toggle, Placeholder, Help text, min/max / minLength / maxLength / maxFiles, options list (for select/multiselect/radio — add/remove rows), **Show when** rule builder ("Field = value" condition rows), default value.
- **Top:** form name*, description, category select, **Status** (Draft / Active / Archived) + Publish action, **Visibility** tab (Public vs allow-list of departments / groups / users with chips), **Workflow** tab (link an existing workflow or open builder), **Fields** tab (the three-panel builder).
- Show the form in a **mid-edit** state with one field selected (config panel visible) and one *Show when* rule configured.

#### 5.9 Admin CRUD screens (users / departments / groups / forms / categories / workflows / SLA)
All follow the same enterprise pattern — header (title + count + **primary action**), filter bar, table, dialogs:
- **`users_list`:** filters: search (name/email), role, department, account type (Local / Microsoft 365), status. Columns: User (avatar, name, email), Role (chip), Department, Manager (name), Groups (chips, +n), Account type (icon: badge / cloud), Status (Active/Disabled toggle-style badge), Actions (edit, enable/disable, delete). **Create/Edit dialog:** name, email, password (create / optional reset, min 6 chars), role select, department select, direct manager (user picker), groups (multi chips), account type (read-only for Local/AzureAD). Delete confirm shows FK-safety warning ("User has 3 requests — they will be kept, requester shown as 'deleted user'").
- **`user_detail`:** profile card (avatar, name, email, role, dept, manager, groups, status) · **Security** (change password, account type) · **Assignments** (department manager of X, group memberships) · **Activity** (recent audit: logins, actions).
- **`departments_list`:** expandable rows: department name, code, manager, members count; expanded → members table (name, role, is-manager badge) with **move out** and **add member** (user picker). Create/edit dialog: name*, code, manager (user picker). Delete blocked while members exist (show the warning state).
- **`groups_list`:** expandable rows: name, description, members count, **"Used In" chips** (workflow step names + form permission names); expanded → members with inline add (search) / remove. Delete blocked while referenced (warning state shown on one row).
- **`forms_list`:** columns: Form, Category, Fields (count), Status (Active/Draft/Archived chip), Requests (count), Workflow (name chip or "—"), Actions (edit → builder, duplicate, archive, delete-if-unused).
- **`form_categories`:** simple table: name, order (up/down), templates count, actions.
- **`workflows_list`:** columns: Name, Steps (count of approval + action nodes), Status (Active/Draft), Used by (form chips +n), Updated, Actions (edit → builder, duplicate, delete-if-unused).
- **`sla_policies`:** table: policy name, applies to priority, **Respond within (TTA)**, **Resolve within (TTR)**, description, status; editor dialog: name*, priority (LOW/MEDIUM/HIGH/URGENT), TTA (hours), TTR (hours/days), description. Note in UI: policies are matched by the request's **current** priority.

#### 5.10 `reports_dashboard`
KPI row (Total, Approved %, Rejected %, Fulfillment rate, Avg. approval time, Avg. fulfillment time) · filters (date range, department, form type, priority) · charts: status breakdown (donut), requests over time (line, last 12 months), top departments (horizontal bars), top requesters (table), aging buckets (0–3d / 3–7d / 7–30d / 30d+ stacked bar), SLA performance (hit vs missed). Export CSV button.

#### 5.11 `system_settings`
Tabs: **Roles & permissions** (matrix: rows = permissions `REQUEST_CREATE, REQUEST_VIEW_OWN, REQUEST_VIEW_ALL, REQUEST_APPROVE, ASSIGN, FULFILL, PO_REGISTER, USER_VIEW, USER_CREATE, USER_EDIT, USER_DELETE, DEP_VIEW, DEP_MANAGE, GROUP_MANAGE, FORM_TEMPLATE_VIEW, FORM_TEMPLATE_MANAGE, WF_VIEW, WF_MANAGE, SLA_MANAGE, REPORT_VIEW, CATALOG_VIEW, CATALOG_SYNC`; columns = roles `SUPER_ADMIN / AGENT / USER`; SUPER_ADMIN column locked ✓, read-only note "role permissions are managed in the database") · **System** (version, database, seed info, demo accounts table) · **Audit** (recent system actions).

#### 5.12 `help_page`
Two-column: left = section nav (Request statuses, How to submit a request, How approvals work, SLA explained, Administration guide, Troubleshooting, Contact). Right = content: **status glossary table** (all 9 statuses with a one-line meaning each, using the badge colors), step-by-step "submit a request", "what happens when I get a clarification request?", approver guide, agent guide, common problems (e.g. "I don't see a form → ask an admin to grant your department access").

---

### 6. Data contract (fixed vocabulary — do not rename)

**Request status (exact values):** `DRAFT` · `PENDING_APPROVAL` · `APPROVED` · `REJECTED` · `PO_REGISTERED` · `FULFILLED` · `COMPLETED` · `CANCELLED` · `CLARIFICATION_REQUESTED`
**Priority (exact values):** `LOW` · `MEDIUM` · `HIGH` · `URGENT`
**Account types:** `LOCAL` · `AZURE_AD`
**Roles:** `SUPER_ADMIN` · `AGENT` · `USER` (dept manager is an assignment, never a role)
**Field types (form builder):** `text, textarea, email, tel, url, file, number, currency, date, time, datetime, select, multiselect, checkbox, radio, user, department` + built-ins: item rows, notes.

**REST API (already built — the design will be wired to these; keep field names in your sample data):**
- `POST /api/auth/login` `{email, password}` → sets JWT cookie · `GET /api/auth/me` → `{id, name, email, accountType, role:{code,name}, department, permissions[]}`
- `GET /api/dashboard` → `{total, byStatus{pending,approved,poRegistered,fulfilled,rejected,draft,completed,cancelled}, myPendingApprovals, recent[], templates[]}`
- `GET /api/requests?q=&status=&priority=&depId=&requesterId=&from=&to=&page=&pageSize=` → paged list: `{RequestID, Reference, Title, Status, Priority, FormTemplate, Requester, Items[], CreatedAt, UpdatedAt}`
- `POST /api/requests` (submit) · `PUT /api/requests/[id]` (edit draft) · `DELETE /api/requests/[id]` (cancel)
- `GET /api/requests/[id]` → full detail: meta, `Items[]` (`{RequestedItemName, ItemCode, RequestedQuantity, UnitPrice, EstimatedPrice}`), `FieldValues[]`, `Approvals[]` (`{StepName, Decision, Comment, DecidedAt}`), `Comments[]`, `Attachments[]`, `AuditLog[]` (`{Action, FromStatus, ToStatus, Note, ChangedByName}`), `WorkflowSteps[]`, `SLA {ResponseDueAt, ResolveDueAt}`
- `POST /api/requests/[id]/decision` `{decision: APPROVED|REJECTED|CLARIFICATION, comment}` · `POST /api/requests/[id]/assign` · `POST /api/requests/[id]/po` `{poNumber, poDate, supplier}` · `POST /api/requests/[id]/status` `{status}`
- `GET /api/approvals?view=pending|assigned|decided` → queue list + `count`
- `GET /api/form-templates` · `GET /api/form-templates/[id]` (fields with `FieldConfig` JSON: label/type/required/options/showWhen) · `POST/PUT/DELETE /api/form-templates` · `GET/POST/PUT/DELETE /api/form-categories`
- `GET /api/workflows` · `GET /api/workflows/[id]` (steps `{StepName, ApproverType, Quorum, CommentRequired, DueDays, Condition, OnApprove, OnReject}` + rules) · `POST/PUT/DELETE /api/workflows`
- `GET/POST/PUT/DELETE /api/users` (query: `q, roleId, depId, status, accountType, page, pageSize`) · `GET /api/users/lookup?q=`
- `GET/POST/PUT/DELETE /api/departments` (detail includes members) · `GET/POST/PUT/DELETE /api/groups` (members add/remove)
- `GET/POST/PUT/DELETE /api/sla-policies` · `GET /api/roles` (read-only) · `GET /api/catalog?q=` (item search: `{ItemName, ItemCode, Unit, LastPrice}`) · `GET /api/search?q=` (global) · `GET /api/notifications`

**Sample reference IDs:** `R-2026-0041` style. Money: `EGP`. Dates: `12 Sep 2026, 14:32` and relative ("2h ago").

---

### 7. Quality bar

- Consistency across all 25 screens is the #1 requirement (same shell, badges, tables, dialogs, spacing).
- Every interactive object has a visible affordance; destructive actions always open a confirm dialog; every list has empty + loading states.
- The workflow builder must look like a real product (nodes, ports, connectors) — this is the showcase screen, spend the most effort on it.
- Accessible contrast (4.5:1 for body text), 40px touch targets for primary buttons.
- No lorem ipsum — realistic procurement data in English.

Deliver all folders in `Frontend/`, then zip the whole `Frontend/` folder for handoff.
