import { BackgroundRecovery } from "./background-recovery";

describe("BackgroundRecovery", () => {
  it("coalesces requests while work is blocked and rescans after newly committed records", async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const work = jest.fn().mockReturnValueOnce(blocked).mockResolvedValue(undefined);
    const errors = jest.fn();
    const recovery = new BackgroundRecovery(work, errors);
    recovery.trigger();
    for (let i = 0; i < 1000; i++) recovery.trigger();
    expect(work).toHaveBeenCalledTimes(1);
    const completion = recovery.run();
    expect(recovery.run()).toBe(completion);
    release();
    await completion;
    expect(work).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it("logs background errors and allows a subsequent recovery pass", async () => {
    const failure = new Error("Database unavailable");
    const work = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const errors = jest.fn();
    const recovery = new BackgroundRecovery(work, errors);
    recovery.trigger();
    await expect(recovery.run()).rejects.toBe(failure);
    expect(errors).toHaveBeenCalledWith(failure);
    await recovery.run();
    expect(work).toHaveBeenCalledTimes(2);
  });
});
