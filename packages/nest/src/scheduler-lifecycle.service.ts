import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import type { SchedulerLoop } from "@rvkang/batch-core/scheduler";
import { BATCH_SCHEDULER_LOOP, NEST_BATCH_OPTIONS } from "./constants.js";
import type { NestBatchModuleOptions } from "./module-options.js";

@Injectable()
export class NestBatchSchedulerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private abortController?: AbortController;
  private running?: Promise<void>;

  constructor(
    @Inject(NEST_BATCH_OPTIONS) private readonly options: NestBatchModuleOptions,
    @Optional()
    @Inject(BATCH_SCHEDULER_LOOP)
    private readonly schedulerLoop?: SchedulerLoop
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.scheduler?.autoStart !== true) {
      return;
    }

    if (!this.schedulerLoop) {
      throw new Error("NestBatchModule scheduler autoStart requires a SchedulerLoop provider.");
    }

    this.abortController = new AbortController();
    this.running = this.schedulerLoop.runUntilStopped({
      signal: this.abortController.signal
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.abortController?.abort();
    await this.running;
  }
}
