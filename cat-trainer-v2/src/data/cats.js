// Cat definitions — preserved from the legacy app (catTrainerMvpV1).
// Each cat trains independently. Hero Form unlocks at Brain >= 12 AND Energy >= 12.
// Brain/Energy are cumulative and are never spent when the Hero Form unlocks.

export const CAT_IDS = ['nova', 'ember', 'moss'];

export const CAT_DEFS = {
  nova: {
    id: 'nova',
    name: 'Nova',
    title: 'Curious Moon Cat',
    heroName: 'Nova Hero',
    heroTitle: 'Keeper of Bright Ideas',
    art: 'assets/nova.png',
    heroArt: 'assets/nova-hero.png'
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    title: 'Brave Orange Cat',
    heroName: 'Ember Hero',
    heroTitle: 'Champion of Big Energy',
    art: 'assets/ember.png',
    heroArt: 'assets/ember-hero.png'
  },
  moss: {
    id: 'moss',
    name: 'Moss',
    title: 'Steady Calico Cat',
    heroName: 'Moss Hero',
    heroTitle: 'Guardian of Home and Heart',
    art: 'assets/moss.png',
    heroArt: 'assets/moss-hero.png'
  }
};

// A cat's starting progress. All three cats start unlocked, matching the legacy app.
export function freshCatProgress() {
  return { brain: 0, energy: 0, bond: 0, evolved: false };
}
