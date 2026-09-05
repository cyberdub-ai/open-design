// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';
import { I18nProvider } from '../../src/i18n';

const analytics = vi.hoisted(() => ({
  track: vi.fn(),
  newRequestId: vi.fn(() => 'request-nav-community'),
}));

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    track: analytics.track,
    newRequestId: analytics.newRequestId,
  }),
}));

afterEach(cleanup);

beforeEach(() => {
  analytics.track.mockReset();
  analytics.newRequestId.mockClear();
});

function renderRail(locale: 'en' | 'ja' | 'zh-CN' | 'zh-TW') {
  render(
    <I18nProvider initial={locale}>
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        onOpenSearch={() => {}}
        onOpenSettings={() => {}}
        open
        context={null}
      />
    </I18nProvider>,
  );
}

/**
 * The nav rail's first social slot is locale-switched: Chinese UIs get the
 * Feishu group invite because Discord is effectively unreachable for that
 * audience, every other locale keeps Discord.
 *
 * These assertions deliberately pin the destination the user actually clicks
 * — href, test id and the analytics element — rather than the presence of the
 * URL constants, because the switch is a single boolean term inside a
 * component upstream keeps editing. A merge that flattens that term would
 * leave the constants in place and silently send Chinese users to Discord.
 */
describe('EntryNavRail community link is locale-switched', () => {
  it('sends Chinese simplified users to Feishu', () => {
    renderRail('zh-CN');

    const link = screen.getByTestId('entry-nav-rail-feishu');
    expect(link.getAttribute('href')).toContain('feishu.cn');
    expect(screen.queryByTestId('entry-nav-rail-discord')).toBeNull();

    fireEvent.click(link);
    expect(analytics.track).toHaveBeenCalledWith(
      'ui_click',
      expect.objectContaining({ area: 'account_menu', element: 'feishu' }),
      undefined,
    );
  });

  it('sends Chinese traditional users to Feishu', () => {
    renderRail('zh-TW');

    const link = screen.getByTestId('entry-nav-rail-feishu');
    expect(link.getAttribute('href')).toContain('feishu.cn');
    expect(screen.queryByTestId('entry-nav-rail-discord')).toBeNull();
  });

  it('keeps Discord for English', () => {
    renderRail('en');

    const link = screen.getByTestId('entry-nav-rail-discord');
    expect(link.getAttribute('href')).toContain('discord.gg');
    expect(screen.queryByTestId('entry-nav-rail-feishu')).toBeNull();

    fireEvent.click(link);
    expect(analytics.track).toHaveBeenCalledWith(
      'ui_click',
      expect.objectContaining({ area: 'account_menu', element: 'discord' }),
      undefined,
    );
  });

  it('keeps Discord for a non-Chinese asian locale', () => {
    renderRail('ja');

    expect(screen.getByTestId('entry-nav-rail-discord').getAttribute('href')).toContain(
      'discord.gg',
    );
    expect(screen.queryByTestId('entry-nav-rail-feishu')).toBeNull();
  });
});
