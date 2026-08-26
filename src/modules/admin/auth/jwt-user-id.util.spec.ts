import { resolveUserIdFromJwtPayload } from "./jwt-user-id.util";

describe("resolveUserIdFromJwtPayload", () => {
  it.each([
    [{ sub: 17 }, 17],
    [{ sub: "17" }, 17],
    [{ id: 18 }, 18],
  ])("resolves supported integer JWT identifiers", (payload, expected) => {
    expect(resolveUserIdFromJwtPayload(payload)).toBe(expected);
  });

  it.each([{ sub: "17abc" }, { sub: "1.5" }, { sub: 1.5 }, { sub: 0 }, { sub: null }, {}])("rejects malformed JWT identifiers", payload => {
    expect(resolveUserIdFromJwtPayload(payload)).toBeNull();
  });
});
