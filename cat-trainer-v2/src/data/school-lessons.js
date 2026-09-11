// Sirus's actual school day, as Quests for the School daypart.
//
// SOURCE OF TRUTH IS THE JOURNAL REPO, NOT THIS FILE. Courses, weekly rhythm,
// and block placement come from `current/course-plan.md` and
// `current/weekday-schedule.md` in xiateas-source/Journal (read 2026-09-11).
// This file is a transcription for the reward app; when the course plan
// changes there, change it here too. Nothing in Cat Trainer feeds back into
// the Journal.
//
// Modelled on the real schedule, so the recurrence is per-course rather than
// "weekdays" across the board:
//
//   8:45  Math C .............................. Mon–Fri
//   9:30  Language Arts D ..................... Mon–Fri
//  10:45  rotating block ...................... Mon Reading Comp D
//                                               Tue / Thu Language Arts C
//                                               Wed / Fri Learn to Read C
//   1:15  Earth & Space Science ............... Mon–Fri
//   2:15  afternoon block ..................... Mon / Tue Social Studies 1
//                                               Wed Language Arts C continuation
//                                               Thu project or enrichment
//                                               Fri Art
//   3:00  daily copywork ...................... Mon–Fri
//          Life Skills 1, Fit and Active ....... Sat (weekend enrichment; the
//                                               weekday schedule has no blocks
//                                               for these, so they are Anytime)
//
// Deliberately NOT modelled: clock times, block lengths, and "the block may end
// early" rules. The schedule says blocks are maximum containers, not seat-time
// quotas, and a quest that nagged about a clock would turn a container into a
// quota. A lesson is done when Lor says it's done, and that is what earns.
//
// Ids are prefixed `s-` (school) so they never collide with the seeded routine
// quests (`m-`, `b-`, `v-`, `t-`, `n-`) and can be recognised as a group.
//
// Rewards follow the existing Brain-section shape (1 minute, 2 Brain, 1 coin).
// Friday Art and the Thursday project earn Energy instead of Brain, matching
// how Move-flavoured work is rewarded elsewhere. These are starting values —
// Mom can edit any of them per quest once they're in.

const MON_FRI = { type: 'weekdays' };
const days = (...codes) => ({ type: 'selected_days', days: codes });

export const SCHOOL_LESSON_QUESTS = [
  {
    id: 's-math-c', title: 'Math C', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: MON_FRI
  },
  {
    id: 's-la-d', title: 'Language Arts D', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: MON_FRI
  },
  {
    id: 's-reading-comp-d', title: 'Reading Comprehension D', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: days('MO')
  },
  {
    id: 's-la-c', title: 'Language Arts C', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: days('TU', 'TH')
  },
  {
    id: 's-learn-to-read-c', title: 'Learn to Read C', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: days('WE', 'FR')
  },
  {
    id: 's-science', title: 'Earth & Space Science', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: MON_FRI
  },
  {
    id: 's-social-studies', title: 'Social Studies 1', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: days('MO', 'TU')
  },
  {
    // The Wednesday 2:15 block is a third Language Arts C session, and the
    // schedule is explicit that it is regular work rather than catch-up debt.
    // Separate quest so Wednesday doesn't need one quest completed twice.
    id: 's-la-c-wed', title: 'Language Arts C (afternoon)', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 2, energy: 0, coins: 1, recurrence: days('WE')
  },
  {
    id: 's-project', title: 'Project or enrichment', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 1, energy: 1, coins: 1, recurrence: days('TH')
  },
  {
    id: 's-art', title: 'Art', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 0, energy: 2, coins: 1, recurrence: days('FR')
  },
  {
    id: 's-copywork', title: 'Daily copywork', section: 'Brain', timeWindow: 'school',
    points: 1, brain: 1, energy: 0, coins: 1, recurrence: MON_FRI
  },
  // Saturday enrichment. The course plan assigns both on Sat; the weekday
  // schedule has no blocks for them, so they are 'anytime' rather than
  // 'school' — Saturday has no school day to sit inside, and the School
  // filter should stay weekday work.
  {
    id: 's-life-skills', title: 'Life Skills 1', section: 'Brain', timeWindow: 'anytime',
    points: 1, brain: 1, energy: 1, coins: 1, recurrence: days('SA')
  },
  {
    id: 's-fit-active', title: 'Fit and Active', section: 'Brain', timeWindow: 'anytime',
    points: 1, brain: 0, energy: 2, coins: 1, recurrence: days('SA')
  }
];

export const SCHOOL_LESSON_IDS = new Set(SCHOOL_LESSON_QUESTS.map(q => q.id));

// Which of these are not in the family yet. Import is additive: a lesson that
// is already present is never overwritten, so Mom's edits, pauses, and archives
// survive a re-import. A lesson she DELETED, though, counts as missing and will
// come back if she imports again — deleting and re-importing is how you reset
// one to its defaults, and Pause or Archive is how you keep one gone.
export function missingSchoolLessons(existingQuests) {
  const have = new Set((existingQuests || []).map(q => q && q.id));
  return SCHOOL_LESSON_QUESTS.filter(q => !have.has(q.id));
}
