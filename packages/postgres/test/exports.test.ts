import { describe, expect, it } from "vitest";
import {
  PostgresCheckpointStore,
  PostgresJobRepository,
  PostgresLockManager,
  createPostgresScaffoldError
} from "../src/index.js";

describe("postgres package exports / postgres package export를 검증한다", () => {
  it("constructs adapter shells with explicit options / 명시한 option으로 adapter shell을 생성한다", () => {
    const options = { connectionString: "postgres://localhost/nest_batch" };

    expect(new PostgresJobRepository(options)).toBeInstanceOf(PostgresJobRepository);
    expect(new PostgresCheckpointStore(options)).toBeInstanceOf(PostgresCheckpointStore);
    expect(new PostgresLockManager(options)).toBeInstanceOf(PostgresLockManager);
  });

  it("reports scaffold-only behavior explicitly / scaffold 전용 동작을 명확히 알린다", () => {
    expect(createPostgresScaffoldError("repository").message).toBe(
      "Postgres repository is scaffolded but not implemented yet."
    );
    expect(createPostgresScaffoldError("lock manager").message).toBe(
      "Postgres lock manager is scaffolded but not implemented yet."
    );
  });

  it("keeps lock operations behind scaffold errors / lock operation을 scaffold error 뒤에 둔다", async () => {
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
