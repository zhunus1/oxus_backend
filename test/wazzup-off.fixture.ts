/** Business-only integration fixtures omit all provider behavior. */
export const wazzupOff = {
  revocableUsers: async () => [],
  invalidateUsers: async () => undefined,
  synchronizeUsers: async () => undefined,
};
