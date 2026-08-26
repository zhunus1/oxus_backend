import messages from "src/configs/messages";

export function enumMessage(field: string, e: object) {
  return () => messages.MUST_BE_VALID_ENUM(field, Object.values(e) as string[]);
}
