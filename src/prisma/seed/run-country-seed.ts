import { seedCountries } from "./country.seed";

seedCountries()
  .then(() => {
    console.log("countries seed done");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
