/**
 * Migration 8: the weekdays the upper days go on under the upper-body
 * emphasis (Monday and Wednesday for the owner, around volleyball on Tuesday
 * and Thursday). A JSON array of weekday numbers; NULL leaves the placement
 * to the template.
 */
export const MIGRATION_0008 = `
ALTER TABLE athlete ADD COLUMN upper_weekdays_json TEXT;
`;
