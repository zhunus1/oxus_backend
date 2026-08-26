import { seedOrganisationsAndPrograms } from "./organisation.seed";

seedOrganisationsAndPrograms()
  .then(() => {
    console.log("organisation seed done");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
