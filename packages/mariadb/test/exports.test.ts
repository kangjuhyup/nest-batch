import { describe, expect, it } from "vitest";
import {
  MariaDbCheckpointStore,
  MariaDbJobRepository,
  MariaDbLockManager,
  createMariaDbScaffoldError
} from "../src/index.js";

describe("mariadb package exports / mariadb package export를 검증한다", () => {
  it("constructs adapter shells with explicit options / 명시한 option으로 adapter shell을 생성한다", () => {
    const options = { connectionString: "mariadb://localhost/nest_batch", database: "nest_batch" };

    expect(new MariaDbJobRepository(options)).toBeInstanceOf(MariaDbJobRepository);
    expect(new MariaDbCheckpointStore(options)).toBeInstanceOf(MariaDbCheckpointStore);
    expect(new MariaDbLockManager(options)).toBeInstanceOf(MariaDbLockManager);
  });

  it("reports scaffold-only behavior explicitly / scaffold 전용 동작을 명확히 알린다", () => {
    expect(createMariaDbScaffoldError("repository").message).toBe(
      "MariaDB repository is scaffolded but not implemented yet."
    );
    expect(createMariaDbScaffoldError("lock manager").message).toBe(
      "MariaDB lock manager is scaffolded but not implemented yet."
    );
  });

  it("keeps lock operations behind scaffold errors / lock operation을 scaffold error 뒤에 둔다", async () => {
    const lockManager = new MariaDbLockManager({ connectionString: "mariadb://localhost/nest_batch" });

    await expect(lockManager.acquire("job:daily-user-import", "worker-1")).rejects.toThrow(
      "MariaDB lock manager is scaffolded but not implemented yet."
    );
    await expect(
      lockManager.release({
        resource: "job:daily-user-import",
        ownerId: "worker-1"
      })
    ).rejects.toThrow("MariaDB lock manager is scaffolded but not implemented yet.");
  });
});
