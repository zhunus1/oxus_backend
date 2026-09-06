/** Coalesces recovery requests into one background pass and, when needed, one follow-up pass. */
export class BackgroundRecovery {
  private running: Promise<void> | undefined;
  private rerun = false;

  constructor(
    private readonly work: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Wakes the persisted-record dispatcher without attaching request-specific waiters or waiting for Redis. */
  trigger(): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    void this.run().catch(this.onError);
  }

  /** Lets the scheduler or shutdown caller await the shared pass without starting overlapping work. */
  run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Rescans after requests that arrived while the previous database batch was already in flight. */
  private async drain(): Promise<void> {
    do {
      this.rerun = false;
      await this.work();
    } while (this.rerun);
  }
}
