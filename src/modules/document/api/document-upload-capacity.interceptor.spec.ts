import { ServiceUnavailableException, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { firstValueFrom, of, Subject } from "rxjs";
import { DOCUMENT_MAX_CONCURRENT_UPLOADS, DocumentUploadCapacityInterceptor } from "./document-upload-capacity.interceptor";

describe("process-wide document upload admission", () => {
  function request(operation: () => ReturnType<CallHandler["handle"]>, autoFinish = true) {
    const response = new EventEmitter();
    const context = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ExecutionContext;
    const observable = new DocumentUploadCapacityInterceptor().intercept(context, { handle: operation });
    return {
      response,
      observable,
      run: () =>
        firstValueFrom(observable).finally(() => {
          if (autoFinish) response.emit("finish");
        }),
    };
  }

  it("shares the budget across interceptor instances and releases it after success/failure", async () => {
    const pending = Array.from({ length: DOCUMENT_MAX_CONCURRENT_UPLOADS }, () => new Subject<number>());
    const operations = pending.map(subject => request(() => subject).run());
    const next = jest.fn(() => of(1));
    await expect(request(next).run()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(next).not.toHaveBeenCalled();
    pending[0].error(new Error("storage failed"));
    await expect(operations[0]).rejects.toThrow("storage failed");
    await expect(request(() => of(2)).run()).resolves.toBe(2);
    for (const subject of pending.slice(1)) {
      subject.next(3);
      subject.complete();
    }
    await expect(Promise.all(operations.slice(1))).resolves.toEqual([3, 3, 3]);
  });

  it("holds slots until the HTTP response finishes after persistence", async () => {
    const requests = Array.from({ length: DOCUMENT_MAX_CONCURRENT_UPLOADS }, () => request(() => of(1), false));
    await Promise.all(requests.map(item => item.run()));
    await expect(request(() => of(2)).run()).rejects.toBeInstanceOf(ServiceUnavailableException);
    for (const item of requests) item.response.emit("finish");
    await expect(request(() => of(2)).run()).resolves.toBe(2);
    for (const item of requests) {
      expect(item.response.listenerCount("finish")).toBe(0);
      expect(item.response.listenerCount("close")).toBe(0);
    }
  });

  it("does not release capacity on disconnect/unsubscribe while persistence is pending", async () => {
    const pending = Array.from({ length: DOCUMENT_MAX_CONCURRENT_UPLOADS }, () => new Subject<number>());
    const requests = pending.map(subject => request(() => subject, false));
    const subscriptions = requests.map(item => item.observable.subscribe());
    await Promise.resolve();
    requests.forEach((item, index) => {
      item.response.emit("close");
      subscriptions[index].unsubscribe();
    });
    await expect(request(() => of(1)).run()).rejects.toBeInstanceOf(ServiceUnavailableException);
    for (const subject of pending) {
      subject.next(1);
      subject.complete();
    }
    await new Promise(resolve => setImmediate(resolve));
    await expect(request(() => of(1)).run()).resolves.toBe(1);
    for (const item of requests) {
      expect(item.response.listenerCount("finish")).toBe(0);
      expect(item.response.listenerCount("close")).toBe(0);
    }
  });

  it("releases slots after a synchronous parser/handler exception", async () => {
    for (let index = 0; index <= DOCUMENT_MAX_CONCURRENT_UPLOADS; index++) {
      await expect(
        request(() => {
          throw new Error("parser failed");
        }).run(),
      ).rejects.toThrow("parser failed");
    }
    await expect(request(() => of(1)).run()).resolves.toBe(1);
  });
});
