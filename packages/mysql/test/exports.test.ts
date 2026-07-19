import { describe, expect, it } from "vitest";
import {
  MySqlCheckpointStore,
  MySqlJobRepository,
  MySqlLockManager,
  createMySqlScaffoldError
} from "../src/index.js";

describe("mysql package exports / mysql package export를 검증한다", () => {
  it("constructs adapter shells with explicit options / 명시한 option으로 adapter shell을 생성한다", () => {
    const options = { connectionString: "mysql://localhost/nest_batch", database: "nest_batch" };

    expect(new MySqlJobRepository(options)).toBeInstanceOf(MySqlJobRepository);
    expect(new MySqlCheckpointStore(options)).toBeInstanceOf(MySqlCheckpointStore);
    expect(new MySqlLockManager(options)).toBeInstanceOf(MySqlLockManager);
  });

  it("reports scaffold-only behavior explicitly / scaffold 전용 동작을 명확히 알린다", () => {
    expect(createMySqlScaffoldError("repository").message).toBe(
      "MySQL repository is scaffolded but not implemented yet."
    );
    expect(createMySqlScaffoldError("lock manager").message).toBe(
      "MySQL lock manager is scaffolded but not implemented yet."
    );
  });

  it("keeps lock operations behind scaffold errors / lock operation을 scaffold error 뒤에 둔다", async () => {
    const lockManager = new MySqlLockManager({ connectionString: "mysql://localhost/nest_batch" });

    await expect(lockManager.acquire("job:daily-user-import", "worker-1")).rejects.toThrow(
      "MySQL lock manager is scaffolded but not implemented yet."
    );
    await expect(
      lockManager.release({
        resource: "job:daily-user-import",
        ownerId: "worker-1"
      })
    ).rejects.toThrow("MySQL lock manager is scaffolded but not implemented yet.");
  });
});
