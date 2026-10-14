// One-time initial-admin bootstrap (spec §5.4). Run from a trusted machine with the
// owner connection. The user must already have signed up and verified their email.
//   DATABASE_URL_UNPOOLED=... pnpm admin:bootstrap --email you@example.com
// Refuses if any admin already exists (enforced in core.bootstrap_admin()).
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED;
const emailArg = process.argv.indexOf("--email");
const email = (emailArg > -1 ? process.argv[emailArg + 1] : process.env.BOOTSTRAP_ADMIN_EMAIL)?.trim();

if (!url || !email) {
  console.error("Usage: DATABASE_URL_UNPOOLED=... pnpm admin:bootstrap --email <verified email>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // Managed Better Auth stores users in neon_auth."user" (Better Auth core schema).
  const { rows } = await client.query<{ id: string; verified: boolean }>(
    `select id::text as id, "emailVerified" as verified from neon_auth."user" where lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];
  if (!user) throw new Error("No Neon Auth user with that email. Sign up in the app first.");
  if (!user.verified) throw new Error("That email is not verified yet. Verify it, then rerun.");

  await client.query("select core.bootstrap_admin($1)", [user.id]);
  console.log("Admin role granted and audited.");
} catch (error) {
  console.error(`Bootstrap failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
