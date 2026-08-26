import { prismaClient } from "./prisma-client";

export async function seedLanguages() {
  await prismaClient.language.createMany({
    data: [
      // Топ мировых языков
      { name: "English", code: "EN" },
      { name: "Chinese", code: "ZH" },
      { name: "Hindi", code: "HI" },
      { name: "Spanish", code: "ES" },
      { name: "French", code: "FR" },
      { name: "Arabic", code: "AR" },
      { name: "Bengali", code: "BN" },
      { name: "Portuguese", code: "PT" },
      { name: "Russian", code: "RU" },
      { name: "Urdu", code: "UR" },
      { name: "Indonesian", code: "ID" },
      { name: "German", code: "DE" },
      { name: "Japanese", code: "JA" },
      { name: "Nigerian Pidgin", code: "PCM" },
      { name: "Marathi", code: "MR" },
      { name: "Telugu", code: "TE" },
      { name: "Turkish", code: "TR" },
      { name: "Tamil", code: "TA" },
      { name: "Vietnamese", code: "VI" },
      { name: "Tagalog", code: "TL" },

      // СНГ и Центральная Азия
      { name: "Kazakh", code: "KK" },
      { name: "Uzbek", code: "UZ" },
      { name: "Ukrainian", code: "UK" },
      { name: "Azerbaijani", code: "AZ" },
      { name: "Kyrgyz", code: "KY" },
      { name: "Tajik", code: "TG" },
      { name: "Turkmen", code: "TK" },
      { name: "Armenian", code: "HY" },
      { name: "Georgian", code: "KA" },
      { name: "Belarusian", code: "BE" },
      { name: "Chechen", code: "CE" },
      { name: "Uyghur", code: "UG" },

      // Другие популярные европейские и азиатские
      { name: "Korean", code: "KO" },
      { name: "Italian", code: "IT" },
      { name: "Thai", code: "TH" },
      { name: "Persian", code: "FA" },
      { name: "Polish", code: "PL" },
      { name: "Dutch", code: "NL" },
      { name: "Romanian", code: "RO" },
      { name: "Greek", code: "EL" },
      { name: "Czech", code: "CS" },
      { name: "Hungarian", code: "HU" },
      { name: "Swedish", code: "SV" },
      { name: "Malay", code: "MS" },
    ],
    skipDuplicates: true,
  });
}
