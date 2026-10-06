import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Automated accessibility check (Step 8.8): WCAG 2.2 A/AA rules of axe-core on the current page.
 * Automated rules find roughly a third of real problems; they complement, not replace, manual review.
 */
export async function expectAccessible(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  const violations = results.violations.map(
    (violation) => `${where}: ${violation.id} (${violation.impact ?? 'n/a'}) — ${violation.help}\n    ${violation.nodes.map((node) => `${node.target.join(' ')}${node.failureSummary === undefined ? '' : ` — ${node.failureSummary.replace(/\s+/g, ' ')}`}`).join('\n    ')}`,
  );
  expect(violations, violations.join('\n')).toEqual([]);
}
