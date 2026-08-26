import { seedExpertMentorshipData } from "./expert.seed";

seedExpertMentorshipData()
  .then(() => {
    console.log("expert seed done");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
