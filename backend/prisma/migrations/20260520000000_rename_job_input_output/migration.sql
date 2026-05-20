ALTER TABLE "Job" RENAME COLUMN "input_uri" TO "input";
ALTER TABLE "Job" RENAME COLUMN "output_uri" TO "output";

ALTER TABLE "Job"
  ALTER COLUMN "input" TYPE JSONB USING to_jsonb("input"),
  ALTER COLUMN "output" TYPE JSONB USING to_jsonb("output");
