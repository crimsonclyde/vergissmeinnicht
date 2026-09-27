import { describe, expect, it } from 'vitest';
// Test-only relative import: the web app does not depend on the domain package (yet).
import {
  PROCEDURE_ICONS as SERVER_ICONS,
  REASON_POLICIES as SERVER_POLICIES,
  WORKSPACE_ROLES as SERVER_ROLES,
} from '../../../packages/domain/src/index.ts';
import { PROCEDURE_ICONS, REASON_POLICIES, WORKSPACE_ROLES } from './api.ts';

describe('web client constants', () => {
  it('match the server-side domain lists', () => {
    expect(PROCEDURE_ICONS).toEqual(SERVER_ICONS);
    expect(WORKSPACE_ROLES).toEqual(SERVER_ROLES);
    expect(REASON_POLICIES).toEqual(SERVER_POLICIES);
  });
});
