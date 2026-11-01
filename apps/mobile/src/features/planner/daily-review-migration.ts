export const dailyReviewMigrationV10 = `
  ALTER TABLE daily_reviews ADD COLUMN went_well TEXT NOT NULL DEFAULT '' CHECK (length(went_well) <= 1000);
  ALTER TABLE daily_reviews ADD COLUMN improve TEXT NOT NULL DEFAULT '' CHECK (length(improve) <= 1000);
  ALTER TABLE daily_reviews ADD COLUMN tomorrow_priority TEXT NOT NULL DEFAULT '' CHECK (length(tomorrow_priority) <= 500);
  UPDATE daily_reviews SET went_well=note WHERE length(trim(note))>0 AND length(trim(went_well))=0;
`;
