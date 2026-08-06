// Default daily quests — wording and reward values preserved exactly from the
// legacy app (catTrainerMvpV1). Each quest can be completed once per local
// (America/Chicago) calendar day. `order` drives display and is reorderable by Mom.
// `enabled` lets Mom turn a quest off without deleting it.

export const SECTIONS = ['Morning', 'Brain', 'Move', 'Tidy', 'Night'];

export const SECTION_META = {
  Morning: { icon: 'assets/morning-icon.png', glyph: '☀', color: 'green' },
  Brain: { icon: 'assets/brain-icon.png', glyph: '★', color: 'purple' },
  Move: { icon: 'assets/move-icon.png', glyph: '⚡', color: 'orange' },
  Tidy: { icon: null, glyph: '◆', color: 'blue' },
  Night: { icon: null, glyph: '☾', color: 'pink' }
};

export const DEFAULT_QUESTS = [
  { id: 'm-bathroom',  title: 'Bathroom',                        section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-wesley',    title: 'Take Wesley out',                 section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-water',     title: "Check Wesley's water",            section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-bedding',   title: 'Fold bedding and put it away',    section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-dressed',   title: 'Get dressed',                     section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-teeth',     title: 'Brush teeth',                     section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-face',      title: 'Wash face and fix hair',          section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-breakfast', title: 'Eat breakfast and wash bowl',     section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'b-read',      title: 'Read or complete a Brain Quest',  section: 'Brain',   points: 1, brain: 2, energy: 0, coins: 1 },
  { id: 'v-move',      title: 'Complete a movement challenge',   section: 'Move',    points: 1, brain: 0, energy: 2, coins: 1 },
  { id: 't-space',     title: 'Reset one shared space',          section: 'Tidy',    points: 1, brain: 0, energy: 1, coins: 2 },
  { id: 'n-teeth',     title: 'Night teeth and pajamas',         section: 'Night',   points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'n-room',      title: 'Tidy and make bed',               section: 'Night',   points: 1, brain: 0, energy: 1, coins: 1 }
];

// Give each default quest an initial order + enabled flag for the rebuild.
export function seededQuests() {
  return DEFAULT_QUESTS.map((q, i) => ({ ...q, enabled: true, order: i }));
}
