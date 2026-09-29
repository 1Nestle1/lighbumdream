-- Existing ideas kept a single "next step"; it becomes the first step of their checklist.
INSERT INTO "idea_steps" ("idea_id", "user_id", "text", "position")
SELECT "id", "user_id", left("next_step", 200), 0 FROM "ideas" WHERE "next_step" IS NOT NULL AND "next_step" <> '';
