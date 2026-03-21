import { seedDefaultCategories } from "@/services/category.service"
import { Effect } from "effect"

async function main() {
  await Effect.runPromise(seedDefaultCategories())
  console.log("Default categories seeded")
  process.exit(0)
}

main().catch((err) => {
  console.error("Failed to seed categories:", err)
  process.exit(1)
})
