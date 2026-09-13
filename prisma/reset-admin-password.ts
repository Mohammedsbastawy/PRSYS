/**
 * PRSYS — reset a user's password (e.g. when the admin password is lost).
 *
 * Uses the exact same hashing as the app (src/lib/auth.ts -> bcrypt.hash(pw, 10)),
 * so the new hash will pass /api/auth/login's verifyPassword().
 *
 * Usage (run from the repo root, needs .env with DATABASE_URL):
 *   npx ts-node --compiler-options {"module":"commonjs"} prisma/reset-admin-password.ts --list
 *   npx ts-node --compiler-options {"module":"commonjs"} prisma/reset-admin-password.ts admin@prsys.local 'NewPass@123'
 *   npm run db:reset-password -- admin@prsys.local 'NewPass@123'
 *
 * Flags:
 *   --list     show candidate admin accounts (email, role, status, has password) and exit
 *   --enable   also set IsActive = true (login returns 403 'Account is disabled' otherwise)
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEFAULT_EMAIL = 'admin@prsys.local'
const MIN_PASSWORD_LENGTH = 6 // same floor as the users API zod schema

function usage(): never {
  console.error(
    [
      '',
      'Usage:  ts-node prisma/reset-admin-password.ts <email> <newPassword> [--enable]',
      '        ts-node prisma/reset-admin-password.ts --list',
      '',
      `If <email> is omitted it falls back to ${DEFAULT_EMAIL}.`,
      'The password can also come from the RESET_PASSWORD env var.',
      '',
    ].join('\n')
  )
  process.exit(1)
}

async function listAdmins() {
  const users = await prisma.users.findMany({
    where: { Role: { Code: { in: ['SUPER_ADMIN', 'ADMIN'] } } },
    include: { Role: true },
    orderBy: { Email: 'asc' },
  })

  if (!users.length) {
    console.log('No SUPER_ADMIN / ADMIN accounts found. All users:')
    const all = await prisma.users.findMany({ include: { Role: true }, orderBy: { Email: 'asc' } })
    all.forEach((u) => console.log(`  ${u.Email}  role=${u.Role?.Code ?? '?'}  active=${u.IsActive}  password=${u.PasswordHash ? 'yes' : 'NO'}`))
    return
  }

  users.forEach((u) => {
    console.log(`  ${u.Email}  role=${u.Role?.Code}  active=${u.IsActive}  password=${u.PasswordHash ? 'yes' : 'NO'}`)
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) usage()

  const flags = new Set(args.filter((a) => a.startsWith('--') && !a.startsWith('--x')))
  const positional = args.filter((a) => !a.startsWith('--'))

  if (flags.has('--list')) {
    await listAdmins()
    return
  }

  const email = (positional[0] || process.env.RESET_EMAIL || DEFAULT_EMAIL).trim().toLowerCase()
  const password = positional[1] || process.env.RESET_PASSWORD || ''

  if (!password) {
    console.error('\n✖ Missing new password. Pass it as the 2nd argument (quoted) or via RESET_PASSWORD.\n')
    usage()
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`\n✖ Password too short — the app requires at least ${MIN_PASSWORD_LENGTH} characters (12+ recommended).\n`)
    process.exit(1)
  }

  const user = await prisma.users.findUnique({ where: { Email: email }, include: { Role: true } })
  if (!user) {
    console.error(`\n✖ No user with email "${email}". Use --list to see the accounts that exist.\n`)
    process.exit(1)
  }

  if (!user.PasswordHash) {
    console.log(`ℹ This account has no password hash yet (AccountType=${user.AccountType}); it could never log in before. Setting one now.`)
  }
  if (user.Role?.Code !== 'SUPER_ADMIN' && user.Role?.Code !== 'ADMIN') {
    console.log(`ℹ Heads up: role is "${user.Role?.Code}", not SUPER_ADMIN/ADMIN — you will not get the admin panel.`)
  }
  if (!user.IsActive && !flags.has('--enable')) {
    console.error(
      '\n✖ Account is deactivated — login would return 403 "Account is disabled".\n  Re-run with --enable to set IsActive = true as well.\n'
    )
    process.exit(1)
  }

  // rounds = 10 to match hashPassword() in src/lib/auth.ts
  const hash = await bcrypt.hash(password, 10)

  await prisma.users.update({
    where: { UserID: user.UserID },
    data: { PasswordHash: hash, ...(flags.has('--enable') ? { IsActive: true } : {}) },
  })

  // self-check: the stored hash must actually verify the new password
  const check = await prisma.users.findUnique({ where: { UserID: user.UserID }, select: { PasswordHash: true } })
  const ok = !!check?.PasswordHash && (await bcrypt.compare(password, check.PasswordHash))

  if (!ok) {
    console.error('\n✖ Written hash does not verify — something is off (trigger? different table?).\n')
    process.exit(1)
  }

  console.log(`\n✔ Password reset for ${user.Email}  (role: ${user.Role?.Code ?? '?'}, active: ${user.IsActive || flags.has('--enable')})`)
  console.log('  You can log in now.\n')
}

main()
  .catch((e) => {
    console.error('\n✖ Failed:', e?.message ?? e, '\n')
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
