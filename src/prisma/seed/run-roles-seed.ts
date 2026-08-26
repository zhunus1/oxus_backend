import { seedRolesAndPermissions } from "./roles-permissions.seed";

seedRolesAndPermissions()
  .then(() => {
    console.log("roles seed done");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
