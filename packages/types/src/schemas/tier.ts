import { z } from "zod";

// SA-06 Tier Create/Edit (EXPERIENCE.md Field-Level Validation Rules).
//
// SA-06's mockup lists "Member cap (min)" as a distinct field, but `tiers`
// has only one `member_cap` column (0002_gyms_and_tiers.sql) and no FR
// describes storing a minimum threshold. `memberCap` here is that single
// column: a positive integer, or omitted/null meaning "no cap" (unlimited) --
// the mockup's "min" is a derived display value computed from tier ordering,
// never a stored or user-editable field. See story 1-6's Dev Notes -> Open
// Question 1.
// Postgres int4 upper bound -- values beyond this overflow the DB column.
const MAX_INT4 = 2147483647;

export const tierSchema = z.object({
  name: z.string().trim().min(1, "Tier name is required"),
  memberCap: z
    .number()
    .int()
    .positive("Enter a positive member cap")
    .max(MAX_INT4, "Value is too large")
    .nullable()
    .optional(),
  monthlyPrice: z
    .number()
    .int()
    .nonnegative("Enter a valid monthly price in XAF")
    .max(MAX_INT4, "Value is too large"),
  annualPrice: z
    .number()
    .int()
    .nonnegative("Enter a valid annual price in XAF")
    .max(MAX_INT4, "Value is too large"),
}).refine((data) => data.annualPrice <= data.monthlyPrice * 12, {
  message: "Annual price must not exceed 12 × the monthly price",
  path: ["annualPrice"],
});

export type TierInput = z.infer<typeof tierSchema>;
