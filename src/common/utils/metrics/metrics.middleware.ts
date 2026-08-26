import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    res.on("finish", () => {
      this.metrics.httpRequestsTotal.inc({
        method: req.method,
        path: req.path,
        status: res.statusCode,
      });
    });
    next();
  }
}
