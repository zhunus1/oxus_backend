import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { observationOptions, OBSERVATION_OPTIONS, type ObservationOptions } from "./document-observation.config";
import { DocumentObservationMetrics } from "./document-observation.metrics";
import { DocumentObservationRepository } from "./document-observation.repository";
import { DocumentObservationService } from "./document-observation.service";
import { DocumentObservationWorker } from "./document-observation.worker";
@Module({
  imports: [ConfigModule],
  providers: [
    { provide: OBSERVATION_OPTIONS, inject: [ConfigService], useFactory: (config: ConfigService) => observationOptions(key => config.get(key)) },
    {
      provide: DocumentObservationRepository,
      inject: [ConfigService, OBSERVATION_OPTIONS],
      useFactory: (config: ConfigService, options: ObservationOptions) => new DocumentObservationRepository(config.get<string>("DATABASE_URL"), options),
    },
    {
      provide: DocumentObservationService,
      inject: [DocumentObservationRepository, OBSERVATION_OPTIONS],
      useFactory: (repository: DocumentObservationRepository, options: ObservationOptions) => new DocumentObservationService(repository, options),
    },
    { provide: DocumentObservationMetrics, useFactory: () => new DocumentObservationMetrics() },
    DocumentObservationWorker,
  ],
})
export class DocumentObservationModule {}
