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

// ---- Roles ----
const ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', desc: 'Full system access', perms: '*' as const },
  { code: 'REQUESTER', name: 'Requester', desc: 'Can create and track requests', perms: ['REQUEST_CREATE', 'REQUEST_VIEW_OWN', 'CATALOG_VIEW', 'FORM_TEMPLATE_VIEW'] },
  { code: 'DEPT_MANAGER', name: 'Department Manager', desc: 'Approves department requests', perms: ['REQUEST_CREATE', 'REQUEST_VIEW_OWN', 'REQUEST_VIEW_ALL', 'REQUEST_APPROVE', 'CATALOG_VIEW', 'FORM_TEMPLATE_VIEW', 'REPORT_VIEW'] },
  { code: 'PROCUREMENT_OFFICER', name: 'Procurement Officer', desc: 'Handles PO and fulfillment', perms: ['REQUEST_VIEW_ALL', 'REQUEST_ASSIGN', 'REQUEST_VERIFY_ITEMS', 'REQUEST_REGISTER_PO', 'REQUEST_FULFILL', 'CATALOG_VIEW', 'CATALOG_SYNC', 'REPORT_VIEW'] },
  { code: 'STOREKEEPER', name: 'Storekeeper', desc: 'Manages stock issue', perms: ['REQUEST_VIEW_ALL', 'REQUEST_FULFILL', 'CATALOG_VIEW', 'REPORT_VIEW'] },
  { code: 'AUDITOR', name: 'Auditor', desc: 'Read-only audit access', perms: ['REQUEST_VIEW_ALL', 'REPORT_VIEW', 'AUDIT_VIEW', 'FORM_TEMPLATE_VIEW'] },
]

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
  const reqRole = await prisma.roles.findUnique({ where: { Code: 'REQUESTER' } })
  const mgrRole = await prisma.roles.findUnique({ where: { Code: 'DEPT_MANAGER' } })
  const procRole = await prisma.roles.findUnique({ where: { Code: 'PROCUREMENT_OFFICER' } })
  const demoUsers = [
    { email: 'requester@prsys.local', name: 'Ahmed Hassan', pass: 'Requester@123', role: reqRole },
    { email: 'manager@prsys.local', name: 'Mona Adel', pass: 'Manager@123', role: mgrRole },
    { email: 'procurement@prsys.local', name: 'Karim Samy', pass: 'Procurement@123', role: procRole },
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
  if (managerUser && requesterUser) {
    await prisma.users.update({
      where: { UserID: requesterUser.UserID },
      data: { DirectManagerID: managerUser.UserID },
    })
    await prisma.dEP.update({
      where: { DEPID: dep.DEPID },
      data: { ManagerID: managerUser.UserID },
    }).catch(() => {})
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
  console.log('→ Standard Workflow')
  let wf = await prisma.wFDefinitions.findFirst({ where: { Name: 'Standard Procurement Approval' } })
  if (!wf) {
    wf = await prisma.wFDefinitions.create({
      data: {
        Name: 'Standard Procurement Approval',
        Description: 'Department manager approval followed by procurement review',
        Status: 'ACTIVE',
        Steps: {
          create: [
            { StepName: 'Department Manager Approval', StepOrder: 1, ApproverType: 'ROLE', TargetRoleID: mgrRole!.RoleID, ApprovalMode: 'ANY_ONE', RejectAction: 'REJECT_COMPLETELY' },
            { StepName: 'Procurement Review', StepOrder: 2, ApproverType: 'ROLE', TargetRoleID: procRole!.RoleID, ApprovalMode: 'ANY_ONE', RejectAction: 'REJECT_COMPLETELY' },
          ],
        },
      },
    })
  }

  // 9. Request form templates
  console.log('→ Form Templates')
  interface SeedField { label: string; key: string; type: string; req: boolean; options?: string[] }
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
        { label: 'Estimated Cost', key: 'estimatedCost', type: 'number', req: false },
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
            Config: f.options ? JSON.stringify({ options: f.options }) : null,
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
