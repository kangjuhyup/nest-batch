import { DynamicModule, Module } from "@nestjs/common";
import type { BatchRunOptions } from "@nest-batch/core";
import { NEST_BATCH_OPTIONS } from "./constants.js";

export interface NestBatchModuleOptions {
  readonly defaultTimeoutMs?: number;
  readonly runner?: Partial<BatchRunOptions>;
}

@Module({})
export class NestBatchModule {
  static forRoot(options: NestBatchModuleOptions = {}): DynamicModule {
    return {
      module: NestBatchModule,
      providers: [
        {
          provide: NEST_BATCH_OPTIONS,
          useValue: options
        }
      ],
      exports: [NEST_BATCH_OPTIONS]
    };
  }
}
