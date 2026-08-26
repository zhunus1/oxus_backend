import { Counter } from "prom-client";
import { Injectable } from "@nestjs/common";

@Injectable()
export class MetricsService {
  readonly httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "path", "status"],
  });
}
