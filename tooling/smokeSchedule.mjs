// A schedule write used by the backend's company initialisation test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 10_000;

/** The name of the person the smoke schedule creates. */
export const RESOURCE_NAME = 'Bruce Wayne Packaged Schedule';

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  assert.ok(response.ok, `${options.method ?? 'GET'} ${url} returned ${response.status}: ${body}`);
  return { response, body };
}

/** Write one scheduled allocation through authenticated typed planning routes. */
export async function writeSmokeSchedule(baseUrl, cookie, companyId, fixture, masqueradeToken) {
  const company = fixture.companies.find((row) => row.id === 'a-studio');
  assert.ok(company);
  const resource = {
    ...fixture.resources.find((row) => row.kind === 'person' && row.companyId === 'a-studio'),
    id: randomUUID(),
    name: RESOURCE_NAME,
  };
  assert.ok(resource.id);
  const createdResource = await fetchOk(
    `${baseUrl}/api/v1/companies/${companyId}/planning/mutations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        cookie,
        'X-Masquerade-Context': masqueradeToken,
      },
      body: JSON.stringify({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: {
          operation: 'resource.create',
          id: resource.id,
          fields: {
            kind: 'person',
            name: resource.name,
            jobTitle: resource.jobTitle,
            avatarUrl: null,
            disciplineId: null,
            employmentType: resource.employmentType,
            engagement: resource.engagement,
            workingHoursPerDay: resource.workingHoursPerDay,
            workingDays: resource.workingDays,
            halfDays: resource.halfDays,
            projectId: null,
            color: resource.color,
            isFavourite: false,
            firstAvailableDate: null,
            lastAvailableDate: null,
          },
        },
      }),
    },
  );
  assert.equal(JSON.parse(createdResource.body).data.revision, 2);

  const activity = {
    id: randomUUID(),
    name: 'Packaged Planning',
    kind: 'internal',
    projectId: null,
    phaseId: null,
  };
  const createdActivity = await fetchOk(
    `${baseUrl}/api/v1/companies/${companyId}/planning/mutations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        cookie,
        'X-Masquerade-Context': masqueradeToken,
      },
      body: JSON.stringify({
        mutationId: randomUUID(),
        baseRevision: 2,
        intent: {
          operation: 'catalogue.create',
          entity: {
            entity: 'activities',
            id: activity.id,
            fields: { name: activity.name, kind: activity.kind, projectId: null, phaseId: null },
          },
        },
      }),
    },
  );
  assert.equal(JSON.parse(createdActivity.body).data.revision, 3);

  const allocation = {
    id: randomUUID(),
    resourceId: resource.id,
    activityId: activity.id,
    projectId: null,
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    hoursPerDay: 7.5,
    status: 'confirmed',
  };
  const createdAllocation = await fetchOk(
    `${baseUrl}/api/v1/companies/${companyId}/planning/mutations`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        cookie,
        'X-Masquerade-Context': masqueradeToken,
      },
      body: JSON.stringify({
        mutationId: randomUUID(),
        baseRevision: 3,
        intent: { operation: 'allocation.create', allocation },
      }),
    },
  );
  assert.equal(JSON.parse(createdAllocation.body).data.revision, 4);
  return { companyId, resource, activity, allocation };
}
