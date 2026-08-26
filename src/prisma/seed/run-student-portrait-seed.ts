import { seedStudentPortrait } from "./student-portrait.seed";

async function main() {
  try {
    await seedStudentPortrait();
    console.log("Done");
  } catch (error) {
    console.error(error);
  }
}

main();
