import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

// Story 31.2 (FR-232): no server-readable copy store exists, so the N-08 push text is held inline in the streak reminder migration (private.engagement_reminder_text),
// byte for byte from n08.weekly.* in the two locale files. This test reads the migration and both catalogs and fails on any difference, so the app
// catalog and the SQL cannot drift. The rendered strings are pinned a second time in supabase/tests/engagement_reminder.test.sql.

// Located by name, not number: the migration number is provisional and renumbered at merge time.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
const MATCHES = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d+_streak_reminder_n08\.sql$/.test(name));
if (MATCHES.length !== 1) throw new Error(`expected exactly one supabase/migrations/*_streak_reminder_n08.sql, found ${MATCHES.length}: ${MATCHES.join(', ') || 'none'}`);
const MIGRATION = readFileSync(MIGRATIONS_DIR + MATCHES[0], 'utf8');

/** The body of one function: from its `create function` line to the closing `$$;`. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in the migration`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  return sql.slice(open + 2, close);
}

/** Every single-quoted SQL string literal of a body, with SQL quoting undone ('' is one apostrophe). */
function sqlLiterals(body: string): string[] {
  return [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

type Weekly = { title: string; body_one: string; body_other: string };
const EN = en.n08.weekly as Weekly;
const FR = fr.n08.weekly as Weekly;

describe('the N-08 push text in the streak reminder migration equals the catalog n08.weekly.* (EN and FR)', () => {
  const literals = sqlLiterals(functionBody(MIGRATION, 'private.engagement_reminder_text'));

  it('holds every catalog string, byte for byte, with its {{count}} placeholder', () => {
    for (const [name, value] of Object.entries({ 'en title': EN.title, 'en body_one': EN.body_one, 'en body_other': EN.body_other, 'fr title': FR.title, 'fr body_one': FR.body_one, 'fr body_other': FR.body_other })) {
      expect(literals, name).toContain(value);
    }
  });

  it('holds nothing else a member could read: every literal is a catalog string, the language code or the placeholder', () => {
    const allowed = new Set([EN.title, EN.body_one, EN.body_other, FR.title, FR.body_one, FR.body_other, 'fr', '{{count}}']);
    expect(literals.filter((text) => !allowed.has(text))).toEqual([]);
  });

  it('the catalog values the test compares are the ones in the UX spec (a changed catalog string is a visible change here too)', () => {
    expect(EN).toEqual({
      title: 'Your week is in reach',
      body_one: 'Come in today: {{count}} visit left to close your ring.',
      body_other: 'Come in today: {{count}} visits left to close your ring.',
    });
    expect(FR).toEqual({
      title: 'Votre semaine est à portée',
      body_one: "Venez aujourd'hui : encore {{count}} visite pour fermer votre cercle.",
      body_other: "Venez aujourd'hui : encore {{count}} visites pour fermer votre cercle.",
    });
  });

  it('the scanner can see a difference (positive control): a catalog value with one changed character is not found', () => {
    expect(literals).not.toContain(EN.body_other.replace('visits', 'visit s'));
    expect(sqlLiterals(`select 'Venez aujourd''hui : x', 'a'`)).toEqual(["Venez aujourd'hui : x", 'a']);
  });

  it('the push never uses the daily copy (n08.daily.*) or the gym name', () => {
    const body = functionBody(MIGRATION, 'private.engagement_reminder_text');
    expect(body).not.toContain(en.n08.daily.title);
    expect(body).not.toContain(fr.n08.daily.title);
    expect(body).not.toMatch(/gyms?\b/i);
  });
});
