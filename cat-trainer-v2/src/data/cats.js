// Cat definitions — preserved from the legacy app (catTrainerMvpV1).
// Each cat trains independently. Hero Form requires Brain >= 12, Energy >= 12,
// and 14 distinct active care days. Progress is cumulative and never spent.

import { freshHeroCareProgress } from '../shared/rewards.js?v=27e48d14';

export const CAT_IDS = ['nova', 'ember', 'moss'];

export const CAT_DEFS = {
  nova: {
    id: 'nova',
    name: 'Nova',
    title: 'Curious Moon Cat',
    heroName: 'Nova Hero',
    heroTitle: 'Keeper of Bright Ideas',
    art: 'assets/nova.png',
    heroArt: 'assets/nova-hero.png',
    poses: { sit: 'assets/nova-sit.png', play: 'assets/nova-play.png', eat: 'assets/nova-eat.png', sleep: 'assets/nova-sleep.png', celebrate: 'assets/nova-celebrate.png' },
    frames: {
      eat: ['assets/nova-eat.png', 'assets/nova-eat-b.png'],
      play: ['assets/nova-play.png', 'assets/nova-play-b.png'],
      walk: ['assets/nova-walk-a.png', 'assets/nova-walk-b.png'],
      idle: ['assets/nova-sit.png', 'assets/nova-blink.png'],
      sleep: ['assets/nova-sleep.png', 'assets/nova-sleep-b.png']
    },
    // Preserved signature-bed art. Runtime sleep currently layers the cat-only
    // frames over whichever rest object was tapped for consistent cat × bed use.
    bedItemId: 'bed', bedPose: 'assets/nova-blue-star-bed.png'
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    title: 'Brave Orange Cat',
    heroName: 'Ember Hero',
    heroTitle: 'Champion of Big Energy',
    art: 'assets/ember.png',
    heroArt: 'assets/ember-hero.png',
    poses: { sit: 'assets/ember-sit.png', play: 'assets/ember-play.png', eat: 'assets/ember-eat.png', sleep: 'assets/ember-sleep.png', celebrate: 'assets/ember-celebrate.png' },
    frames: {
      eat: ['assets/ember-eat.png', 'assets/ember-eat-b.png'],
      play: ['assets/ember-play.png', 'assets/ember-play-b.png'],
      walk: ['assets/ember-walk-a.png', 'assets/ember-walk-b.png'],
      idle: ['assets/ember-sit.png', 'assets/ember-blink.png'],
      sleep: ['assets/ember-sleep.png', 'assets/ember-sleep-b.png']
    },
    bedItemId: 'greenBed', bedPose: 'assets/ember-green-paw-bed.png'
  },
  moss: {
    id: 'moss',
    name: 'Moss',
    title: 'Steady Calico Cat',
    heroName: 'Moss Hero',
    heroTitle: 'Guardian of Home and Heart',
    art: 'assets/moss.png',
    heroArt: 'assets/moss-hero.png',
    poses: { sit: 'assets/moss-sit.png', play: 'assets/moss-play.png', eat: 'assets/moss-eat.png', sleep: 'assets/moss-sleep.png', celebrate: 'assets/moss-celebrate.png' },
    frames: {
      eat: ['assets/moss-eat.png', 'assets/moss-eat-b.png'],
      play: ['assets/moss-play.png', 'assets/moss-play-b.png'],
      walk: ['assets/moss-walk-a.png', 'assets/moss-walk-b.png'],
      idle: ['assets/moss-sit.png', 'assets/moss-blink.png'],
      sleep: ['assets/moss-sleep.png', 'assets/moss-sleep-b.png']
    },
    bedItemId: 'pinkBed', bedPose: 'assets/moss-pink-heart-bed.png'
  }
};

// A cat's starting progress. All three cats start unlocked, matching the legacy app.
export function freshCatProgress() {
  return {
    brain: 0,
    energy: 0,
    bond: 0,
    evolved: false,
    heroCareProgress: freshHeroCareProgress()
  };
}
