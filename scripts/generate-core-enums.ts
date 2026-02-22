// apps/backend/scripts/generate-core-enums.ts
// Purpose: Generate enum union types from Prisma schema into packages/core

import fs from "fs";
import path from "path";

const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
const outputPath = path.resolve(
  __dirname,
  "../../../packages/core/src/generated/enums.ts",
);

function extractEnums(schema: string) {
  const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  const enums: { name: string; values: string[] }[] = [];

  let match;
  while ((match = enumRegex.exec(schema)) !== null) {
    const name = match[1];
    const rawBody = match[2];

    const values = rawBody
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));

    enums.push({ name, values });
  }

  return enums;
}

function generateFile(enums: { name: string; values: string[] }[]) {
  const header = `// AUTO-GENERATED FILE — DO NOT EDIT
// Generated from Prisma schema

`;

  const body = enums
    .map(
      (e) =>
        `export type ${e.name} = ${e.values
          .map((v) => `"${v}"`)
          .join(" | ")};\n`,
    )
    .join("\n");

  return header + body;
}

function main() {
  if (!fs.existsSync(schemaPath)) {
    throw new Error("Prisma schema not found");
  }

  const schema = fs.readFileSync(schemaPath, "utf-8");
  const enums = extractEnums(schema);
  const content = generateFile(enums);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);

  console.log("✔ Enums generated in packages/core");
}

main();
