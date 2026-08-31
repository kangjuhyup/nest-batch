import { describe, expect, it } from "vitest";
import { MariaDbScheduleStore } from "@nest-batch/mariadb";

describe("mariadb schedule store / mariadb schedule store를 검증한다", () => {
  it("claims and marks schedule occurrences through mariadb SQL / mariadb SQL로 schedule occurrence를 claim하고 상태를 기록한다", async () => {
    const pool = new FakeMariaDbPool();
    const store = new MariaDbScheduleStore({ pool, database: "nest_batch", tablePrefix: "nb" });
    pool.queueRows([
      {
        schedule_name: "billing.daily",
        occurrence_id: "occ-1",
        scheduled_at: new Date("2026-01-01T00:00:00.000Z"),
        status: "claimed",
        owner_id: "scheduler-1",
        claimed_at: new Date("2026-01-01T00:00:01.000Z"),
        claim_expires_at: null,
        dispatched_at: null,
        failed_at: null,
        failure_reason: null
      }
    ]);

    const claimed = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "occ-1",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );

    expect(claimed).toMatchObject({ occurrenceId: "occ-1", status: "claimed" });
    pool.queueAffectedRows(1);
    await expect(
      store.markDispatched(claimed!, {
        ownerId: "scheduler-1",
        dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
      })
    ).resolves.toBe(true);
    expect(pool.calls[0]?.sql).toContain("INSERT INTO `nest_batch`.`nb_schedule_occurrences`");
  });

  it("initializes schedule occurrence table / schedule occurrence table을 초기화한다", async () => {
    const pool = new FakeMariaDbPool();
    const store = new MariaDbScheduleStore({ pool, database: "nest_batch", tablePrefix: "nb" });

    await store.initialize();

    expect(pool.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS `nest_batch`.`nb_schedule_occurrences`")
    ]);
  });
});

class FakeMariaDbPool {
  readonly calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
  private readonly rows: unknown[][] = [];
  private readonly affectedRows: number[] = [];

  queueRows(rows: unknown[]): void {
    this.rows.push(rows);
  }

  queueAffectedRows(value: number): void {
    this.affectedRows.push(value);
  }

  async query(sql: string, values?: readonly unknown[]): Promise<unknown> {
    this.calls.push({ sql, values });
    if (sql.trim().startsWith("SELECT")) {
      return this.rows.shift() ?? [];
    }
    return { affectedRows: this.affectedRows.shift() ?? 0 };
  }
}
