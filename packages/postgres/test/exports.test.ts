import { describe, expect, it } from "vitest";
import {
  PostgresCheckpointStore,
  PostgresJobRepository,
  createPostgresScaffoldError
} from "../src/index.js";

describe("postgres package exports", () => {
  it("constructs adapter shells with explicit options", () => {
    const options = { connectionString: "postgres://localhost/nest_batch" };

    expect(new PostgresJobRepository(options)).toBeInstanceOf(PostgresJobRepository);
    expect(new PostgresCheckpointStore(options)).toBeInstanceOf(PostgresCheckpointStore);
  });

  it("reports scaffold-only behavior explicitly", () => {
    expect(createPostgresScaffoldError("repository").message).toBe(
      "Postgres repository is scaffolded but not implemented yet."
    );
  });
});
