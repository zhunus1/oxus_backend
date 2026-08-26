import { seedUsers } from "./users.seed";

seedUsers()
  .then(() => {
    console.log("users seed done");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
