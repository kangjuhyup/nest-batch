import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import { ContinuousPollingLoop } from "@rv-nest-batch/core/polling";
import { BATCH_POLLING_WORKERS } from "./constants.js";
import type { NestBatchPollingWorkerOptions } from "./module-options.js";

@Injectable()
export class NestBatchPollingLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly runningWorkers: RunningPollingWorker[] = [];

  constructor(
    @Optional()
    @Inject(BATCH_POLLING_WORKERS)
    private readonly pollingWorkers?: readonly NestBatchPollingWorkerOptions[]
  ) {}

  onApplicationBootstrap(): void {
    const workers = (this.pollingWorkers ?? [])
      .filter((worker) => worker.autoStart === true)
      .map((worker) => ({
        abortController: new AbortController(),
        loop: new ContinuousPollingLoop(worker)
      }));

    for (const worker of workers) {
      const running = worker.loop.runUntilStopped({
        signal: worker.abortController.signal
      });

      this.runningWorkers.push({ abortController: worker.abortController, running });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const worker of this.runningWorkers) {
      worker.abortController.abort();
    }

    await Promise.all(this.runningWorkers.map((worker) => worker.running));
  }
}

interface RunningPollingWorker {
  readonly abortController: AbortController;
  readonly running: Promise<void>;
}
