// Cat Café items — IDs, names, prices, and art preserved EXACTLY from the legacy
// app's asset-overrides.js so existing purchases migrate 1:1. Do not rename these
// IDs. Cat Coins are the only currency here; screen-time points are never spent.
//
// Note: the first four IDs (rug/bed/plant/tower) are historical and their IDs do
// not match their current display names (e.g. `rug` is now "Blue Yarn"). They are
// kept verbatim for migration compatibility.

export const CAFE_ITEMS = {
  rug:        { id: 'rug',        name: 'Blue Yarn',        price: 4,  art: 'assets/yarn-blue.png',        className: 'decor-yarn-blue' },
  bed:        { id: 'bed',        name: 'Blue Star Bed',    price: 6,  art: 'assets/bed-blue-stars.png',   className: 'decor-bed-blue' },
  plant:      { id: 'plant',      name: 'Paw-Print Plant',  price: 8,  art: 'assets/plant.png',            className: 'decor-plant-png' },
  tower:      { id: 'tower',      name: 'Cat Tree',         price: 12, art: 'assets/cat-tree.png',         className: 'decor-cat-tree' },
  pinkBed:    { id: 'pinkBed',    name: 'Pink Heart Bed',   price: 7,  art: 'assets/bed-pink-hearts.png',  className: 'decor-bed-pink' },
  foodBowl:   { id: 'foodBowl',   name: 'Purple Food Bowl', price: 5,  art: 'assets/food-bowl-purple.png', className: 'decor-food-bowl' },
  waterBowl:  { id: 'waterBowl',  name: 'Teal Water Bowl',  price: 5,  art: 'assets/water-bowl-teal.png',  className: 'decor-water-bowl' },
  pinkYarn:   { id: 'pinkYarn',   name: 'Pink Yarn',        price: 4,  art: 'assets/yarn-pink.png',        className: 'decor-yarn-pink' },
  bookshelf:  { id: 'bookshelf',  name: 'Cat Bookshelf',    price: 14, art: 'assets/bookshelf.png',        className: 'decor-bookshelf' },
  toyBasket:  { id: 'toyBasket',  name: 'Toy Basket',       price: 9,  art: 'assets/toy-basket.png',       className: 'decor-toy-basket' },
  moonCollar: { id: 'moonCollar', name: 'Moon Collar',      price: 10, art: 'assets/collar-moon.png',      className: 'decor-moon-collar' }
};

export const CAFE_ROOM_ART = 'assets/cafe-room.png';
