import { describe, expect, it } from 'vitest'
import {
  byName,
  compareDisplayNames,
  createClientProjectDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from './displayOrder'

describe('display ordering', () => {
  it('pins English alphabetical order instead of inheriting the host locale', () => {
    const entries = [
      { id: 'z', name: 'Zulu' },
      { id: 'a', name: 'Äther' },
    ]

    expect(new Intl.Collator('sv').compare('Äther', 'Zulu')).toBeGreaterThan(0)
    expect([...entries].sort(byName).map((entry) => entry.name)).toEqual(['Äther', 'Zulu'])
  })

  it('orders numbered names naturally', () => {
    const entries = [
      { id: 'ten', name: 'Workshop 10' },
      { id: 'two', name: 'Workshop 2' },
    ]

    expect([...entries].sort(byName).map((entry) => entry.name)).toEqual([
      'Workshop 2',
      'Workshop 10',
    ])
  })

  it('breaks case, accent and exact-name ties without relying on stable sort', () => {
    const entries = [
      { id: 'same-z', name: 'alpha' },
      { id: 'accent', name: 'álpha' },
      { id: 'upper', name: 'Alpha' },
      { id: 'same-a', name: 'alpha' },
    ]

    expect([...entries].sort(byName).map((entry) => entry.id)).toEqual([
      'upper',
      'same-a',
      'same-z',
      'accent',
    ])
    expect(
      compareDisplayNames({ leftName: 'Same', leftId: 'b', rightName: 'Same', rightId: 'a' })
    ).toBeGreaterThan(0)
  })
})

describe('client/project display ordering', () => {
  it('orders by the server display name of client then project, with deterministic ties', () => {
    const clients = [
      { id: 'client-x', name: 'BP', displayName: 'Xavier' },
      { id: 'client-c', name: 'Celtic' },
    ]
    const projects = [
      { id: 'project-z', clientId: 'client-c', name: 'App', displayName: 'Zulu' },
      { id: 'project-b', clientId: 'client-x', name: 'Beta' },
      { id: 'project-a', clientId: 'client-x', name: 'alpha' },
      { id: 'project-a2', clientId: 'client-x', name: 'alpha' },
      { id: 'project-a1', clientId: 'client-x', name: 'alpha' },
      { id: 'project-aardvark', clientId: 'client-c', name: 'Website', displayName: 'Aardvark' },
    ]

    expect(
      [...projects]
        .sort(createClientProjectDisplayNameComparator(clients))
        .map((project) => project.id)
    ).toEqual([
      'project-aardvark',
      'project-z',
      'project-a',
      'project-a1',
      'project-a2',
      'project-b',
    ])
  })
})

describe('partitioned display ordering', () => {
  it('sorts favourites first and applies the same deterministic display-name order within each partition', () => {
    const entries = [
      { id: 'normal-b', name: 'Beta' },
      { id: 'favourite-b', name: 'Beta', isFavourite: true },
      { id: 'normal-a', name: 'Alpha', isFavourite: false },
      { id: 'favourite-a', name: 'alpha', isFavourite: true },
    ]

    expect(
      [...entries]
        .sort(createFavouriteDisplayNameComparator((entry) => entry.name))
        .map((entry) => entry.id)
    ).toEqual(['favourite-a', 'favourite-b', 'normal-a', 'normal-b'])
  })

  it('sorts Studio before Supplementary and favourites first within each engagement partition', () => {
    const entries = [
      {
        id: 'supp-favourite',
        name: 'Alpha',
        engagement: 'supplementary' as const,
        isFavourite: true,
      },
      { id: 'studio-normal', name: 'Zulu', engagement: 'studio' as const },
      { id: 'studio-favourite', name: 'Beta', engagement: 'studio' as const, isFavourite: true },
      { id: 'supp-normal', name: 'Beta', engagement: 'supplementary' as const },
    ]

    expect(
      [...entries]
        .sort(createEngagementFavouriteDisplayNameComparator((entry) => entry.name))
        .map((entry) => entry.id)
    ).toEqual(['studio-favourite', 'studio-normal', 'supp-favourite', 'supp-normal'])
  })
})
