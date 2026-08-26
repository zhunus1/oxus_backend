import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { MailService } from "./mail.service";
import { Logger } from "@nestjs/common";

@Processor("mail")
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case "consultation-reminder":
        await this.mailService.sendConsultationReminder(job.data);
        break;
      case "meeting-request":
        await this.mailService.sendMeetingRequestToExpert(job.data);
        break;
      case "collab-invite":
        await this.mailService.sendCollabInviteEmail(job.data);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }
}
