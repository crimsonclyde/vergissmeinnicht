/**
 * A clearly marked sample edition (43) for tests, the demo seed and the API documentation. Every source is
 * an `example.org` placeholder and every headline says nothing true about the world.
 */
export function sampleGazetteEdition(date: string) {
  const day = (offset: number) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  };
  const at = `${date}T05:10:00Z`;
  return {
    version: 1,
    date,
    title: 'The Daily Planet',
    greeting: 'Sample edition: a bright, mild day in the valley; rain returns on Tuesday.',
    intro: 'Good morning. **This is sample content** for reviewing the Gazette before live imports are switched on. Nothing in it is real news.',
    sections: [
      {
        sectionId: 'weather', type: 'weather', summary: 'Sources disagree on Tuesday\'s rain in Liguria.',
        locations: [
          {
            name: 'Triora', region: 'Imperia, Liguria',
            days: [0, 1, 2, 3, 4, 5, 6].map(i => ({ date: day(i), condition: (['CLEAR', 'CLEAR', 'PARTLY_CLOUDY', 'RAIN', 'RAIN', 'PARTLY_CLOUDY', 'CLEAR'] as const)[i], high: [16, 17, 14, 11, 12, 14, 15][i], low: [8, 9, 8, 6, 6, 7, 8][i], precipitationMm: i === 3 ? { min: 4, max: 22 } : [0, 0, 1, 0, 6, 0, 0][i], windKmh: [8, 10, 14, 28, 20, 12, 9][i] })),
            comparison: { metric: 'precipitation', rows: [
              { source: 'Open-Meteo ICON-2I (sample)', values: [0, 0, 1, 22, 7, null, null] },
              { source: 'MET Norway (sample)', values: [0, 0, 0, 4, 5, 0, 0] },
              { source: 'Open-Meteo ECMWF (sample)', values: [0, 0, 2, 11, 6, 0, 0] },
            ] },
            warnings: [{ level: 'yellow', text: 'Sample: rain warning for the Valle Argentina.', source: 'ARPAL Liguria (sample)', date: day(3) }],
            sources: [{ name: 'Open-Meteo (sample)', url: 'https://example.org/open-meteo' }, { name: 'MET Norway (sample)', url: 'https://example.org/met' }],
            fetchedAt: `${date}T05:31:00Z`,
          },
          {
            name: 'Göggenhofen', region: 'Bavaria',
            days: [0, 1, 2, 3, 4, 5, 6].map(i => ({ date: day(i), condition: (['FOG', 'PARTLY_CLOUDY', 'CLEAR', 'PARTLY_CLOUDY', 'RAIN', 'CLOUDY', 'CLOUDY'] as const)[i], high: [6, 7, 8, 7, 5, 4, 5][i], low: [1, 0, -1, 0, -2, -2, -1][i], precipitationMm: [0, 0, 0, 0, 3, 0, 0][i] })),
            sources: [{ name: 'MET Norway (sample)', url: 'https://example.org/met' }],
            note: 'WeatherOnline is not used: no permitted data access found yet.',
          },
        ],
      },
      {
        sectionId: 'it-open-source', type: 'articles',
        items: [
          { id: 'sample-linux', title: 'Sample: a new kernel release speeds up container hosts', summary: 'Placeholder summary for the lead story of the technology section.', url: 'https://example.org/tech/kernel', source: 'Example Tech', publishedAt: at, relevance: 'high' },
          { id: 'sample-advisory', title: 'Sample: image library fixes a crafted-file crash', summary: 'Placeholder advisory to show the security box.', url: 'https://example.org/tech/advisory', source: 'Example Advisory', publishedAt: at,
            security: { package: 'example-image-lib', identifier: 'SAMPLE-0001', advisoryUrl: 'https://example.org/advisory/0001', severity: 'high', relevance: 'Checked against the lockfile: not used by VMN.', verification: 'not_affected' } },
        ],
      },
      {
        sectionId: 'liguria', type: 'articles',
        items: [
          { id: 'sample-sanremo', title: 'Esempio: riapre la pista ciclabile del Ponente', summary: 'Testo di esempio per la sezione regionale.', url: 'https://example.org/liguria/pista', source: 'Fonte di esempio', publishedAt: at, language: 'it' },
          { id: 'sample-triora', title: 'Esempio: il borgo prepara la festa della castagna', summary: 'Testo di esempio.', url: 'https://example.org/liguria/castagna', source: 'Fonte di esempio', publishedAt: at, language: 'it' },
        ],
      },
      {
        sectionId: 'europe-world', type: 'articles',
        items: [{ id: 'sample-repair', title: 'Sample: common rules for repairable phones agreed', summary: 'Placeholder for the Europe & World section.', url: 'https://example.org/world/repair', source: 'Example Wire', publishedAt: at }],
      },
      {
        sectionId: 'good-news', type: 'articles',
        items: [{ id: 'sample-bees', title: 'Sample: alpine bee numbers recover in two valleys', summary: 'Placeholder for the Good News section.', url: 'https://example.org/good/bees', source: 'Example Nature', publishedAt: at }],
      },
      {
        sectionId: 'watchlist', type: 'watchlist',
        items: [
          { id: 'sample-grinder', name: 'Burr coffee grinder (sample)', condition: 'new', market: 'IT', shop: 'Example Shop', url: 'https://example.org/shop/grinder', currency: 'EUR', price: 149, typical: 189, target: 160, change: 'down', verified: true, checkedAt: `${date}T05:20:00Z`, history: [189, 189, 185, 179, 169, 159, 149] },
          { id: 'sample-boots', name: 'Hiking boots (sample)', condition: 'new', market: 'IT', shop: 'Example Outdoor', currency: 'EUR', price: 164, typical: 170, target: 140, change: 'same', verified: false, checkedAt: `${day(-2)}T05:20:00Z` },
        ],
      },
    ],
  };
}
