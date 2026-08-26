import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { MinioModule } from "src/common/utils/minio/minio.module";
import { ExpertDashboardModule } from "src/modules/expert-dashboard/expert-dashboard.module";
import { TestModule } from "src/modules/test/test.module";
import { AttemptModule } from "src/modules/attempt/attempt.module";
import { TaskController } from "./api/task.controller";
import { StudentTaskController } from "./api/student-task.controller";
import { TaskService } from "./service/task.service";
import { TaskRepository } from "./repository/task.repository";
import { TaskCommentRepository } from "./repository/task-comment.repository";

@Module({
  imports: [PrismaModule, JwtModule, MinioModule, ExpertDashboardModule, TestModule, AttemptModule],
  controllers: [TaskController, StudentTaskController],
  providers: [TaskService, TaskRepository, TaskCommentRepository],
})
export class TaskModule {}
