// Cat Café items — IDs, names, prices, and art preserved EXACTLY from the legacy
// app's asset-overrides.js so existing purchases migrate 1:1. Do not rename these
// IDs. Cat Coins are the only currency here; screen-time points are never spent.
//
// Note: the first four IDs (rug/bed/plant/tower) are historical and their IDs do
// not match their current display names (e.g. `rug` is now "Blue Yarn"). They are
// kept verbatim for migration compatibility. `role` drives Play-mode behavior;
// decor acknowledges a tap but never pretends to change a care need.

export const CAFE_ITEMS = {
  rug:        { id: 'rug',        name: 'Blue Yarn',        price: 4,  role: 'play',  art: 'assets/yarn-blue.png',        className: 'decor-yarn-blue' },
  bed:        { id: 'bed',        name: 'Blue Star Bed',    price: 6,  role: 'rest',  art: 'assets/bed-blue-stars.png',   className: 'decor-bed-blue' },
  plant:      { id: 'plant',      name: 'Paw-Print Plant',  price: 8,  role: 'decor', art: 'assets/plant.png',            className: 'decor-plant-png' },
  tower:      { id: 'tower',      name: 'Cat Tree',         price: 12, role: 'play',  art: 'assets/cat-tree.png',         className: 'decor-cat-tree' },
  pinkBed:    { id: 'pinkBed',    name: 'Pink Heart Bed',   price: 7,  role: 'rest',  art: 'assets/bed-pink-hearts.png',  className: 'decor-bed-pink' },
  foodBowl:   { id: 'foodBowl',   name: 'Purple Food Bowl', price: 5,  role: 'food',  art: 'assets/food-bowl-purple.png', className: 'decor-food-bowl' },
  waterBowl:  { id: 'waterBowl',  name: 'Teal Water Bowl',  price: 5,  role: 'food',  art: 'assets/water-bowl-teal.png',  className: 'decor-water-bowl' },
  pinkYarn:   { id: 'pinkYarn',   name: 'Pink Yarn',        price: 4,  role: 'play',  art: 'assets/yarn-pink.png',        className: 'decor-yarn-pink' },
  bookshelf:  { id: 'bookshelf',  name: 'Cat Bookshelf',    price: 14, role: 'decor', art: 'assets/bookshelf.png',        className: 'decor-bookshelf' },
  toyBasket:  { id: 'toyBasket',  name: 'Toy Basket',       price: 9,  role: 'play',  art: 'assets/toy-basket.png',       className: 'decor-toy-basket' },
  moonCollar: { id: 'moonCollar', name: 'Moon Collar',      price: 10, role: 'decor', art: 'assets/collar-moon.png',      className: 'decor-moon-collar' },
  // Added 2026-08-07 from the Google Drive "Cat Cafe" art set. New IDs (no legacy
  // migration to preserve), so names and IDs match.
  petPillow:  { id: 'petPillow',  name: 'Mint Pillow',      price: 6,  role: 'rest',  art: 'assets/pet-pillow-mint.png',  className: 'decor-pet-pillow' },
  greenBed:   { id: 'greenBed',   name: 'Green Paw Bed',    price: 7,  role: 'rest',  art: 'assets/bed-green-paws.png',   className: 'decor-bed-green' },
  bunting:    { id: 'bunting',    name: 'Party Bunting',    price: 8,  role: 'decor', art: 'assets/bunting-pastel.png',   className: 'decor-bunting' },
  tealCollar: { id: 'tealCollar', name: 'Teal Heart Collar',price: 10, role: 'decor', art: 'assets/collar-teal-heart.png',className: 'decor-teal-collar' },
  petHouse:   { id: 'petHouse',   name: 'Cat House',        price: 15, role: 'rest',  art: 'assets/pet-house-green.png',  className: 'decor-pet-house' },
  goldCrown:  { id: 'goldCrown',  name: 'Gold Crown',       price: 16, role: 'decor', art: 'assets/crown-gold-heart.png', className: 'decor-gold-crown' }
};

export const CAFE_ROOM_ART = 'assets/cafe-room.png';
