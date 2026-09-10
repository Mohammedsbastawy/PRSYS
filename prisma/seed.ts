import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ---- Permissions catalogue ----
const PERMISSIONS = [
  // Users & RBAC
  { code: 'USER_VIEW', module: 'USERS', name: 'View Users' },
  { code: 'USER_CREATE', module: 'USERS', name: 'Create User' },
  { code: 'USER_EDIT', module: 'USERS', name: 'Edit User' },
  { code: 'USER_DELETE', module: 'USERS', name: 'Delete User' },
  { code: 'ROLE_MANAGE', module: 'USERS', name: 'Manage Roles & Permissions' },
  { code: 'DEP_VIEW', module: 'ORG', name: 'View Departments' },
  { code: 'DEP_MANAGE', module: 'ORG', name: 'Manage Departments' },
  { code: 'GROUP_MANAGE', module: 'ORG', name: 'Manage Groups' },
  // Forms
  { code: 'FORM_TEMPLATE_VIEW', module: 'FORMS', name: 'View Form Templates' },
  { code: 'FORM_TEMPLATE_MANAGE', module: 'FORMS', name: 'Manage Form Templates' },
  { code: 'FORM_PERMISSION_MANAGE', module: 'FORMS', name: 'Manage Form Permissions' },
  // Workflow
  { code: 'WF_VIEW', module: 'WORKFLOW', name: 'View Workflows' },
  { code: 'WF_MANAGE', module: 'WORKFLOW', name: 'Manage Workflows' },
  { code: 'SLA_MANAGE', module: 'WORKFLOW', name: 'Manage SLA Policies' },
  // Requests
  { code: 'REQUEST_CREATE', module: 'REQUESTS', name: 'Create Request' },
  { code: 'REQUEST_VIEW_OWN', module: 'REQUESTS', name: 'View Own Requests' },
  { code: 'REQUEST_VIEW_ALL', module: 'REQUESTS', name: 'View All Requests' },
  { code: 'REQUEST_APPROVE', module: 'REQUESTS', name: 'Approve/Reject Requests' },
  { code: 'REQUEST_ASSIGN', module: 'REQUESTS', name: 'Assign Requests' },
  { code: 'REQUEST_VERIFY_ITEMS', module: 'REQUESTS', name: 'Verify Request Items' },
  { code: 'REQUEST_REGISTER_PO', module: 'REQUESTS', name: 'Register Oracle PO' },
  { code: 'REQUEST_FULFILL', module: 'REQUESTS', name: 'Fulfill Request (Stock/PO)' },
  // Catalog
  { code: 'CATALOG_VIEW', module: 'CATALOG', name: 'View Item Catalog' },
  { code: 'CATALOG_SYNC', module: 'CATALOG', name: 'Sync Oracle Catalog' },
  // Reports
  { code: 'REPORT_VIEW', module: 'REPORTS', name: 'View Reports' },
  { code: 'AUDIT_VIEW', module: 'REPORTS', name: 'View Audit Log' },
]

// ---- Roles (ticket-system model: osTicket / GLPI style) ----
// Only THREE system roles:
//   SUPER_ADMIN — full platform administration
//   USER        — self-service portal; a USER can be ASSIGNED as the manager of a
//                 department (DEP.ManagerID) and then receives/approves that
//                 department's requests. "Department Manager" is NOT a role.
//   AGENT       — professional workspace to review & process requests
const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', desc: 'Full system access', perms: '*' as const },
  {
    code: 'USER', name: 'Self User',
    desc: 'Self-service portal — create and track own requests. Can be assigned as a department manager.',
    perms: ['REQUEST_CREATE', 'REQUEST_VIEW_OWN', 'CATALOG_VIEW', 'FORM_TEMPLATE_VIEW'],
  },
  {
    code: 'AGENT', name: 'Agent',
    desc: 'Professional workspace — review, approve, assign and fulfill requests',
    perms: ['REQUEST_CREATE', 'REQUEST_VIEW_OWN', 'REQUEST_VIEW_ALL', 'REQUEST_APPROVE', 'REQUEST_ASSIGN',
      'REQUEST_VERIFY_ITEMS', 'REQUEST_REGISTER_PO', 'REQUEST_FULFILL', 'CATALOG_VIEW', 'CATALOG_SYNC',
      'REPORT_VIEW', 'AUDIT_VIEW', 'DEP_VIEW', 'FORM_TEMPLATE_VIEW'],
  },
]

