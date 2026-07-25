import { describe, expect, expectTypeOf, it } from "vitest";
import {
  defineChunkStep,
  defineJob,
  definePartitionedStep,
  defineStep
} from "../src/index.js";
import type { JobParameters } from "../src/index.js";

type BillingParameters = JobParameters & {
  readonly tenantId: string;
  readonly businessDate: string;
  readonly dryRun?: boolean;
};

describe("context type compatibility / context type 호환성", () => {
  it("propagates explicit job parameter types to step contexts / 명시한 job parameter 타입을 step context로 전달한다", () => {
    const tasklet = defineStep<undefined, string, BillingParameters>({
      name: "load-billing",
      execute(context) {
        expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
        return context.parameters.tenantId;
      }
    });
    const chunk = defineChunkStep<
      { readonly id: string },
      { readonly id: string; readonly tenantId: string },
      { readonly cursor: number },
      BillingParameters
    >({
      name: "copy-billing",
      chunkSize: 2,
      reader: {
        read(context) {
          expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
          return [{ id: context.parameters.businessDate }];
        }
      },
      processor: {
        process(item, context) {
          expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
          return { ...item, tenantId: context.parameters.tenantId };
        }
      },
      retryPolicy: {
        canRetry(context) {
          expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
          return context.parameters.dryRun === true;
        }
      },
      skipPolicy: {
        canSkip(context) {
          expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
          return context.parameters.tenantId.length === 0;
        }
      },
      writer: {
        write(_items, context) {
          expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
        }
      },
      checkpoint(context) {
        expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
        return { cursor: context.readCount };
      }
    });
    const partitioned = definePartitionedStep<{ readonly shard: number }, BillingParameters>({
      name: "partition-billing",
      partitions: () => [{ shard: 0 }],
      execute(_partition, context) {
        expectTypeOf(context.parameters).toEqualTypeOf<BillingParameters>();
        return { readCount: context.parameters.dryRun ? 0 : 1 };
      }
    });
    const job = defineJob<BillingParameters>({
      name: "billing-job",
      steps: [tasklet, chunk, partitioned]
    });

    expect(job.steps).toHaveLength(3);
  });

  it("keeps default job parameters when no explicit type is provided / 명시 타입이 없으면 기본 job parameter를 유지한다", () => {
    const step = defineStep({
      name: "default-parameters",
      execute(context) {
        expectTypeOf(context.parameters).toEqualTypeOf<JobParameters>();
        return context.parameters;
      }
    });
    const job = defineJob({
      name: "default-parameters-job",
      steps: [step]
    });

    expect(job.steps[0]).toBe(step);
  });
});
