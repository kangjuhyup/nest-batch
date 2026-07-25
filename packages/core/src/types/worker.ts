export interface WorkerTask<T = unknown> {
  run(signal: AbortSignal): Promise<T> | T;
}

export interface WorkerPool {
  readonly capacity: number;
  run<T>(
    task: WorkerTask<T> | ((signal: AbortSignal) => Promise<T> | T),
    signal?: AbortSignal
  ): Promise<T>;
  close?(): Promise<void>;
}
