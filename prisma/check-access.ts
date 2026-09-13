/**
 * PRSYS — diagnose "No permission" for one user (+ optionally one form).
 *
 * Explains which of the two INDEPENDENT gates blocked them:
 *   gate 1 (RBAC):      does their ROLE grant REQUEST_CREATE?  → the /requests/new page + POST /api/requests
 *   gate 2 (visibility): does the FORM's VIEW ACL allow them?  → the catalog entry + the fill page (403)
 * A "Public" form only clears gate 2 — it can never grant gate 1.
 *
 * Usage (repo root, .env with DATABASE_URL required):
 *   npm run db:check-access -- requester@prsys.local
 *   npm run db:check-access -- requester@prsys.local 'Hardware Request'
 *   npm run db:check-access -- requester@prsys.local --grant REQUEST_CREATE
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const GATE_PERMS = ['REQUEST_CREATE', 'REQUEST_VIEW_OWN', 'CATALOG_VIEW', 'FORM_TEMPLATE_VIEW']

async function main() {
  const args = process.argv.slice(2)
  const positional = args.filter((a) => !a.startsWith('--'))
  const grantIdx = args.indexOf('--grant')
  const grantCode = grantIdx >= 0 ? (args[grantIdx + 1] || '').toUpperCase() : ''
  const email = (positional[0] || '').trim().toLowerCase()
  const formNeedle = positional[1] || ''

  if (!email) {
    console.error('\nUsage: ts-node prisma/check-access.ts <user email> [form name or id] [--grant <PERM_CODE>]\n')
    process.exit(1)
  }

  const user = await prisma.users.findUnique({
    where: { Email: email },
    include: {
      Role: { include: { RolePermissions: { include: { Permission: true } } } },
      GroupMembers: true,
    },
  })

  if (!user) {
    console.error(`\n✖ No user with email "${email}".\n`)
    process.exit(1)
  }

  const perms = new Set(user.Role.RolePermissions.map((rp) => rp.Permission.Code))
  const bypass = user.Role.Code === 'SUPER_ADMIN'

  console.log(`\nUser:   ${user.Email}  (${user.Name})`)
  console.log(`Role:   ${user.Role.Code} — "${user.Role.Name}"   active=${user.IsActive}   account=${user.AccountType}`)
  console.log(`Dept:   ${user.DEPID ?? '(none)'}   Groups: ${user.GroupMembers.map((g) => g.GroupID).join(', ') || '(none)'}`)

  // ---- gate 1: RBAC ----
  console.log('\n── Gate 1 · role permissions (this is what renders "No permission")')
  for (const code of GATE_PERMS) {
    const has = bypass || perms.has(code)
    console.log(`   ${has ? '✔' : '✘'} ${code}`)
  }
  if (!bypass && !perms.has('REQUEST_CREATE')) {
    console.log('   → ✖ BLOCKED: the role has no REQUEST_CREATE. The /requests/new page and POST /api/requests both stop here.')
    console.log('     Fix: --grant REQUEST_CREATE (below), or add the "Create Request" permission to this role in the DB.')
  } else {
    console.log('   → ✔ can open the catalog and create requests')
  }

  // ---- gate 2: form visibility ----
  if (!formNeedle) {
    console.log("\n(pass a form name/id as the 2nd argument to also check gate 2 — the form's Public/Restricted ACL)\n")
  } else {
    const forms = await prisma.formTemplates.findMany({
      where: {
        OR: [
          { FormTemplateID: formNeedle },
          { Name: { contains: formNeedle } },
        ],
      },
      include: { FormPerms: true },
    })

    if (forms.length === 0) {
      console.error(`\n✖ No form matches "${formNeedle}".\n`)
      process.exit(1)
    }

    for (const f of forms) {
      const viewRows = f.FormPerms.filter((p) => p.PermissionType === 'VIEW')
      const gids = new Set(user.GroupMembers.map((g) => g.GroupID))
      const ownerHit = (!!f.OwnerDEPID && f.OwnerDEPID === user.DEPID) || (!!f.OwnerGroupID && gids.has(f.OwnerGroupID))
      const granted =
        viewRows.some((r) => r.UserID === user.UserID) ||
        (!!user.DEPID && viewRows.some((r) => r.DEPID === user.DEPID)) ||
        viewRows.some((r) => !!r.GroupID && gids.has(r.GroupID))
      const visible = bypass || ownerHit || viewRows.length === 0 || granted

      console.log(`\n── Gate 2 · form "${f.Name}"`)
      console.log(`   status=${f.Status}   visibility=${viewRows.length === 0 ? 'PUBLIC (no VIEW rows)' : `restricted (${viewRows.length} VIEW rows)`}`)
      if (viewRows.length > 0) {
        viewRows.forEach((r) => console.log(`      · ${r.UserID ? 'user' : r.DEPID ? 'dept' : 'group'} → ${r.UserID ?? r.DEPID ?? r.GroupID}`))
      }
      console.log(`   ${visible ? '✔' : '✘'} ${visible ? 'this user may see/use the form' : 'this user is NOT in the allow-list → fill page returns 403'}`)
      if (f.Status !== 'ACTIVE') console.log('   → ✖ BLOCKED: form is not published. PATCH status=ACTIVE (Forms → Publish).')
    }
  }

  // ---- optional grant ----
  if (grantCode) {
    const perm = await prisma.permissions.findUnique({ where: { Code: grantCode } })
    if (!perm) {
      console.error(`\n✖ Unknown permission code "${grantCode}".\n`)
      process.exit(1)
    }
    const existing = await prisma.rolePermissions.findUnique({
      where: { RoleID_PermissionID: { RoleID: user.RoleID, PermissionID: perm.PermissionID } },
    })
    if (existing) {
      console.log(`\nℹ Role ${user.Role.Code} already has ${grantCode} — nothing to do.`)
    } else {
      await prisma.rolePermissions.create({ data: { RoleID: user.RoleID, PermissionID: perm.PermissionID } })
      console.log(`\n✔ Granted ${grantCode} to role "${user.Role.Name}". The user must reload the page (permissions are read at login/page load).`)
    }
  }
}

main()
  .catch((e) => {
    console.error('\n✖ Failed:', e?.message ?? e, '\n')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
