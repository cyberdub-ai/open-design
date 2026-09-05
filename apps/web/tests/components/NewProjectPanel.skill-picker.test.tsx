// @vitest-environment jsdom

// The skill picker is fork behavior: upstream routes a prototype/deck project
// through whichever skill `defaultFor` names, with no way for the user to say
// otherwise. The override is a single `selectedSkillId ?? …` term in the
// create payload plus one conditional `<select>` — the kind of shape a merge
// resolves away without a conflict. These tests hold the observable contract:
// which options the dropdown offers, which skillId reaches `onCreate`, and
// that a pick does not leak across tabs.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewProjectPanel } from '../../src/components/NewProjectPanel';
import type { DesignSystemSummary, SkillSummary } from '../../src/types';

function skill(over: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name' | 'mode'>): SkillSummary {
  return {
    description: `${over.name} skill`,
    surface: 'web',
    previewType: 'html',
    designSystemRequired: false,
    defaultFor: [],
    triggers: [],
    upstream: null,
    hasBody: true,
    examplePrompt: '',
    aggregatesExamples: false,
    ...over,
  };
}

const skills: SkillSummary[] = [
  skill({ id: 'prototype-default', name: 'Prototype default', mode: 'prototype', defaultFor: ['prototype'] }),
  skill({ id: 'prototype-alt', name: 'Prototype alternative', mode: 'prototype' }),
  skill({ id: 'deck-default', name: 'Deck default', mode: 'deck', previewType: 'deck', defaultFor: ['deck'] }),
];

const designSystems: DesignSystemSummary[] = [
  {
    id: 'clay',
    title: 'Clay',
    summary: 'Friendly tactile product UI.',
    category: 'Product',
    swatches: ['#f4efe7', '#25211d'],
    source: 'built-in',
    status: 'published',
  },
];

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
});

function renderPanel(onCreate = vi.fn()) {
  render(
    <NewProjectPanel
      skills={skills}
      designSystems={designSystems}
      defaultDesignSystemId="clay"
      templates={[]}
      onDeleteTemplate={vi.fn()}
      promptTemplates={[]}
      onCreate={onCreate}
    />,
  );
  return onCreate;
}

function picker(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: /skill/i }) as HTMLSelectElement;
}

function createAs(name: string) {
  fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('create-project'));
}

describe('NewProjectPanel skill picker', () => {
  it('offers the auto option plus only the skills of the active tab', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('new-project-tab-prototype'));

    expect(Array.from(picker().options).map((o) => o.value)).toEqual([
      '',
      'prototype-default',
      'prototype-alt',
    ]);

    fireEvent.click(screen.getByTestId('new-project-tab-deck'));
    expect(Array.from(picker().options).map((o) => o.value)).toEqual(['', 'deck-default']);
  });

  it('leaves the create payload on the tab default while the picker says auto', () => {
    const onCreate = renderPanel();
    fireEvent.click(screen.getByTestId('new-project-tab-prototype'));

    expect(picker().value).toBe('');
    createAs('Auto routed');

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Auto routed', skillId: 'prototype-default' }),
    );
  });

  it('routes the project through the picked skill instead of the tab default', () => {
    const onCreate = renderPanel();
    fireEvent.click(screen.getByTestId('new-project-tab-prototype'));
    fireEvent.change(picker(), { target: { value: 'prototype-alt' } });

    createAs('Explicitly routed');

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Explicitly routed', skillId: 'prototype-alt' }),
    );
  });

  it('drops the pick when the tab changes so a deck choice cannot route a prototype', () => {
    const onCreate = renderPanel();
    fireEvent.click(screen.getByTestId('new-project-tab-deck'));
    fireEvent.change(picker(), { target: { value: 'deck-default' } });

    fireEvent.click(screen.getByTestId('new-project-tab-prototype'));
    expect(picker().value).toBe('');

    createAs('Back on prototype');

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Back on prototype', skillId: 'prototype-default' }),
    );
  });

  it('hides the picker on tabs that do not route through a skill choice', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('new-project-tab-other'));

    expect(screen.queryByRole('combobox', { name: /skill/i })).toBeNull();
  });
});
