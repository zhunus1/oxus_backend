import { Injectable, PipeTransform } from "@nestjs/common";

@Injectable()
export class EmptyToUndefinedPipe implements PipeTransform {
  transform(value: any) {
    if (typeof value !== "object" || value === null) return value;

    const result: any = {};
    for (const key of Object.keys(value)) {
      const val = value[key];
      result[key] = val === "" ? undefined : val;
    }

    return result;
  }
}
