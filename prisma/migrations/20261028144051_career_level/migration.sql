-- CreateEnum
CREATE TYPE "CareerLevel" AS ENUM ('NEW_GRAD', 'EXPERIENCED', 'CAREER_CHANGE');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "career" "CareerLevel" NOT NULL DEFAULT 'EXPERIENCED';