// Legacy roles are migrated onto the new model automatically
const LEGACY_ROLE_MAP: Record<string, string> = {
  REQUESTER: 'USER',
  DEPT_MANAGER: 'USER',
  PROCUREMENT_OFFICER: 'AGENT',
  STOREKEEPER: 'AGENT',
  AUDITOR: 'AGENT',
}

async function main() {
  console.log('🌱 Seeding PRSYS...')

  // 1. Permissions
  console.log('→ Permissions')
  const permMap = new Map<string, string>()
  for (const p of PERMISSIONS) {
    const created = await prisma.permissions.upsert({
      where: { Code: p.code },
      update: { Module: p.module, Name: p.name },
      create: { Code: p.code, Module: p.module, Name: p.name, Description: p.name },
    })
    permMap.set(p.code, created.PermissionID)
  }

  // 2. Roles + role permissions
  console.log('→ Roles')
  for (const r of ROLES) {
    const role = await prisma.roles.upsert({
      where: { Code: r.code },
      update: { Name: r.name, Description: r.desc },
      create: { Code: r.code, Name: r.name, Description: r.desc, IsSystemDefault: true },
    })
    // clear existing perms
    await prisma.rolePermissions.deleteMany({ where: { RoleID: role.RoleID } })
    if (r.perms === '*') {
      for (const pid of Array.from(permMap.values())) {
        await prisma.rolePermissions.create({ data: { RoleID: role.RoleID, PermissionID: pid } })
      }
    } else {
      for (const code of r.perms) {
        const pid = permMap.get(code)
        if (pid) await prisma.rolePermissions.create({ data: { RoleID: role.RoleID, PermissionID: pid } })
      }
    }
  }

  // 2b. Migrate legacy roles onto the ticket-system model
  // ("Department Manager" is an ASSIGNMENT — DEP.ManagerID — never a role)
  console.log('→ Legacy role migration')
  for (const [legacy, target] of Object.entries(LEGACY_ROLE_MAP)) {
    const legacyRole = await prisma.roles.findUnique({ where: { Code: legacy } })
    const targetRole = await prisma.roles.findUnique({ where: { Code: target } })
    if (!legacyRole || !targetRole) continue
    const moved = await prisma.users.updateMany({
      where: { RoleID: legacyRole.RoleID },
      data: { RoleID: targetRole.RoleID },
    })
    if (moved.count > 0) console.log(`   ${legacy} → ${target}: ${moved.count} user(s) migrated`)
    // delete the legacy role only if nothing references it anymore
    try {
      const usersLeft = await prisma.users.count({ where: { RoleID: legacyRole.RoleID } })
      const stepsLeft = await prisma.wFSteps.count({ where: { TargetRoleID: legacyRole.RoleID } })
      if (usersLeft === 0 && stepsLeft === 0) {
        await prisma.rolePermissions.deleteMany({ where: { RoleID: legacyRole.RoleID } })
        await prisma.roles.delete({ where: { RoleID: legacyRole.RoleID } })
        console.log(`   removed legacy role: ${legacy}`)
      }
    } catch {
      console.log(`   kept legacy role: ${legacy} (still referenced)`)
    }
  }

  // 3. Department
  console.log('→ Default Department')
  const dep = await prisma.dEP.upsert({
    where: { Code: 'HQ' },
    update: {},
    create: { Name: 'Headquarters', Code: 'HQ' },
  })

  // 4. Admin user
  console.log('→ Admin User')
  const adminRole = await prisma.roles.findUnique({ where: { Code: 'SUPER_ADMIN' } })
  const existing = await prisma.users.findUnique({ where: { Email: 'admin@prsys.local' } })
  if (!existing) {
    const hash = await bcrypt.hash('Admin@123', 10)
    await prisma.users.create({
      data: {
        Name: 'System Administrator',
        Email: 'admin@prsys.local',
        PasswordHash: hash,
        AccountType: 'LOCAL',
        RoleID: adminRole!.RoleID,
        DEPID: dep.DEPID,
        IsActive: true,
      },
    })
    console.log('   Created admin@prsys.local / Admin@123')
  } else {
    console.log('   Admin already exists')
  }

  // 5. Sample groups
  console.log('→ Groups')
  await prisma.groups.upsert({
    where: { GroupID: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { GroupID: '00000000-0000-0000-0000-000000000001', Name: 'Procurement Team', Description: 'Core procurement staff' },
  })

  // 6. Demo users (dev/test)
  console.log('→ Demo Users')
  const userRole = await prisma.roles.findUnique({ where: { Code: 'USER' } })
  const agentRole = await prisma.roles.findUnique({ where: { Code: 'AGENT' } })
  const demoUsers = [
    // Self User — normal employee, normal interface
    { email: 'requester@prsys.local', name: 'Ahmed Hassan', pass: 'Requester@123', role: userRole },
    // ALSO a plain Self User — but ASSIGNED as department manager (not a role!):
    // sees his own requests + his department's requests and receives approvals
    { email: 'manager@prsys.local', name: 'Mona Adel', pass: 'Manager@123', role: userRole },
    // Agent — professional workspace to process requests
    { email: 'procurement@prsys.local', name: 'Karim Samy', pass: 'Procurement@123', role: agentRole },
  ]
  for (const u of demoUsers) {
    const found = await prisma.users.findUnique({ where: { Email: u.email } })
    if (!found) {
      const hash = await bcrypt.hash(u.pass, 10)
      await prisma.users.create({
        data: {
          Name: u.name,
          Email: u.email,
          PasswordHash: hash,
          AccountType: 'LOCAL',
          RoleID: u.role!.RoleID,
          DEPID: dep.DEPID,
          IsActive: true,
        },
      })
      console.log(`   Created ${u.email} / ${u.pass}`)
    }
  }
  const managerUser = await prisma.users.findUnique({ where: { Email: 'manager@prsys.local' } })
  const requesterUser = await prisma.users.findUnique({ where: { Email: 'requester@prsys.local' } })
  const procUser = await prisma.users.findUnique({ where: { Email: 'procurement@prsys.local' } })
  const procTeam = await prisma.groups.findUnique({ where: { GroupID: '00000000-0000-0000-0000-000000000001' } })
  if (managerUser && requesterUser) {
    // manager@prsys.local stays a plain USER — these ASSIGNMENTS make him a manager
    await prisma.users.update({
      where: { UserID: requesterUser.UserID },
      data: { DirectManagerID: managerUser.UserID },
    })
    await prisma.dEP.update({
      where: { DEPID: dep.DEPID },
      data: { ManagerID: managerUser.UserID },
    }).catch(() => {})
  }
  if (procUser && procTeam) {
    await prisma.groupMembers.upsert({
      where: { GroupID_UserID: { GroupID: procTeam.GroupID, UserID: procUser.UserID } },
      update: {},
      create: { GroupID: procTeam.GroupID, UserID: procUser.UserID },
    })
  }

  // 7. Form categories
  console.log('→ Form Categories')
  const catDefs: Array<[string, number]> = [
    ['Procurement & Operations', 1],
    ['IT & Digital Services', 2],
    ['HR & Employee Support', 3],
  ]
  const catMap = new Map<string, string>()
  for (const [name, order] of catDefs) {
    let c = await prisma.formCategories.findFirst({ where: { Name: name } })
    if (!c) c = await prisma.formCategories.create({ data: { Name: name, SortOrder: order } })
    catMap.set(name, c.FormCategoryID)
  }

  // 8. Standard approval workflow
  // Step 1 → the requester's DEPARTMENT MANAGER (assignment-based routing)
  // Step 2 → the Procurement Team GROUP (osTicket-style team routing)
  console.log('→ Standard Workflow')
  let wf = await prisma.wFDefinitions.findFirst({ where: { Name: 'Standard Procurement Approval' } })
  const team = await prisma.groups.findUnique({ where: { GroupID: '00000000-0000-0000-0000-000000000001' } })
  if (!wf) {
    wf = await prisma.wFDefinitions.create({
      data: {
        Name: 'Standard Procurement Approval',
        Description: "Requester's department manager approval, then Procurement Team review",
        Status: 'ACTIVE',
        Steps: {
          create: [
            { StepName: 'Department Manager Approval', StepOrder: 1, ApproverType: 'DEPARTMENT_MANAGER', ApprovalMode: 'ANY_ONE', RejectAction: 'RETURN_TO_REQUESTER', DueDays: 3 },
            { StepName: 'Procurement Review', StepOrder: 2, ApproverType: 'GROUP', TargetGroupID: team?.GroupID ?? null, ApprovalMode: 'ANY_ONE', RejectAction: 'REJECT_COMPLETELY', DueDays: 5 },
          ],
        },
      },
    })
  } else {
    // migrate legacy role-targeted steps to assignment-based routing
    const s1 = await prisma.wFSteps.findFirst({ where: { WFDefinitionID: wf.WFDefinitionID, StepOrder: 1 } })
    if (s1 && s1.ApproverType !== 'DEPARTMENT_MANAGER') {
      await prisma.wFSteps.update({
        where: { WFStepID: s1.WFStepID },
        data: { StepName: 'Department Manager Approval', ApproverType: 'DEPARTMENT_MANAGER', TargetRoleID: null, TargetUserID: null, TargetGroupID: null },
      })
      console.log('   migrated step 1 → DEPARTMENT_MANAGER')
    }
    const s2 = await prisma.wFSteps.findFirst({ where: { WFDefinitionID: wf.WFDefinitionID, StepOrder: 2 } })
    if (s2 && s2.ApproverType === 'ROLE' && team) {
      await prisma.wFSteps.update({
        where: { WFStepID: s2.WFStepID },
        data: { ApproverType: 'GROUP', TargetGroupID: team.GroupID, TargetRoleID: null },
      })
      console.log('   migrated step 2 → Procurement Team group')
    }
  }

  // 8b. Workflow v2 — manager must explain a return/rejection, demo automation rule
  const step1 = await prisma.wFSteps.findFirst({ where: { WFDefinitionID: wf.WFDefinitionID, StepOrder: 1 } })
  if (step1 && (step1.CommentPolicy ?? 'OPTIONAL') !== 'ON_REJECT') {
    await prisma.wFSteps.update({ where: { WFStepID: step1.WFStepID }, data: { CommentPolicy: 'ON_REJECT' } })
    console.log('   step 1 CommentPolicy → ON_REJECT (managers must explain returns)')
  }
  const demoRule = await prisma.wFRules.findFirst({ where: { WFDefinitionID: wf.WFDefinitionID, Name: 'Large purchase escalates priority' } })
  if (!demoRule) {
    await prisma.wFRules.create({
      data: {
        WFDefinitionID: wf.WFDefinitionID,
        Name: 'Large purchase escalates priority',
        Trigger: 'ON_SUBMIT',
        Condition: JSON.stringify({ field: 'totalValue', op: '>=', value: '50000' }),
        Action: 'SET_PRIORITY',
        ActionValue: JSON.stringify({ priority: 'HIGH' }),
        SortOrder: 1,
      },
    })
    console.log('   demo rule: ON_SUBMIT totalValue >= 50000 → priority HIGH')
  }

  // 8c. Default SLA policy (TTA/TTR per priority, in minutes)
  console.log('→ Default SLA Policy')
  const slaTargets = [
    { Priority: 'LOW', ResponseMins: 24 * 60, ResolveMins: 72 * 60 },        // 24h / 72h
    { Priority: 'MEDIUM', ResponseMins: 8 * 60, ResolveMins: 48 * 60 },      // 8h / 48h
    { Priority: 'HIGH', ResponseMins: 4 * 60, ResolveMins: 24 * 60 },        // 4h / 24h
    { Priority: 'URGENT', ResponseMins: 1 * 60, ResolveMins: 8 * 60 },       // 1h / 8h
  ]
  let sla = await prisma.sLAPolicies.findFirst({ where: { IsDefault: true } })
  if (!sla) {
    sla = await prisma.sLAPolicies.create({
      data: {
        Name: 'Standard SLA',
        Description: 'Platform default response & resolution targets by request priority',
        IsDefault: true,
        Targets: { create: slaTargets },
      },
    })
    console.log('   created "Standard SLA" (LOW 24/72h · MEDIUM 8/48h · HIGH 4/24h · URGENT 1/8h)')
  } else {
    for (const t of slaTargets) {
      await prisma.sLATargets.upsert({
        where: { SLAPolicyID_Priority: { SLAPolicyID: sla.SLAPolicyID, Priority: t.Priority } },
        update: { ResponseMins: t.ResponseMins, ResolveMins: t.ResolveMins },
        create: { SLAPolicyID: sla.SLAPolicyID, ...t },
      })
    }
  }

  // 9. Request form templates
  console.log('→ Form Templates')
  interface SeedField { label: string; key: string; type: string; req: boolean; options?: string[]; config?: string | null }
  interface SeedTemplate { name: string; prefix: string; desc: string; cat: string; fields: SeedField[] }
  const templates: SeedTemplate[] = [
    {
      name: 'Raw Material Request', prefix: 'RM', desc: 'Specify raw material requirements and quantity for production.', cat: 'Procurement & Operations',
      fields: [
        { label: 'Department / Cost Center', key: 'department', type: 'text', req: true },
        { label: 'Required By Date', key: 'requiredByDate', type: 'date', req: false },
        { label: 'Justification', key: 'justification', type: 'textarea', req: false },
      ],
    },
    {
      name: 'General Items Request', prefix: 'GI', desc: 'Request items not found in the standard material catalog.', cat: 'Procurement & Operations',
      fields: [
        { label: 'Department', key: 'department', type: 'text', req: true },
        { label: 'Needed By Date', key: 'neededByDate', type: 'date', req: false },
        { label: 'Justification / Details', key: 'justification', type: 'textarea', req: true },
        { label: 'Supporting Quotation', key: 'quotation', type: 'file', req: true, config: '{"maxFiles":3,"maxSizeMB":10,"accept":"pdf,jpg,jpeg,png"}' },
      ],
    },
    {
      name: 'General Supply Request', prefix: 'GS', desc: 'Order basic office and facility supplies.', cat: 'Procurement & Operations',
      fields: [
        { label: 'Department', key: 'department', type: 'text', req: false },
        { label: 'Delivery Location', key: 'deliveryLocation', type: 'text', req: false },
        { label: 'Justification', key: 'justification', type: 'textarea', req: true },
      ],
    },
    {
      name: 'Lab Equipment Repair', prefix: 'LER', desc: 'Request maintenance or fix for laboratory devices.', cat: 'Procurement & Operations',
      fields: [
        { label: 'Equipment ID', key: 'equipmentId', type: 'text', req: true },
        { label: 'Issue Description', key: 'issueDescription', type: 'textarea', req: true },
        { label: 'Urgency', key: 'urgency', type: 'select', req: false, options: ['Low', 'Medium', 'High', 'Critical'] },
      ],
    },
    {
      name: 'Chemical Reagent Order', prefix: 'CR', desc: 'Procure approved chemical reagents for lab use.', cat: 'Procurement & Operations',
      fields: [
        { label: 'Lab Location', key: 'labLocation', type: 'text', req: false },
        { label: 'Safety Approval Ref', key: 'safetyRef', type: 'text', req: false },
        { label: 'Justification', key: 'justification', type: 'textarea', req: true },
      ],
    },
    {
      name: 'New Software License', prefix: 'SW', desc: 'Request access or licenses for specific software tools.', cat: 'IT & Digital Services',
      fields: [
        { label: 'Software Name', key: 'softwareName', type: 'text', req: true },
        { label: 'License Type', key: 'licenseType', type: 'select', req: false, options: ['Perpetual', 'Subscription', 'Trial'] },
        { label: 'Number of Seats', key: 'seats', type: 'number', req: false },
      ],
    },
    {
      name: 'Hardware Replacement', prefix: 'HW', desc: 'Report broken IT hardware and request replacements.', cat: 'IT & Digital Services',
      fields: [
        { label: 'Asset Tag', key: 'assetTag', type: 'text', req: true },
        { label: 'Issue Description', key: 'issueDescription', type: 'textarea', req: true },
        { label: 'Replacement Type', key: 'replacementType', type: 'select', req: false, options: ['Same Model', 'Upgrade', 'Any Available'] },
      ],
    },
    {
      name: 'Travel Authorization', prefix: 'TR', desc: 'Request approval for business-related travel.', cat: 'HR & Employee Support',
      fields: [
        { label: 'Destination', key: 'destination', type: 'text', req: true },
        { label: 'Travel Dates', key: 'travelDates', type: 'text', req: true },
        { label: 'Purpose', key: 'purpose', type: 'textarea', req: true },
        { label: 'Estimated Cost', key: 'estimatedCost', type: 'currency', req: false, config: '{"currency":"EGP"}' },
      ],
    },
  ]
  for (const t of templates) {
    const exists = await prisma.formTemplates.findFirst({ where: { Name: t.name } })
    if (exists) {
      console.log(`   skip (exists): ${t.name}`)
      continue
    }
    await prisma.formTemplates.create({
      data: {
        Name: t.name,
        Description: t.desc,
        FormCategoryID: catMap.get(t.cat)!,
        WFDefinitionID: wf.WFDefinitionID,
        Status: 'ACTIVE',
        IdPrefix: t.prefix,
        IdSeparator: '-',
        IdPadding: 4,
        Fields: {
          create: t.fields.map((f, i) => ({
            Label: f.label,
            FieldKey: f.key,
            FieldType: f.type,
            IsRequired: f.req,
            SortOrder: i + 1,
            Config: f.options ? JSON.stringify({ options: f.options }) : (f.config ?? null),
          })),
        },
      },
    })
    console.log(`   Created: ${t.name}`)
  }

  // 10. Oracle catalog cache (demo items)
  console.log('→ Catalog Items')
  const catalogItems = [
    { oracle: 'ORC-100001', code: 'RM-9002', name: 'Sodium Chloride, USP Grade', uom: 'KG', org: 'MFG-CAIRO', price: 12.5 },
    { oracle: 'ORC-100002', code: 'RM-9003', name: 'Sodium Hydroxide, 1N', uom: 'L', org: 'MFG-CAIRO', price: 8.75 },
    { oracle: 'ORC-100003', code: 'RM-9004', name: 'Sodium Carbonate', uom: 'KG', org: 'MFG-CAIRO', price: 6.2 },
    { oracle: 'ORC-100004', code: 'RM-9005', name: 'Buffer Solution pH 7', uom: 'L', org: 'LAB-GIZA', price: 15.0 },
    { oracle: 'ORC-200001', code: 'IT-1101', name: 'Laptop 14in i7 16GB', uom: 'Piece', org: 'IT-CAIRO', price: 18500 },
    { oracle: 'ORC-200002', code: 'IT-1102', name: 'Monitor 27in', uom: 'Piece', org: 'IT-CAIRO', price: 7200 },
    { oracle: 'ORC-200003', code: 'IT-1103', name: 'Docking Station USB-C', uom: 'Piece', org: 'IT-CAIRO', price: 3400 },
    { oracle: 'ORC-300001', code: 'OF-2201', name: 'A4 Paper Box (5 reams)', uom: 'Box', org: 'ADM-CAIRO', price: 650 },
    { oracle: 'ORC-300002', code: 'OF-2202', name: 'Toner Cartridge', uom: 'Piece', org: 'ADM-CAIRO', price: 2100 },
    { oracle: 'ORC-400001', code: 'SRV-3301', name: 'Equipment Calibration Service', uom: 'Service', org: 'QA-CAIRO', price: 5000 },
  ]
  for (const it of catalogItems) {
    await prisma.itemCatalogCache.upsert({
      where: { ItemCode: it.code },
      update: { ItemName: it.name, Uom: it.uom, OrganizationCode: it.org, LastPurchasedPrice: it.price },
      create: { OracleItemID: it.oracle, ItemCode: it.code, ItemName: it.name, Uom: it.uom, OrganizationCode: it.org, LastPurchasedPrice: it.price },
    })
  }

  console.log('✅ Seed complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
