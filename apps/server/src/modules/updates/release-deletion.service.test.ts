import { describe, expect, it } from 'vitest';
import {
  isActiveCampaignStatus,
  assertCampaignDeletable,
  assertReleaseDeletionAllowed,
} from './update-delete-policy.js';
import {
  CampaignActiveNotDeletableError,
  ReleaseInUseError,
  ReleaseReferencedByActiveCampaignError,
} from './update-delete-errors.js';

describe('update delete policy primitives', () => {
  it('treats server_updating and client_updating as active', () => {
    expect(isActiveCampaignStatus('server_updating')).toBe(true);
    expect(isActiveCampaignStatus('client_updating')).toBe(true);
    expect(isActiveCampaignStatus('draft')).toBe(false);
    expect(isActiveCampaignStatus('completed')).toBe(false);
  });

  it('throws the correct domain errors', () => {
    expect(() => assertCampaignDeletable({ status: 'client_updating' })).toThrow(CampaignActiveNotDeletableError);
    expect(() => assertReleaseDeletionAllowed({ activeReferences: 1, inactiveReferences: 0, force: true }))
      .toThrow(ReleaseReferencedByActiveCampaignError);
    expect(() => assertReleaseDeletionAllowed({ activeReferences: 0, inactiveReferences: 1, force: false }))
      .toThrow(ReleaseInUseError);
  });
});
