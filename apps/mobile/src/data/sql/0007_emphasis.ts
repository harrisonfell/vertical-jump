/**
 * Migration 7: the week's emphasis.
 *
 * 'balanced' is the rule book's template; 'upper_body' gives the Recovery day
 * at four and five days to a second upper-body session, for an athlete whose
 * lower body and jumping are trained somewhere else. One answer, so one
 * column. Nullable: an athlete who never answered keeps the template.
 */
export const MIGRATION_0007 = `
ALTER TABLE athlete ADD COLUMN emphasis TEXT;
`;
