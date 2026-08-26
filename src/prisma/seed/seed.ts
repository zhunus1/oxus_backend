import { seedCountries } from "./country.seed";
import { seedLanguages } from "./language.seed";
import { seedOrganisationsAndPrograms } from "./organisation.seed";
import { seedRolesAndPermissions } from "./roles-permissions.seed";
import { seedTestsAndQuestions } from "./test-seed";
import { seedUsers } from "./users.seed";
import { seedStudentPortrait } from "./student-portrait.seed";
import { seedExpertMentorshipData } from "./expert.seed";
import { seedProgramRequirements } from "./program-requirements.seed";
async function seedDatabase() {
  try {
    await seedCountries();
    await seedLanguages();
    await seedOrganisationsAndPrograms();
    await seedProgramRequirements();
    await seedRolesAndPermissions();
    await seedUsers();
    await seedTestsAndQuestions();
    await seedStudentPortrait();
    await seedExpertMentorshipData();
  } catch (error) {
    console.error(error);
  }
}

seedDatabase();
