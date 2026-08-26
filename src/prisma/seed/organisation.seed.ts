import fs from "node:fs";
import path from "node:path";
import { DegreeLevel } from "generated/prisma/client";
import { prismaClient } from "./prisma-client";
import { uploadSeedFile } from "./minio-upload.helper";

export async function seedOrganisationsAndPrograms() {
  console.log("Начинаем сидирование университетов и программ...");

  const targetYear = new Date().getFullYear() + 1;
  const assetsDir = path.join(process.cwd(), "src/prisma/seed/assets/organisations");

  const programTemplates: { name: string; degreeLevel: DegreeLevel }[] = [
    { name: "Computer Science", degreeLevel: DegreeLevel.BACHELOR },
    { name: "Data Science", degreeLevel: DegreeLevel.MASTER },
    { name: "Business Administration", degreeLevel: DegreeLevel.BACHELOR },
    { name: "Mechanical Engineering", degreeLevel: DegreeLevel.BACHELOR },
    { name: "Artificial Intelligence", degreeLevel: DegreeLevel.MASTER },
    { name: "Economics", degreeLevel: DegreeLevel.BACHELOR },
    { name: "International Relations", degreeLevel: DegreeLevel.BACHELOR },
    { name: "Architecture", degreeLevel: DegreeLevel.MASTER },
    { name: "Psychology", degreeLevel: DegreeLevel.BACHELOR },
    { name: "Finance", degreeLevel: DegreeLevel.MASTER },
    { name: "Cybersecurity", degreeLevel: DegreeLevel.MASTER },
    { name: "Marketing", degreeLevel: DegreeLevel.BACHELOR },
  ];

  const universities = [
    {
      slug: "mit",
      imageFile: "mit.png",
      websiteUrl: "https://www.mit.edu",
      nameEn: "Massachusetts Institute of Technology",
      nameRu: "Массачусетский технологический институт",
      nameKk: "Массачусетс технологиялық институты",
      countryId: 5,
      baseFee: 55000,
      baseGpa: 3.9,
      ielts: 7.5,
      acceptanceRate: 4.1,
    },
    {
      slug: "oxford",
      imageFile: "oxford.png",
      websiteUrl: "https://www.ox.ac.uk",
      nameEn: "University of Oxford",
      nameRu: "Оксфордский университет",
      nameKk: "Оксфорд университеті",
      countryId: 4,
      baseFee: 40000,
      baseGpa: 3.8,
      ielts: 7.5,
      acceptanceRate: 17.5,
    },
    {
      slug: "tum",
      imageFile: "tum.png",
      websiteUrl: "https://www.tum.de",
      nameEn: "Technical University of Munich",
      nameRu: "Мюнхенский технический университет",
      nameKk: "Мюнхен техникалық университеті",
      countryId: 3,
      baseFee: 3000,
      baseGpa: 3.0,
      ielts: 6.5,
      acceptanceRate: 40.0,
    },
    {
      slug: "nu",
      imageFile: "nu.png",
      websiteUrl: "https://nu.edu.kz",
      nameEn: "Nazarbayev University",
      nameRu: "Назарбаев Университет",
      nameKk: "Назарбаев Университеті",
      countryId: 1,
      baseFee: 15000,
      baseGpa: 3.0,
      ielts: 6.0,
      acceptanceRate: 25.0,
    },
    {
      slug: "toronto",
      imageFile: "toronto.png",
      websiteUrl: "https://www.utoronto.ca",
      nameEn: "University of Toronto",
      nameRu: "Университет Торонто",
      nameKk: "Торонто университеті",
      countryId: 14,
      baseFee: 45000,
      baseGpa: 3.5,
      ielts: 6.5,
      acceptanceRate: 43.0,
    },
    {
      slug: "nus",
      imageFile: "nus.png",
      websiteUrl: "https://www.nus.edu.sg",
      nameEn: "National University of Singapore",
      nameRu: "Национальный университет Сингапура",
      nameKk: "Сингапур ұлттық университеті",
      countryId: 25,
      baseFee: 25000,
      baseGpa: 3.6,
      ielts: 6.5,
      acceptanceRate: 16.0,
    },
    {
      slug: "eth",
      imageFile: "eth.png",
      websiteUrl: "https://ethz.ch",
      nameEn: "ETH Zurich",
      nameRu: "Швейцарская высшая техническая школа Цюриха",
      nameKk: "Цюрих Швейцария жоғары техникалық мектебі",
      countryId: 28,
      baseFee: 1500,
      baseGpa: 3.5,
      ielts: 7.0,
      acceptanceRate: 27.0,
    },
    {
      slug: "melbourne",
      imageFile: "melbourne.png",
      websiteUrl: "https://www.unimelb.edu.au",
      nameEn: "University of Melbourne",
      nameRu: "Мельбурнский университет",
      nameKk: "Мельбурн университеті",
      countryId: 15,
      baseFee: 35000,
      baseGpa: 3.3,
      ielts: 6.5,
      acceptanceRate: 70.0,
    },
    {
      slug: "snu",
      imageFile: "snu.png",
      websiteUrl: "https://en.snu.ac.kr",
      nameEn: "Seoul National University",
      nameRu: "Сеульский национальный университет",
      nameKk: "Сеул ұлттық университеті",
      countryId: 12,
      baseFee: 8000,
      baseGpa: 3.7,
      ielts: 6.0,
      acceptanceRate: 15.0,
    },
    {
      slug: "amsterdam",
      imageFile: "amsterdam.png",
      websiteUrl: "https://www.uva.nl",
      nameEn: "University of Amsterdam",
      nameRu: "Университет Амстердама",
      nameKk: "Амстердам университеті",
      countryId: 16,
      baseFee: 12000,
      baseGpa: 3.2,
      ielts: 6.5,
      acceptanceRate: 40.0,
    },
    {
      slug: "polimi",
      imageFile: "polimi.png",
      websiteUrl: "https://www.polimi.it",
      nameEn: "Politecnico di Milano",
      nameRu: "Миланский технический университет",
      nameKk: "Милан техникалық университеті",
      countryId: 8,
      baseFee: 4000,
      baseGpa: 3.0,
      ielts: 6.0,
      acceptanceRate: 50.0,
    },
    {
      slug: "tsinghua",
      imageFile: "tsinghua.png",
      websiteUrl: "https://www.tsinghua.edu.cn",
      nameEn: "Tsinghua University",
      nameRu: "Университет Цинхуа",
      nameKk: "Цинхуа университеті",
      countryId: 6,
      baseFee: 7000,
      baseGpa: 3.8,
      ielts: 6.5,
      acceptanceRate: 10.0,
    },
  ];

  for (const uni of universities) {
    const programsData = programTemplates.map((pt, index) => {
      const isMaster = pt.degreeLevel === DegreeLevel.MASTER;
      const isHardcoreProgram = pt.name.includes("Data Science") || pt.name.includes("Artificial Intelligence");

      return {
        name: pt.name,
        degreeLevel: pt.degreeLevel,
        tuitionFee: isMaster ? uni.baseFee * 1.2 : uni.baseFee,
        minGPA: isHardcoreProgram ? Math.min(4.0, uni.baseGpa + 0.2) : uni.baseGpa,
        minIELTS: uni.ielts,
        applicationDeadline: new Date(`${targetYear}-0${(index % 6) + 3}-15T00:00:00Z`),
        baseAcceptanceRate: isHardcoreProgram ? Math.max(0.01, (uni.acceptanceRate - 5) / 100) : uni.acceptanceRate / 100,
      };
    });

    let imageUrl: string | undefined = undefined;
    const imagePath = path.join(assetsDir, uni.imageFile);

    if (fs.existsSync(imagePath)) {
      const buffer = fs.readFileSync(imagePath);
      const ext = path.extname(uni.imageFile).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

      imageUrl = await uploadSeedFile("organisations", buffer, `${uni.slug}${path.extname(uni.imageFile)}`, mimeType);
    } else {
      console.warn(`⚠️ Image not found for ${uni.slug}: ${imagePath}`);
    }

    await prismaClient.organisation.upsert({
      where: { slug: uni.slug },
      update: {
        type: "UNIVERSITY",
        image: imageUrl,
        websiteUrl: uni.websiteUrl,
      },
      create: {
        slug: uni.slug,
        type: "UNIVERSITY",
        nameEn: uni.nameEn,
        nameRu: uni.nameRu,
        nameKk: uni.nameKk,
        image: imageUrl,
        websiteUrl: uni.websiteUrl,
        countryId: uni.countryId,
        programs: {
          create: programsData,
        },
      },
    });
  }

  console.log("✅ Сидирование успешно завершено! Загружено 12 вузов и 144 программы.");
}
