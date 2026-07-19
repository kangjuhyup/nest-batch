import { describe, expect, it } from "vitest";
import { SKIP_ITEM, isSkipItem, skipItem } from "../src/skip-item.js";
import { DatabaseBatchStorage } from "../src/types/index.js";
import type { CheckpointStore, JobRepository, LockManager, Reader, Writer } from "../src/types/index.js";

class FakeDatabaseBatchStorage extends DatabaseBatchStorage {
  constructor(
    readonly repository: JobRepository,
    readonly checkpointStore: CheckpointStore,
    readonly lockManager: LockManager
  ) {
    super();
  }
}

describe("core type module exports / core type module export", () => {
  it("exports split type modules through the types barrel / 분리된 type module을 types barrel로 export한다", () => {
    const repository = {} as JobRepository;
    const checkpointStore = {} as CheckpointStore;
    const lockManager = {} as LockManager;
    const storage = new FakeDatabaseBatchStorage(repository, checkpointStore, lockManager);
    const reader: Reader<string> = {
      *read() {
        yield "user-1";
      }
    };
    const writer: Writer<string> = {
      write() {
        return undefined;
      }
    };

    expect(storage.repository).toBe(repository);
    expect([...reader.read({ signal: new AbortController().signal })]).toEqual(["user-1"]);
    expect(writer.write(["user-1"], { attempt: 1, chunkIndex: 0, signal: new AbortController().signal })).toBeUndefined();
  });

  it("keeps skip item runtime helpers outside the type definitions / skip item runtime helper를 type 정의 밖에 둔다", () => {
    const skipped = skipItem("filtered");

    expect(skipped[SKIP_ITEM]).toBe(true);
    expect(isSkipItem(skipped)).toBe(true);
    expect(isSkipItem({ kind: "skip", reason: "filtered" })).toBe(false);
  });
});
