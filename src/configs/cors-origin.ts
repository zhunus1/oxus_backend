type CorsCallback = (error: Error | null, allow?: boolean) => void;

export function validateCorsOrigin(origin: string | undefined, callback: CorsCallback): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    if (process.env.NODE_ENV === "production") {
      callback(new Error("CORS_ORIGINS must be configured in production"), false);
      return;
    }

    callback(null, true);
    return;
  }

  if (allowedOrigins.includes(origin.replace(/\/$/, ""))) {
    callback(null, true);
    return;
  }

  callback(new Error("Origin is not allowed by CORS"), false);
}
