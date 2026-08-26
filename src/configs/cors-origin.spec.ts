import { validateCorsOrigin } from "./cors-origin";

describe("validateCorsOrigin", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOrigins = process.env.CORS_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalOrigins;
  });

  it("allows an explicitly configured browser origin", () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://test.oxusedu.com";
    const callback = jest.fn();

    validateCorsOrigin("https://test.oxusedu.com", callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it("fails closed for browser origins when production has no allow-list", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();

    validateCorsOrigin("https://attacker.example", callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), false);
  });

  it("allows requests without an Origin header for server-to-server clients", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CORS_ORIGINS;
    const callback = jest.fn();

    validateCorsOrigin(undefined, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
