import { describe, expect, it } from "vitest";
import { InMemoryScheduleStore } from "@nest-batch/inmemory";

describe("inmemory schedule store / inmemory schedule store를 검증한다", () => {
  it("claims dispatches and fails occurrences / occurrence claim dispatch fail을 저장한다", async () => {
    const store = new InMemoryScheduleStore();
    const candidate = {
      scheduleName: "billing.daily",
      occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const claimed = await store.claimOccurrence(candidate, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z"),
      claimTtlMs: 30_000
    });

    expect(claimed).toMatchObject({
      occurrenceId: candidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-1"
    });
    await expect(
      store.markDispatched(claimed!, {
        ownerId: "scheduler-1",
        dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
      })
    ).resolves.toBe(true);
    await expect(store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: candidate.occurrenceId,
      status: "dispatched"
    });
  });

  it("rejects owned completion from another owner / 다른 owner의 완료 기록을 거부한다", async () => {
    const store = new InMemoryScheduleStore();
    const claimed = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );

    await expect(
      store.markDispatched(claimed!, {
        ownerId: "scheduler-2",
        dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
      })
    ).resolves.toBe(false);
  });

  it("records dispatch failures / dispatch 실패를 기록한다", async () => {
    const store = new InMemoryScheduleStore();
    const claimed = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-02T00:00:01.000Z")
      }
    );

    await expect(
      store.markFailed(claimed!, {
        ownerId: "scheduler-1",
        failedAt: new Date("2026-01-02T00:00:02.000Z"),
        failureReason: "enqueue failed"
      })
    ).resolves.toBe(true);

    await expect(store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
      status: "failed",
      failureReason: "enqueue failed"
    });
  });
});
