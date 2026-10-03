import { BadRequestException } from "@nestjs/common";
import { readFrontendLeadMetrics } from "./lead-metrics";

describe("frontend metric groups", () => {
  it("distinguishes absent results from a complete zero result", () => {
    expect(readFrontendLeadMetrics({})).toBeUndefined();
    expect(readFrontendLeadMetrics({ score: 0, percent: 0, universities: 0 })).toEqual({ score: 0, percent: 0, universities: 0 });
  });

  it.each([{ score: 0 }, { percent: 0 }, { universities: 0 }, { score: 0, percent: 0 }, { score: 0, universities: 0 }, { percent: 0, universities: 0 }])(
    "rejects incomplete results: %p",
    metrics => {
      expect(() => readFrontendLeadMetrics(metrics)).toThrow(BadRequestException);
    },
  );
});
