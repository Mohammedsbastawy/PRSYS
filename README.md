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
