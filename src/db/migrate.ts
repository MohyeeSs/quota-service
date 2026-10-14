import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";
import { seedPlans } from "./seed";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedPlans();
  console.log("migrations + seed done");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});