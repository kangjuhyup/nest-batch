import { describe, expect, it } from "vitest";
import {
  PostgresCheckpointStore,
  PostgresJobRepository,
  PostgresLockManager,
  createPostgresScaffoldError
} from "../src/index.js";

describe("postgres package exports", () => {
  it("constructs adapter shells with explicit options", () => {
    const options = { connectionString: "postgres://localhost/nest_batch" };

    expect(new PostgresJobRepository(options)).toBeInstanceOf(PostgresJobRepository);
    expect(new PostgresCheckpointStore(options)).toBeInstanceOf(PostgresCheckpointStore);
    expect(new PostgresLockManager(options)).toBeInstanceOf(PostgresLockManager);
  });

  it("reports scaffold-only behavior explicitly", () => {
    expect(createPostgresScaffoldError("repository").message).toBe(
      "Postgres repository is scaffolded but not implemented yet."
    );
    expect(createPostgresScaffoldError("lock manager").message).toBe(
      "Postgres lock manager is scaffolded but not implemented yet."
    );
  });

  it("keeps lock operations behind scaffold errors", async () => {
    const lockManager = new PostgresLockManager({ connectionString: "postgres://localhost/nest_batch" });

    await expect(lockManager.acquire("job:daily-user-import", "worker-1")).rejects.toThrow(
      "Postgres lock manager is scaffolded but not implemented yet."
    );
    await expect(
      lockManager.release({
        resource: "job:daily-user-import",
        ownerId: "worker-1"
      })
    ).rejects.toThrow("Postgres lock manager is scaffolded but not implemented yet.");
  });
});
