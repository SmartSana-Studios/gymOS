import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The mobile phone picker has no render harness here, so the owner decision of 2026-11-25 (Sub-Saharan Africa only, with a saved number's own country kept as an extra
// option) is pinned on the source, the way the other mobile source tests are.
const source = readFileSync(fileURLToPath(new URL('../components/ui/PhoneInput.tsx', import.meta.url)), 'utf8');

describe('mobile PhoneInput target countries', () => {
  it('filters the global list to the target countries', () => {
    expect(source).toContain("import { isTargetCountry, TARAMONEY_SUPPORTED_COUNTRIES } from '@gymos/types'");
    expect(source).toContain('isTargetCountry(code) && Boolean(COUNTRY_NAMES[code])');
  });

  it("keeps a held number's own country as an extra option instead of falling back to Cameroon", () => {
    expect(source).toContain('const heldCountry');
    expect(source).toContain('optionForCountry(heldCountry');
    expect(source).toContain('baseOptions.some((option) => option.code === heldCountry)');
  });
});
