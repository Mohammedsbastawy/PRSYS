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
