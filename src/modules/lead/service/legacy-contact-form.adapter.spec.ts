import { LegacyContactFormAdapter } from "./legacy-contact-form.adapter";

describe("LegacyContactFormAdapter", () => {
  const adapter = new LegacyContactFormAdapter();
  const payload = {
    firstName: "Aisha",
    lastName: "Bekova",
    phone: "8 (700) 123-45-67",
    email: "AISHA@EXAMPLE.COM",
    topic: "Study abroad opportunities",
    interests: "UK universities",
    role: "student",
    preferredLanguage: "en",
  };

  it("preserves every legacy response field while storing the shared normalized phone", () => {
    const mapping = adapter.map(payload);

    expect(mapping.normalized).toEqual({
      displayName: "Aisha Bekova",
      phoneNumber: "+77001234567",
      email: "aisha@example.com",
      role: "student",
      preferredLanguage: "en",
      firstName: "Aisha",
      lastName: "Bekova",
      topic: "Study abroad opportunities",
      interests: "UK universities",
    });
    expect(mapping.schemaVersion).toBe("legacy-v1");
  });

  it("keeps a legacy phone verbatim when it cannot be normalized", () => {
    const mapping = adapter.map({ ...payload, phone: "internal-extension" });

    expect(mapping.normalized.phoneNumber).toBe("internal-extension");
  });
});
